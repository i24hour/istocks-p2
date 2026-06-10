from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from SmartApi import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
from contextlib import asynccontextmanager
from typing import Dict, Optional
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
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_SECRET = os.getenv("ANGELONE_TOTP_TOKEN")

# Database connection params
DB_HOST = "istocks.postgres.database.azure.com"
DB_PORT = "5432"
DB_NAME = "postgres"
DB_USER = "priyanshu85953"
DB_PASS = os.getenv("DB_PASS")

# Market Hours (IST)
IST = pytz.timezone('Asia/Kolkata')
MARKET_OPEN = time(9, 0)   # 9:00 AM IST
MARKET_CLOSE = time(15, 30)  # 3:30 PM IST

# Reconnect settings
MAX_RECONNECT_ATTEMPTS = 10
RECONNECT_DELAY_SECONDS = 15
WATCHDOG_INTERVAL = 120  # Check connection health every 2 minutes

# Stock Tokens Mapping
STOCK_TOKENS = {
    "NIFTY": {"token": "99926000", "exchange": 1},
    "ADANIPOWER": {"token": "17388", "exchange": 1},
    "ANGELONE": {"token": "20374", "exchange": 1},
    "ASIANPAINT": {"token": "236", "exchange": 1},
    "BAJFINANCE": {"token": "317", "exchange": 1},
    "CDSL": {"token": "21174", "exchange": 1},
    "ETERNAL": {"token": "5097", "exchange": 1},
    "HDFCBANK": {"token": "1333", "exchange": 1},
    "ICICIBANK": {"token": "4963", "exchange": 1},
    "MIFL": {"token": "537800", "exchange": 3},
    "RELIANCE": {"token": "2885", "exchange": 1},
    "SBIN": {"token": "3045", "exchange": 1},
    "SWIGGY": {"token": "27066", "exchange": 1},
    "REDINGTON": {"token": "14255", "exchange": 1},
    "VEDL": {"token": "3063", "exchange": 1},
    "WIPRO": {"token": "3787", "exchange": 1},
    "INFY": {"token": "1594", "exchange": 1},
    "TCS": {"token": "11536", "exchange": 1},
}

TOKEN_TO_SYMBOL = {v["token"]: k for k, v in STOCK_TOKENS.items()}

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

def fetch_previous_closes():
    """Fetch the latest available close price for all stocks from DB."""
    global previous_closes
    logger.info("Fetching previous close prices from database...")
    
    try:
        conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS, sslmode="require")
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
        
        for symbol, close in rows:
            key = symbol
            if symbol == "ZOMATO": key = "ETERNAL"
            
            if key in STOCK_TOKENS:
                previous_closes[key] = float(close)
                logger.info(f"   {key} Prev Close: Rs.{close}")
                
        conn.close()
        logger.info(f"Loaded {len(previous_closes)} previous close prices")
        
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
    global ws_connected, reconnect_attempts
    ws_connected = True
    reconnect_attempts = 0
    logger.info("✅ WebSocket Connected - Subscribing to stocks...")
    
    tokens = [{"exchangeType": v["exchange"], "tokens": [v["token"]]} for v in STOCK_TOKENS.values()]
    sws.subscribe("abc123", 1, tokens)

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
        # Always force a fresh login for reliability
        smart_api = login_angel_one()
        
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
    global reconnect_attempts
    
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
        "db_closes_loaded": len(previous_closes),
        "reconnect_attempts": reconnect_attempts,
        "last_tick_seconds_ago": tick_age,
        "last_login_date": last_login_date,
        "ws_thread_alive": ws_thread.is_alive() if ws_thread else False,
    }

@app.get("/prices")
async def get_all_prices():
    return {
        "success": True,
        "data": live_prices,
        "count": len(live_prices),
        "market_open": is_market_hours(),
        "timestamp": datetime.now().isoformat()
    }

@app.post("/reconnect")
async def force_reconnect():
    """Manual endpoint to force reconnection."""
    global reconnect_attempts
    
    if not is_market_hours():
        return {"success": False, "error": "Market is closed. Cannot connect outside 9 AM - 3:30 PM IST."}
    
    reconnect_attempts = 0
    threading.Thread(target=start_websocket_thread, daemon=True).start()
    return {"success": True, "message": "Force reconnection initiated (fresh login)"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
