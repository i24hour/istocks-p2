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
from datetime import datetime
from logzero import logger

# ============= CONFIGURATION =============
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_SECRET = os.getenv("ANGELONE_TOTP_TOKEN")

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

# ============= IN-MEMORY STORAGE =============
live_prices: Dict[str, Dict] = {}
ws_connected = False
smart_api: Optional[SmartConnect] = None
sws: Optional[SmartWebSocketV2] = None

# ============= ANGEL ONE CONNECTION =============

def generate_totp() -> str:
    return pyotp.TOTP(TOTP_SECRET).now()

def login_angel_one() -> SmartConnect:
    global smart_api
    smart_api = SmartConnect(api_key=API_KEY)
    totp = generate_totp()
    data = smart_api.generateSession(CLIENT_ID, PASSWORD, totp)
    if data.get("status"):
        logger.info("✅ Angel One Login Successful")
        return smart_api
    else:
        raise Exception(f"Login failed: {data}")

def on_tick(wsapp, message):
    global live_prices
    try:
        token = str(message.get("token", ""))
        ltp = message.get("last_traded_price", 0) / 100
        
        symbol = TOKEN_TO_SYMBOL.get(token)
        if symbol:
            live_prices[symbol] = {
                "ltp": round(ltp, 2),
                "change": 0, # Reverted: No DB lookup
                "change_pct": 0, # Reverted: No DB lookup
                "timestamp": datetime.now().isoformat(),
            }
    except Exception:
        pass

def on_open(wsapp):
    global ws_connected
    ws_connected = True
    logger.info("✅ WebSocket Connected")
    tokens = [{"exchangeType": v["exchange"], "tokens": [v["token"]]} for v in STOCK_TOKENS.values()]
    sws.subscribe("abc123", 1, tokens)

def on_error(wsapp, error):
    global ws_connected
    ws_connected = False
    logger.error(f"❌ WebSocket Error: {error}")

def on_close(wsapp):
    global ws_connected
    ws_connected = False
    logger.warning("🔌 WebSocket Disconnected")

def connect_websocket():
    global sws, smart_api
    if not smart_api: smart_api = login_angel_one()
    auth_token = smart_api.access_token
    feed_token = smart_api.feed_token
    sws = SmartWebSocketV2(auth_token, API_KEY, CLIENT_ID, feed_token)
    sws.on_open = on_open
    sws.on_data = on_tick
    sws.on_error = on_error
    sws.on_close = on_close
    sws.connect()

# ============= FASTAPI APP =============

@asynccontextmanager
async def lifespan(app: FastAPI):
    import threading
    ws_thread = threading.Thread(target=connect_websocket, daemon=True)
    ws_thread.start()
    yield
    if sws: sws.close_connection()

app = FastAPI(title="iStocks Live Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "healthy", "websocket_connected": ws_connected, "stocks_tracked": len(live_prices)}

@app.get("/prices")
async def get_all_prices():
    return {"success": True, "data": live_prices}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
