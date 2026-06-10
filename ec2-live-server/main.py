from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field
from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Tuple
import os
import asyncio
import json
import pyotp
import psycopg2
from datetime import datetime, timedelta, time
import pytz
import threading
import time as t_module
from logzero import logger

# ============= CONFIGURATION =============
# Prefer environment variables in production; keep legacy defaults as fallback.
API_KEY = os.getenv("ANGEL_API_KEY") or os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGEL_CLIENT_ID") or os.getenv("ANGELONE_CLIENT_ID")
PASSWORD = os.getenv("ANGEL_PASSWORD") or os.getenv("ANGELONE_SECRET_KEY")
TOTP_SECRET = os.getenv("ANGEL_TOTP_SECRET") or os.getenv("ANGELONE_TOTP_TOKEN")

# Database connection params
DB_HOST = os.getenv("DB_HOST", "istocks.postgres.database.azure.com")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER")
DB_PASS = os.getenv("DB_PASS")

# Market Hours (IST)
IST = pytz.timezone('Asia/Kolkata')
MARKET_OPEN = time(9, 0)   # 9:00 AM IST
MARKET_CLOSE = time(15, 30)  # 3:30 PM IST

# Reconnect settings
MAX_RECONNECT_ATTEMPTS = 10
RECONNECT_DELAY_SECONDS = 15
WATCHDOG_INTERVAL = 120  # Check connection health every 2 minutes

# Stock token cache loaded from DB (no hardcoded universe)
STOCK_TOKENS: Dict[str, Dict[str, Any]] = {}
TOKEN_TO_SYMBOL: Dict[str, str] = {}

EXCHANGE_TO_TYPE = {
    "NSE": 1,
    "BSE": 3,
}
SYMBOL_ALIASES = {
    "ZOMATO": "ETERNAL",
}
# SmartAPI correlationID must be 10-char alphanumeric; keep chunk size conservative
# to avoid silent subscription drops on large universes.
SUBSCRIPTION_BATCH_SIZE = 50

# ============= STATE =============
live_prices: Dict[str, Dict] = {}
previous_closes: Dict[str, float] = {}

ws_connected = False
smart_api: Optional[SmartConnect] = None
sws: Optional[SmartWebSocketV2] = None
reconnect_attempts = 0
last_tick_time: Optional[datetime] = None  # Track when we last received data
ws_thread: Optional[threading.Thread] = None  # Track the WebSocket thread
last_login_date: Optional[str] = None  # Track daily login to force re-auth
subscribed_token_count = 0
subscribed_batch_count = 0
last_subscription_error: Optional[str] = None

# ============= MARKET HOURS CHECK =============

def is_market_hours() -> bool:
    """Check if current time is within market hours (9 AM - 3:30 PM IST, Mon-Fri)."""
    now = datetime.now(IST)
    current_time = now.time()
    weekday = now.weekday()  # 0=Monday, 6=Sunday
    
    # Market closed on weekends
    if weekday >= 5:
        return False
    
    return MARKET_OPEN <= current_time <= MARKET_CLOSE

def get_seconds_until_market_open() -> int:
    """Calculate seconds until next market open."""
    now = datetime.now(IST)
    today_open = now.replace(hour=9, minute=0, second=0, microsecond=0)
    
    if now.time() < MARKET_OPEN:
        return int((today_open - now).total_seconds())
    else:
        tomorrow = now + timedelta(days=1)
        while tomorrow.weekday() >= 5:
            tomorrow += timedelta(days=1)
        tomorrow_open = tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)
        return int((tomorrow_open - now).total_seconds())

# ============= DATABASE FUNCTIONS =============

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        sslmode="require",
    )

def normalize_symbol(symbol: str) -> str:
    symbol_upper = symbol.strip().upper()
    return SYMBOL_ALIASES.get(symbol_upper, symbol_upper)

