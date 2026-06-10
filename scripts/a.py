from SmartApi.smartConnect import SmartConnect
from SmartApi.smartWebSocketV2 import SmartWebSocketV2
import pyotp
from logzero import logger
import time
import os

# ===== Your Credentials =====
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
PASSWORD = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")
# ============================

# NIFTY Token
NIFTY_TOKEN = "99926000"

# SmartAPI Object
smartApi = SmartConnect(api_key=API_KEY)

# Generate TOTP
try:
    totp = pyotp.TOTP(TOTP_TOKEN).now()
except Exception as e:
    logger.error(f"Invalid TOTP Token: {e}")
    exit(1)

# Login
data = smartApi.generateSession(CLIENT_ID, PASSWORD, totp)

if not data["status"]:
    logger.error(f"Authentication Failed: {data}")
    exit(1)

logger.info("✅ Login Success")

# Extract Tokens
try:
    auth_token = data["data"]["jwtToken"]
    feed_token = data["data"]["feedToken"]
    client_code = data["data"]["clientcode"]
except KeyError as e:
    logger.error(f"Login failed to return expected tokens: {e}")
    exit(1)

# ===== WebSocket Callbacks =====

def on_data(wsapp, message):
    # message is already parsed info dict
    logger.info(f"Ticks: {message}")
    if "last_traded_price" in message:
        print(f"NIFTY LTP: {message['last_traded_price'] / 100.0}") # usually prices are in paisa/multiplied, checking docs or raw data is needed. 
        # Actually in SmartWebSocketV2 parse_binary_data uses 'q' (long long) for price. 
        # Angel One usually sends price as integer (price * 100). Let's print raw first.

def on_open(wsapp):
    logger.info("✅ WebSocket Connected")
    
    # Subscribe to NIFTY LTP
    # ExchangeType 1 = NSE_CM, 2 = NSE_FO
    # Nifty token 99926000 is likely NSE Indices or specific segment. 
    # Usually indices are in NSE_CM (1) or separate.
    # In original code it was "exchangeType": 1.
    
    token_list = [
        {
            "exchangeType": 1, 
            "tokens": [NIFTY_TOKEN]
        }
    ]
    
    sws.subscribe("corr_id_1", 1, token_list) # Mode 1 = LTP

def on_error(wsapp, error):
    logger.error(f"WebSocket Error: {error}")

def on_close(wsapp):
    logger.warning("WebSocket Closed")

# ===== Start WebSocket =====

sws = SmartWebSocketV2(auth_token, API_KEY, client_code, feed_token)

# Assign callbacks
sws.on_data = on_data
sws.on_open = on_open
sws.on_error = on_error
sws.on_close = on_close

try:
    sws.connect()
except KeyboardInterrupt:
    print("Exiting...")
except Exception as e:
    logger.error(f"Connection failed: {e}")
