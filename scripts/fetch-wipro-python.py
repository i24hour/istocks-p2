#!/usr/bin/env python3
"""
Fetch Wipro 1-minute data using Angel One API and save to JSON
This JSON can then be imported into the database
"""

import requests
import json
from SmartApi import SmartConnect
import pyotp
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Angel One credentials from environment variables
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_PASSWORD")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# URL of Angel One's OpenAPI Scrip Master JSON
URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

def get_symbol_token_by_name(name, exchange="NSE"):
    try:
        response = requests.get(URL)
        data = response.json()
        
        for item in data:
            if item["name"].lower() == name.lower() and item["exch_seg"] == exchange:
                return item["token"]
        
        return None
    except Exception as e:
        print(f"Error fetching token: {str(e)}")
        return None

def fetch_historical_data_in_chunks(smartApi, token, start_date, end_date, interval="ONE_MINUTE"):
    all_data = []
    current_start_date = start_date
    
    while current_start_date < end_date:
        current_end_date = current_start_date + timedelta(days=30)
        if current_end_date > end_date:
            current_end_date = end_date
        
        from_date_str = current_start_date.strftime("%Y-%m-%d %H:%M")
        to_date_str = current_end_date.strftime("%Y-%m-%d %H:%M")
        
        historicParam = {
            "exchange": "NSE",
            "symboltoken": token,
            "interval": interval,
            "fromdate": from_date_str,
            "todate": to_date_str,
        }
        
        print(f"📊 Fetching data from {from_date_str} to {to_date_str}")
        historical_data = smartApi.getCandleData(historicParam)
        
        if "data" in historical_data and historical_data["data"]:
            all_data.extend(historical_data["data"])
            print(f"✅ Fetched {len(historical_data['data'])} records")
        else:
            print(f"⚠️  No data for period {from_date_str} to {to_date_str}")
            print(f"Response: {historical_data}")
        
        current_start_date = current_end_date
    
    return all_data

# Main execution
print("🚀 Starting Wipro data fetch...")

# Get token
stock_name = "WIPRO"
token = get_symbol_token_by_name(stock_name)

if not token:
    print(f"❌ Stock name '{stock_name}' not found")
    exit(1)

print(f"✅ Found WIPRO token: {token}")

# Initialize SmartAPI
smartApi = SmartConnect(api_key=API_KEY)

# Generate TOTP
try:
    totp = pyotp.TOTP(TOTP_TOKEN).now()
    print(f"Generated TOTP: {totp}")
except Exception as e:
    print(f"❌ Invalid Token: {e}")
    exit(1)

# Authenticate
data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)

if data['status'] == False:
    print(f"❌ Authentication Failed: {data}")
    exit(1)

print("✅ Successfully Authenticated")

# Define date range - LAST 1 MONTH OF ACTUAL HISTORICAL DATA
# Use dates that are in the past
end_date = datetime.now() - timedelta(days=1)  # Yesterday
end_date = end_date.replace(hour=15, minute=30, second=0, microsecond=0)

start_date = end_date - timedelta(days=30)  # 30 days ago
start_date = start_date.replace(hour=9, minute=15, second=0, microsecond=0)

print(f"📅 Date range: {start_date} to {end_date}")

# Fetch historical data
try:
    historical_data = fetch_historical_data_in_chunks(smartApi, token, start_date, end_date)
    
    if historical_data:
        print(f"\n✅ Total records fetched: {len(historical_data)}")
        
        # Save to JSON file
        output_file = "wipro_1min_data.json"
        with open(output_file, "w") as f:
            json.dump(historical_data, f, indent=2)
        
        print(f"✅ Data saved to {output_file}")
        print(f"\n📊 Sample data (first record):")
        print(f"   Timestamp: {historical_data[0][0]}")
        print(f"   Open: {historical_data[0][1]}")
        print(f"   High: {historical_data[0][2]}")
        print(f"   Low: {historical_data[0][3]}")
        print(f"   Close: {historical_data[0][4]}")
        print(f"   Volume: {historical_data[0][5]}")
    else:
        print("❌ No data fetched")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()

# Logout
try:
    smartApi.terminateSession(CLIENT_ID)
    print("\n✅ Logout Successful")
except Exception as e:
    print(f"⚠️  Logout failed: {e}")

print("\n🎉 Done! Now run: npm run db:import")