def load_stock_tokens_from_db() -> int:
    """Load the full tradable stock/token universe from the Stock master table."""
    global STOCK_TOKENS, TOKEN_TO_SYMBOL
    logger.info("Loading stock tokens from database...")

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
                SELECT symbol, exchange, "angelToken"
                FROM "Stock"
                WHERE "angelToken" IS NOT NULL
                  AND "angelToken" <> ''
            """
        )
        rows = cursor.fetchall()

        stock_tokens: Dict[str, Dict[str, Any]] = {}
        token_to_symbol: Dict[str, str] = {}

        for symbol, exchange, angel_token in rows:
            symbol_key = normalize_symbol(str(symbol))
            exchange_type = EXCHANGE_TO_TYPE.get(str(exchange).upper())
            token = str(angel_token).strip()

            if exchange_type is None or not token:
                continue

            stock_tokens[symbol_key] = {"token": token, "exchange": exchange_type}
            if token not in token_to_symbol:
                token_to_symbol[token] = symbol_key

        cursor.close()
        conn.close()

        STOCK_TOKENS = stock_tokens
        TOKEN_TO_SYMBOL = token_to_symbol
        logger.info(f"Loaded {len(STOCK_TOKENS)} stock tokens from DB")
        return len(STOCK_TOKENS)

    except Exception as e:
        logger.error(f"Token load error: {e}")
        return 0

def get_token_info(symbol: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Resolve symbol/token info from in-memory cache, with DB refresh fallback."""
    symbol_key = normalize_symbol(symbol)
    token_info = STOCK_TOKENS.get(symbol_key)
    if token_info:
        return symbol_key, token_info

    if load_stock_tokens_from_db() <= 0:
        return None

    token_info = STOCK_TOKENS.get(symbol_key)
    if token_info:
        return symbol_key, token_info
    return None

def build_subscription_batches():
    """Build SmartAPI subscription payload in manageable token batches."""
    grouped_tokens: Dict[int, list[str]] = {}
    for info in STOCK_TOKENS.values():
        exchange_type = int(info["exchange"])
        token = str(info["token"])
        grouped_tokens.setdefault(exchange_type, []).append(token)

    batches = []
    for exchange_type, tokens in grouped_tokens.items():
        for i in range(0, len(tokens), SUBSCRIPTION_BATCH_SIZE):
            batches.append({"exchangeType": exchange_type, "tokens": tokens[i:i + SUBSCRIPTION_BATCH_SIZE]})
    return batches

def build_correlation_id(index: int) -> str:
    """SmartAPI expects a 10-char alphanumeric correlation id."""
    # Example: S000000001, S000000245
    return f"S{index:09d}"[:10]

def fetch_previous_closes():
    """Fetch the latest available close price for all stocks from DB."""
    global previous_closes
    logger.info("Fetching previous close prices from database...")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = """
            SELECT s.symbol, sp.close 
            FROM "Stock" s
            JOIN "StockPrice" sp ON s.id = sp."stockId"
            WHERE sp.timestamp = (
                SELECT MAX(timestamp) 
                FROM "StockPrice" sp2 
                WHERE sp2."stockId" = s.id
                AND sp2.timestamp < CURRENT_DATE
            )
        """
        
        cursor.execute(query)
        rows = cursor.fetchall()

        previous_closes = {}
        
        for symbol, close in rows:
            key = normalize_symbol(str(symbol))
            
            if key in STOCK_TOKENS:
                previous_closes[key] = float(close)
                
        cursor.close()
        conn.close()
        logger.info(f"Loaded {len(previous_closes)} previous close prices for tracked symbols")
        
    except Exception as e:
        logger.error(f"Database fetch error: {e}")

# ============= ANGEL ONE CONNECTION =============

def generate_totp() -> str:
    """Generate fresh TOTP for login."""
    return pyotp.TOTP(TOTP_SECRET).now()

