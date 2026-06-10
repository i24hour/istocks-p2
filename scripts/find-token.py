from SmartApi.smartConnect import SmartConnect
import pyotp
import time
import os

# ==== Angel One Credentials ====
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

smartApi = SmartConnect(api_key=API_KEY)
totp = pyotp.TOTP(TOTP_TOKEN).now()
data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)

if data['status']:
    print("Authenticated")
    # Search for SWIGGY
    try:
        # Note: searchScrip might not be available in this version of SDK or might need different params
        # Let's try to fetch a known scrip to ensure connection, then we might need to look up token externally
        # or use the 'search' endpoint if available.
        # Actually, the SDK has `searchScrip`
        
        # Try fetching data directly for token 537800
        print("Testing token '537800' directly...")
        
        from datetime import datetime, timedelta
        
        # Fetch for yesterday
        to_date = datetime.now()
        from_date = to_date - timedelta(days=5)
        
        params = {
            "exchange": "BSE",
            "symboltoken": "537800",
            "interval": "ONE_DAY",
            "fromdate": from_date.strftime("%Y-%m-%d 09:15"),
            "todate": to_date.strftime("%Y-%m-%d 15:30")
        }
        
        try:
            candle_data = smartApi.getCandleData(params)
            print("Candle Data Result:", candle_data)
            
            if candle_data and candle_data.get('status') and candle_data.get('data'):
                print("✅ Token 537800 is VALID! Found data.")
            else:
                print("❌ Token 537800 returned no data.")
                
        except Exception as e:
            print(f"❌ Error fetching candle data: {e}") 
        # The SDK signature might be different, let's check documentation or try standard
        # If searchScrip is not available, I will print the error.
        
        print("Search Result:", result)
    except Exception as e:
        print("Error searching:", e)
        
    # Alternative: Fetch candle data for a known SWIGGY token if we can guess it? No.
    # Let's try to find the token from the response if possible.
else:
    print("Auth Failed")
