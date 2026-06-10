import os
#!/usr/bin/env python3
"""
Test script to check how far back Angel One API provides historical data
Run this first before fetching full historical data
"""

from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta

# Angel One credentials
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_CODE = os.getenv("ANGELONE_CLIENT_ID")
PASSWORD = os.getenv("ANGELONE_SECRET_KEY")
TOTP_SECRET = os.getenv("ANGELONE_TOTP_TOKEN")

# WIPRO details
STOCK_TOKEN = "3787"

def get_totp():
    return pyotp.TOTP(TOTP_SECRET).now()

def test_date_range():
    """Test what date ranges Angel One API supports"""
    
    # Authenticate
    smart_api = SmartConnect(api_key=API_KEY)
    totp = get_totp()
    data = smart_api.generateSession(CLIENT_CODE, PASSWORD, totp)
    
    if not data['status']:
        logger.error("Authentication failed")
        return
    
    logger.info("✅ Authenticated successfully")
    
    # Test different date ranges
    test_dates = [
        ("1 year ago", datetime.now() - timedelta(days=365)),
        ("2 years ago", datetime.now() - timedelta(days=730)),
        ("3 years ago", datetime.now() - timedelta(days=1095)),
        ("5 years ago", datetime.now() - timedelta(days=1825)),
        ("10 years ago", datetime.now() - timedelta(days=3650)),
    ]
    
    for label, from_date in test_dates:
        to_date = from_date + timedelta(days=1)
        
        params = {
            "exchange": "NSE",
            "symboltoken": STOCK_TOKEN,
            "interval": "ONE_MINUTE",
            "fromdate": from_date.strftime("%Y-%m-%d 09:15"),
            "todate": to_date.strftime("%Y-%m-%d 15:30")
        }
        
        logger.info(f"\n📅 Testing {label} ({from_date.strftime('%Y-%m-%d')})...")
        
        try:
            hist_data = smart_api.getCandleData(params)
            
            if hist_data and 'data' in hist_data and hist_data['data']:
                candles = hist_data['data']
                logger.info(f"✅ SUCCESS: Got {len(candles)} candles")
                logger.info(f"   First candle: {candles[0][0]}")
                logger.info(f"   Last candle: {candles[-1][0]}")
            else:
                logger.warning(f"⚠️  NO DATA available for this range")
                logger.info(f"   Response: {hist_data}")
                
        except Exception as e:
            logger.error(f"❌ ERROR: {e}")
    
    # Logout
    try:
        smart_api.terminateSession(CLIENT_CODE)
        logger.info("\n✅ Logged out successfully")
    except:
        pass

if __name__ == "__main__":
    logger.info("🔍 Testing Angel One API historical data availability")
    logger.info("=" * 60)
    test_date_range()