def login_angel_one() -> SmartConnect:
    """Login to Angel One and return SmartConnect instance. Always creates a FRESH session."""
    global smart_api, last_login_date
    
    # Always create a fresh SmartConnect instance for clean state
    smart_api = SmartConnect(api_key=API_KEY)
    totp = generate_totp()
    
    logger.info("Attempting Angel One login (fresh session)...")
    data = smart_api.generateSession(CLIENT_ID, PASSWORD, totp)
    if data.get("status"):
        last_login_date = datetime.now(IST).strftime("%Y-%m-%d")
        logger.info(f"Angel One Login Successful (date: {last_login_date})")
        return smart_api
    else:
        raise Exception(f"Login failed: {data}")

def needs_fresh_login() -> bool:
    """Check if we need a fresh login (new day or no session)."""
    if not smart_api or not smart_api.access_token:
        return True
    today = datetime.now(IST).strftime("%Y-%m-%d")
    if last_login_date != today:
        logger.info(f"New day detected ({last_login_date} -> {today}), forcing fresh login")
        return True
    return False

def on_tick(wsapp, message):
    """Callback when WebSocket receives a tick."""
    global live_prices, previous_closes, last_tick_time
    try:
        if not isinstance(message, dict):
            return
        token = str(message.get("token", ""))
        ltp = message.get("last_traded_price", 0) / 100
        
        symbol = TOKEN_TO_SYMBOL.get(token)
        if symbol:
            # Prefer exchange-provided previous close from tick payload.
            # DB previous close can be stale for symbols that are not backfilled frequently.
            tick_prev_close_raw = (
                message.get("closed_price")
                or message.get("close_price")
                or message.get("prev_close")
                or message.get("previous_close")
            )
            tick_prev_close = None
            try:
                if tick_prev_close_raw is not None:
                    tick_prev_close = float(tick_prev_close_raw) / 100
            except Exception:
                tick_prev_close = None

            if tick_prev_close and tick_prev_close > 0:
                prev_close = tick_prev_close
                # Keep cache fresh so fallback paths also use latest close.
                previous_closes[symbol] = tick_prev_close
            else:
                prev_close = previous_closes.get(symbol, ltp)
            
            change = ltp - prev_close
            change_pct = (change / prev_close * 100) if prev_close else 0
            
            live_prices[symbol] = {
                "ltp": round(ltp, 2),
                "change": round(change, 2),
                "change_pct": round(change_pct, 2),
                "close": prev_close,
                "timestamp": datetime.now().isoformat(),
            }
            last_tick_time = datetime.now(IST)
    except Exception as e:
        logger.error(f"Tick error: {e}")

def on_open(wsapp):
    """Callback when WebSocket connection opens."""
    global ws_connected, reconnect_attempts, subscribed_token_count, subscribed_batch_count, last_subscription_error
    ws_connected = True
    reconnect_attempts = 0
    subscribed_token_count = 0
    subscribed_batch_count = 0
    last_subscription_error = None
    logger.info("✅ WebSocket Connected - Subscribing to stocks...")

    if not STOCK_TOKENS:
        load_stock_tokens_from_db()

    subscription_batches = build_subscription_batches()
    if not subscription_batches:
        ws_connected = False
        logger.error("No DB-backed stock tokens available for subscription")
        return

    total_tokens = 0
    successful_batches = 0
    for idx, batch in enumerate(subscription_batches, start=1):
        try:
            correlation_id = build_correlation_id(idx)
            # mode=1 (LTP_MODE) for lightweight streaming across broad universe.
            sws.subscribe(correlation_id, 1, [batch])
            batch_size = len(batch["tokens"])
            total_tokens += batch_size
            successful_batches += 1
            t_module.sleep(0.1)
        except Exception as e:
            last_subscription_error = str(e)
            logger.error(f"Subscription failed for batch {idx}/{len(subscription_batches)}: {e}")

    subscribed_token_count = total_tokens
    subscribed_batch_count = successful_batches

    if successful_batches == 0:
        ws_connected = False
        logger.error("No websocket subscriptions were accepted")
        return

    logger.info(
        f"Subscribed {total_tokens} tokens across {successful_batches}/{len(subscription_batches)} batches"
    )

