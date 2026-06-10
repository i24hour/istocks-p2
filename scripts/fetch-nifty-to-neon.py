#!/usr/bin/env python3
"""
Fetch historical NIFTY 50 Index data from Angel One API and save to Azure PostgreSQL database
1-minute candles, last 1 year data
"""

import requests
import json
import psycopg2
from psycopg2.extras import execute_batch
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import os
import time

# Angel One credentials
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# Azure PostgreSQL connection
# ==== Database (Azure) ====
DATABASE_URL = os.getenv("DATABASE_URL")

# NIFTY 50 Index stock ID in Database
STOCK_ID = "1314a70d-e1cb-476d-851a-3a5f84ad8f74"  # NIFTY 50 Index

# URL of Angel One's OpenAPI Scrip Master JSON
URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

def get_symbol_token_by_name(name, exchange="NSE"):
    """Fetch token for a stock/index symbol"""
    try:
        logger.info(f"Fetching token for {name} from Angel One master...")
        response = requests.get(URL)
        data = response.json()

        # For NIFTY 50 Index, look for exact match
        for item in data:
            if item["name"].upper() == name.upper() and item["exch_seg"] == exchange:
                logger.info(f"Found: {item['name']} - Token: {item['token']}")
                return item["token"]
        
        # Also try with "NIFTY 50" 
        for item in data:
            if "NIFTY" in item["name"].upper() and "50" in item["name"] and item["exch_seg"] == exchange:
                logger.info(f"Found: {item['name']} - Token: {item['token']}")
                return item["token"]
                
        # List first few NIFTY matches for debugging
        logger.info("Searching for NIFTY matches...")
        nifty_matches = [item for item in data if "NIFTY" in item.get("name", "").upper()][:10]
        for match in nifty_matches:
            logger.info(f"  {match.get('exch_seg')}: {match.get('name')} - Token: {match.get('token')}")

        return None

    except Exception as e:
        logger.error(f"Error fetching token: {str(e)}")
        return None

def save_to_database(candles, conn):
    """Save candles to PostgreSQL database"""
    if not candles:
        return 0
    
    cursor = conn.cursor()
    
    # Prepare data for insertion
    records = []
    for candle in candles:
        # candle format: [timestamp, open, high, low, close, volume]
        timestamp_str = candle[0]
        
        # Angel One API returns timestamps in IST format (e.g., "2025-01-08T10:30:00+05:30")
        # We keep them as IST naive timestamps (no timezone conversion)
        try:
            # Remove timezone info if present - Angel One gives IST, we store as-is
            if '+' in timestamp_str:
                # Extract just the datetime part before timezone
                timestamp_str = timestamp_str.split('+')[0]
            elif 'Z' in timestamp_str:
                timestamp_str = timestamp_str.replace('Z', '')
            
            timestamp = datetime.fromisoformat(timestamp_str)
        except Exception as e:
            logger.warning(f"Could not parse timestamp: {timestamp_str}, error: {e}, skipping...")
            continue
        
        record = (
            STOCK_ID,
            timestamp,
            float(candle[1]),  # open
            float(candle[2]),  # high
            float(candle[3]),  # low
            float(candle[4]),  # close
            int(candle[5])     # volume
        )
        records.append(record)
    
    # Insert with conflict handling (skip duplicates)
    insert_query = """
        INSERT INTO "StockPrice" 
        (id, "stockId", timestamp, open, high, low, close, volume, "createdAt")
        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT ("stockId", timestamp) DO NOTHING
    """
    
    execute_batch(cursor, insert_query, records, page_size=1000)
    conn.commit()
    
    inserted_count = len(records)
    logger.info(f"✅ Processed {inserted_count} records")
    
    cursor.close()
    return inserted_count