def on_error(wsapp, error):
    """Callback on WebSocket error."""
    global ws_connected
    ws_connected = False
    logger.error(f"❌ WebSocket Error: {error}")

def on_close(wsapp):
    """Callback when WebSocket closes."""
    global ws_connected
    ws_connected = False
    logger.warning("⚠️ WebSocket Disconnected")

def kill_existing_websocket():
    """Force-kill any existing WebSocket connection cleanly."""
    global sws, ws_connected, ws_thread
    
    ws_connected = False
    
    if sws:
        try:
            sws.close_connection()
            logger.info("Closed existing WebSocket connection")
        except Exception as e:
            logger.warning(f"Error closing WebSocket: {e}")
        sws = None
    
    # Wait for old thread to die (max 5 seconds)
    if ws_thread and ws_thread.is_alive():
        logger.info("Waiting for old WebSocket thread to terminate...")
        ws_thread.join(timeout=5)
        if ws_thread.is_alive():
            logger.warning("Old WebSocket thread still alive, proceeding anyway")

def connect_websocket():
    """Initialize and connect to Angel One WebSocket. This is a BLOCKING call."""
    global sws, smart_api, ws_connected
    
    try:
        # Only login if we don't have a valid session for today.
        # Re-using the same session avoids Angel One rate-limiting on reconnects.
        if needs_fresh_login():
            smart_api = login_angel_one()
        else:
            logger.info("Reusing existing Angel One session for WebSocket reconnect")
        
        auth_token = smart_api.access_token
        feed_token = smart_api.feed_token
        
        if not auth_token or not feed_token:
            raise Exception("Missing auth_token or feed_token after login")
        
        sws = SmartWebSocketV2(auth_token, API_KEY, CLIENT_ID, feed_token)
        sws.on_open = on_open
        sws.on_data = on_tick
        sws.on_error = on_error
        sws.on_close = on_close
        
        logger.info("🔌 Starting WebSocket connection...")
        sws.connect()  # This BLOCKS until disconnect
        
    except Exception as e:
        ws_connected = False
        logger.error(f"❌ Connection error: {e}")
    
    # If we reach here, the WebSocket has disconnected
    ws_connected = False
    logger.warning("WebSocket connect() returned - connection ended")

def start_websocket_thread():
    """Start WebSocket in a new daemon thread. Kills any existing connection first."""
    global ws_thread, reconnect_attempts
    
    # Kill existing connection
    kill_existing_websocket()

    # Refresh DB-backed token universe before each connect
    loaded_tokens = load_stock_tokens_from_db()
    if loaded_tokens <= 0:
        logger.error("Cannot start WebSocket thread: DB token universe is empty")
        return
    
    # Fetch fresh previous closes
    fetch_previous_closes()
    
    # Start new WebSocket thread
    ws_thread = threading.Thread(target=connect_websocket, daemon=True, name="ws-angel-one")
    ws_thread.start()
    logger.info(f"🚀 WebSocket thread started (thread: {ws_thread.name})")

def disconnect_websocket():
    """Gracefully disconnect WebSocket for market close."""
    global sws, ws_connected, ws_thread, reconnect_attempts
    
    ws_connected = False
    reconnect_attempts = 0
    
    if sws:
        try:
            sws.close_connection()
            logger.info("📴 WebSocket disconnected (market closed)")
        except:
            pass
        sws = None

# ============= MARKET HOURS SCHEDULER =============

def market_hours_scheduler():
    """Background thread that manages WebSocket connection based on market hours.
    
    This is the MAIN control loop. It:
    1. Connects WebSocket at market open (9:00 AM IST)
    2. Monitors connection health during market hours
    3. Auto-reconnects if connection drops
    4. Disconnects at market close (3:30 PM IST)
    """
    global reconnect_attempts, ws_connected
    
    logger.info("🕐 Market Hours Scheduler Started")
    was_market_open = False
    
    while True:
        try:
            now = datetime.now(IST)
            market_open = is_market_hours()
            
            if market_open:
                if not was_market_open:
                    # === MARKET JUST OPENED ===
                    logger.info(f"🟢 Market OPEN at {now.strftime('%H:%M:%S')} IST - Initiating connection...")
                    reconnect_attempts = 0
                    start_websocket_thread()
                    was_market_open = True
                    
                elif not ws_connected:
                    # === MARKET IS OPEN BUT WEBSOCKET IS DOWN ===
                    reconnect_attempts += 1
                    
                    if reconnect_attempts <= MAX_RECONNECT_ATTEMPTS:
                        delay = min(RECONNECT_DELAY_SECONDS * reconnect_attempts, 120)
                        logger.warning(f"🔄 WebSocket DOWN during market hours! Reconnect attempt {reconnect_attempts}/{MAX_RECONNECT_ATTEMPTS} (waiting {delay}s)")
                        t_module.sleep(delay)
                        start_websocket_thread()
                    else:
                        # Max attempts reached, wait 5 minutes then reset counter
                        logger.error(f"💀 Max reconnect attempts ({MAX_RECONNECT_ATTEMPTS}) reached. Cooling down 5 min before retrying...")
                        t_module.sleep(300)
                        reconnect_attempts = 0  # Reset and try again!
                        logger.info("🔁 Reconnect counter reset, will try again...")
                        continue
                        
                elif ws_connected and last_tick_time:
                    # === CONNECTION ALIVE, CHECK FOR STALE DATA ===
                    seconds_since_tick = (datetime.now(IST) - last_tick_time).total_seconds()
                    
                    # Pre-market (9:00-9:15) ticks may be sparse, only check after 9:15
                    if now.time() >= time(9, 15) and seconds_since_tick > 300:
                        # No tick in 5 minutes = zombie connection
                        logger.warning(f"🧟 ZOMBIE CONNECTION detected! No tick for {int(seconds_since_tick)}s. Force reconnecting...")
                        ws_connected = False
                        reconnect_attempts = 0
                        start_websocket_thread()
                        
            else:
                # === MARKET IS CLOSED ===
                if was_market_open:
                    logger.info(f"🔴 Market CLOSED at {now.strftime('%H:%M:%S')} IST - Disconnecting...")
                    disconnect_websocket()
                    was_market_open = False
                    reconnect_attempts = 0
                
                # Log next open time (but not every 60s, only every 30 min)
                if now.minute % 30 == 0:
                    seconds_until_open = get_seconds_until_market_open()
                    hours, remainder = divmod(seconds_until_open, 3600)
                    minutes, _ = divmod(remainder, 60)
                    logger.info(f"⏰ Next market open in {hours}h {minutes}m")
            
            # Check every 30 seconds (faster detection of disconnects)
            t_module.sleep(30)
            
        except Exception as e:
            logger.error(f"Scheduler error: {e}")
            import traceback
            traceback.print_exc()
            t_module.sleep(30)

# ============= FASTAPI APP =============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Start the market hours scheduler
    scheduler_thread = threading.Thread(target=market_hours_scheduler, daemon=True, name="market-scheduler")
    scheduler_thread.start()
    logger.info(f"Scheduler thread started: {scheduler_thread.name}")
    
    yield
    
    # Cleanup
    disconnect_websocket()