def fetch_historical_data_in_chunks(smartApi, token, start_date, end_date, conn, interval="ONE_MINUTE"):
    """Fetch historical data in chunks and save to database"""
    total_inserted = 0
    current_start_date = start_date

    while current_start_date < end_date:
        # Calculate the end date for the current chunk (30 days)
        current_end_date = current_start_date + timedelta(days=30)
        if current_end_date > end_date:
            current_end_date = end_date

        # Format dates for the API
        from_date_str = current_start_date.strftime("%Y-%m-%d %H:%M")
        to_date_str = current_end_date.strftime("%Y-%m-%d %H:%M")

        # Fetch historical data for the current chunk
        historicParam = {
            "exchange": "NSE",
            "symboltoken": token,
            "interval": interval,
            "fromdate": from_date_str,
            "todate": to_date_str,
        }
        
        try:
            historical_data = smartApi.getCandleData(historicParam)

            # Check if data is fetched successfully
            if "data" in historical_data and historical_data["data"]:
                candles = historical_data["data"]
                logger.info(f"✅ Fetched {len(candles)} candles from {from_date_str} to {to_date_str}")
                
                # Save to database
                inserted = save_to_database(candles, conn)
                total_inserted += inserted
            else:
                logger.warning(f"⚠️  No data available from {from_date_str} to {to_date_str}")
                
        except Exception as e:
            logger.error(f"❌ Error fetching data from {from_date_str} to {to_date_str}: {e}")

        # Move to the next chunk
        current_start_date = current_end_date
        
        # Small delay to respect API rate limits
        time.sleep(0.5)

    return total_inserted

def main():
    """Main function"""
    logger.info("🚀 Starting NIFTY 50 Index historical data fetch and Database import")
    
    # NIFTY 50 Index - Token is 26000 on NSE
    # (Symbol: "NIFTY", Name: "NIFTY", Exchange: "NSE")
    stock_name = "NIFTY"
    token = "26000"  # Direct token for NIFTY 50 Index

    logger.info(f"✅ Using NIFTY 50 Index - Token: {token}")

    # Initialize SmartAPI
    smartApi = SmartConnect(api_key=API_KEY)

    # Generate TOTP
    try:
        totp = pyotp.TOTP(TOTP_TOKEN).now()
    except Exception as e:
        logger.error("❌ Invalid TOTP Token")
        raise e

    # Authenticate
    data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)

    if data['status'] == False:
        logger.error(f"❌ Authentication Failed: {data}")
        return
    else:
        logger.info("✅ Successfully Authenticated with Angel One")

    # Connect to Azure database
    try:
        conn = psycopg2.connect(DATABASE_URL)
        logger.info("✅ Connected to Azure PostgreSQL database")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return

    # Define date range - Last 1 year (Dec 19, 2024 to Dec 19, 2025)
    end_date = datetime(2025, 12, 19, 15, 30)   # Today Dec 19, 2025
    start_date = datetime(2024, 12, 19, 9, 15)  # 1 year ago
    
    logger.info(f"📅 Fetching NIFTY 50 data from {start_date} to {end_date}")
    logger.info(f"📊 Interval: 1 MINUTE candles")

    # Fetch historical data in chunks and save to database
    try:
        total_inserted = fetch_historical_data_in_chunks(smartApi, token, start_date, end_date, conn)
        
        if total_inserted > 0:
            logger.info(f"✅ Successfully inserted {total_inserted} NIFTY 50 records into Database")
        else:
            logger.warning("⚠️  No new records inserted (might be duplicates or no data available)")

    except Exception as e:
        logger.exception(f"❌ Error during data fetch: {e}")

    # Close database connection
    conn.close()
    logger.info("✅ Database connection closed")

    # Logout from Angel One
    try:
        logout = smartApi.terminateSession(CLIENT_ID)
        logger.info("✅ Logout Successful")
    except Exception as e:
        logger.exception(f"⚠️  Logout failed: {e}")

    logger.info("🏁 Script completed!")

if __name__ == "__main__":
    main()