app = FastAPI(
    title="iStocks Live Price Server",
    description="Real-time stock prices via Angel One WebSocket (Market Hours: 9 AM - 3:30 PM IST)",
    version="3.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Smaller /prices payloads over the wire (full universe JSON is large).
app.add_middleware(GZipMiddleware, minimum_size=1000)

@app.get("/health")
async def health_check():
    now = datetime.now(IST)
    market_status = "OPEN" if is_market_hours() else "CLOSED"
    
    tick_age = None
    if last_tick_time:
        tick_age = int((datetime.now(IST) - last_tick_time).total_seconds())
    
    return {
        "status": "healthy",
        "version": "3.0.0",
        "websocket_connected": ws_connected,
        "market_status": market_status,
        "current_time_ist": now.strftime("%Y-%m-%d %H:%M:%S"),
        "stocks_tracked": len(live_prices),
        "token_universe_count": len(STOCK_TOKENS),
        "db_closes_loaded": len(previous_closes),
        "reconnect_attempts": reconnect_attempts,
        "last_tick_seconds_ago": tick_age,
        "last_login_date": last_login_date,
        "ws_thread_alive": ws_thread.is_alive() if ws_thread else False,
        "subscribed_token_count": subscribed_token_count,
        "subscribed_batch_count": subscribed_batch_count,
        "last_subscription_error": last_subscription_error,
    }

class PriceBatchRequest(BaseModel):
    """Ask for a subset of symbols only — avoids multi‑MB responses for serverless proxies."""

    symbols: list[str] = Field(default_factory=list, max_length=6000)


@app.get("/prices")
async def get_all_prices(symbols: Optional[str] = None):
    """
    Full snapshot of in-memory LTP map, or a filtered subset.
    For large universes, prefer POST /prices/batch from Vercel (small JSON, fast).
    """
    if not symbols or not str(symbols).strip():
        return {
            "success": True,
            "data": live_prices,
            "count": len(live_prices),
            "token_universe_count": len(STOCK_TOKENS),
            "market_open": is_market_hours(),
            "timestamp": datetime.now().isoformat(),
        }

    raw_parts = [p.strip() for p in str(symbols).split(",") if p.strip()]
    filtered: Dict[str, Dict] = {}
    for part in raw_parts:
        key = normalize_symbol(part)
        if not key:
            continue
        if key in live_prices:
            filtered[key] = live_prices[key]

    return {
        "success": True,
        "data": filtered,
        "count": len(filtered),
        "requested": len(raw_parts),
        "token_universe_count": len(STOCK_TOKENS),
        "market_open": is_market_hours(),
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/prices/batch")
async def post_prices_batch(req: PriceBatchRequest):
    """Return LTP rows only for requested symbols (Next.js / mobile use this for polling)."""
    if not req.symbols:
        return {
            "success": True,
            "data": {},
            "count": 0,
            "requested": 0,
            "timestamp": datetime.now().isoformat(),
        }
    if len(req.symbols) > 5000:
        raise HTTPException(status_code=400, detail="Too many symbols (max 5000)")

    filtered: Dict[str, Dict] = {}
    for raw in req.symbols:
        key = normalize_symbol(str(raw).strip())
        if not key:
            continue
        if key in live_prices:
            filtered[key] = live_prices[key]

    return {
        "success": True,
        "data": filtered,
        "count": len(filtered),
        "requested": len(req.symbols),
        "token_universe_count": len(STOCK_TOKENS),
        "market_open": is_market_hours(),
        "timestamp": datetime.now().isoformat(),
    }

@app.get("/candles")
async def get_candles(symbol: str, interval: str = "ONE_MINUTE", count: int = 300):
    """Fetch historical candle data from Angel One for indicator calculation.
    
    Args:
        symbol: Stock symbol (e.g. RELIANCE, SBIN)
        interval: Candle interval - ONE_MINUTE, FIVE_MINUTE, FIFTEEN_MINUTE, ONE_HOUR, ONE_DAY
        count: Number of candles to return (max 500)
    """
    global smart_api
    
    token_resolution = get_token_info(symbol)
    if not token_resolution:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol.upper()} not found in DB token universe")

    symbol_upper, token_info = token_resolution
    symbol_token = token_info["token"]
    exchange_num = token_info["exchange"]
    exchange = "NSE" if exchange_num == 1 else "BSE" if exchange_num == 3 else "NSE"
    
    # Ensure we have an active session
    if not smart_api or not smart_api.access_token:
        try:
            login_angel_one()
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Cannot authenticate with Angel One: {str(e)}")
    
    # Calculate date range based on interval
    now = datetime.now(IST)
    
    # For 1-min candles, Angel One allows max 30 days
    # To get ~300 candles at 1-min = ~5 hours of trading, fetch 2 days to be safe
    interval_days = {
        "ONE_MINUTE": 2,
        "THREE_MINUTE": 5,
        "FIVE_MINUTE": 10,
        "FIFTEEN_MINUTE": 30,
        "THIRTY_MINUTE": 60,
        "ONE_HOUR": 60,
        "ONE_DAY": 365,
    }
    
    days_back = interval_days.get(interval, 2)
    from_date = (now - timedelta(days=days_back)).strftime("%Y-%m-%d 09:15")
    to_date = now.strftime("%Y-%m-%d %H:%M")
    
    try:
        params = {
            "exchange": exchange,
            "symboltoken": symbol_token,
            "interval": interval,
            "fromdate": from_date,
            "todate": to_date,
        }
        
        logger.info(f"Fetching candles for {symbol_upper}: {interval} from {from_date} to {to_date}")
        result = smart_api.getCandleData(params)
        
        if not result or not result.get("data"):
            # Try re-login and retry once
            logger.warning(f"No candle data returned, attempting re-login...")
            login_angel_one()
            result = smart_api.getCandleData(params)
        
        if not result or not result.get("data"):
            return {
                "success": False,
                "error": f"No candle data available for {symbol_upper}",
                "data": []
            }
        
        # Angel One returns: [[timestamp, open, high, low, close, volume], ...]
        raw_candles = result["data"]
        
        # Take only the last `count` candles
        candles_to_return = raw_candles[-min(count, len(raw_candles)):]
        
        formatted = []
        for c in candles_to_return:
            formatted.append({
                "timestamp": c[0],  # ISO string from Angel One
                "open": c[1],
                "high": c[2],
                "low": c[3],
                "close": c[4],
                "volume": c[5],
            })
        
        logger.info(f"Returning {len(formatted)} candles for {symbol_upper}")
        
        return {
            "success": True,
            "symbol": symbol_upper,
            "interval": interval,
            "count": len(formatted),
            "data": formatted,
        }
        
    except Exception as e:
        logger.error(f"Candle fetch error for {symbol_upper}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch candle data: {str(e)}")

@app.post("/reconnect")
async def force_reconnect():
    """Manual endpoint to force reconnection."""
    global reconnect_attempts, last_login_date
    
    if not is_market_hours():
        return {"success": False, "error": "Market is closed. Cannot connect outside 9 AM - 3:30 PM IST."}
    
    # Force a fresh login on next connect attempt
    last_login_date = None
    reconnect_attempts = 0
    threading.Thread(target=start_websocket_thread, daemon=True).start()
    return {"success": True, "message": "Force reconnection initiated (fresh login)"}


@app.post("/admin/restart")
async def admin_restart(secret: str = ""):
    """Emergency endpoint to restart the entire process (useful when WebSocket is stuck).
    Systemd Restart=always will bring it back up within 5 seconds.
    """
    import os, sys
    if secret != "istocks2024":
        return {"success": False, "error": "Invalid secret"}
    logger.warning("🔁 Admin restart requested — shutting down process for systemd restart...")
    # Delay slightly so the HTTP response can be sent
    threading.Thread(target=lambda: (t_module.sleep(1.5), os._exit(0)), daemon=True).start()
    return {"success": True, "message": "Process restarting in ~1.5s. Systemd will bring it back up."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
