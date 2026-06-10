#!/usr/bin/env python3
"""
Fetch historical WIPRO data from Angel One API and save directly to PostgreSQL database
Based on fetch.data.py but saves to database instead of CSV
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

# Angel One credentials
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# PostgreSQL connection
DB_CONFIG = {
    'host': 'localhost',
    'database': 'stock_analysis',
    'user': 'priyanshu',
    'port': 5432
}

# WIPRO stock ID in your database
STOCK_ID = "cmi2cmbzn0000ne9p2v0g98ry"

# URL of Angel One's OpenAPI Scrip Master JSON
URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

def get_symbol_token_by_name(name, exchange="NSE"):
    """Fetch token for a stock symbol"""
    try:
        response = requests.get(URL)
        data = response.json()

        for item in data:
            if item["name"].lower() == name.lower() and item["exch_seg"] == exchange:
                return item["token"]

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
        # timestamp format: "2025-11-21T09:15:00+05:30"
        timestamp_str = candle[0]
        
        # Parse timestamp and remove timezone info
        try:
            # Try parsing with timezone
            if '+' in timestamp_str or 'Z' in timestamp_str:
                timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                # Convert to naive datetime (remove timezone)
                timestamp = timestamp.replace(tzinfo=None)
            else:
                timestamp = datetime.fromisoformat(timestamp_str)
        except:
            logger.warning(f"Could not parse timestamp: {timestamp_str}, skipping...")
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
    
    inserted_count = cursor.rowcount
    logger.info(f"✅ Inserted {inserted_count} new records into database")
    
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
        import time
        time.sleep(0.5)

    return total_inserted

def main():
    """Main function"""
    logger.info("🚀 Starting historical data fetch and database import")
    
    # Fetch token for WIPRO
    stock_name = "WIPRO"
    token = get_symbol_token_by_name(stock_name)

    if not token:
        logger.error(f"❌ Stock name '{stock_name}' not found or token could not be fetched.")
        return

    logger.info(f"✅ Token for {stock_name}: {token}")

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

    # Connect to database
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        logger.info("✅ Connected to PostgreSQL database")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return

    # Define date range - Angel One provided data from Sept 2016 onwards
    # Adjust these dates based on what Angel One API actually provides
    start_date = datetime(2016, 9, 22, 9, 15)   # Start from when data is available
    end_date = datetime(2025, 10, 16, 15, 30)   # Up to Oct 16, 2025
    
    logger.info(f"📅 Fetching data from {start_date} to {end_date}")
    logger.info(f"⚠️  Based on previous run, data is available from Sept 2016 onwards")

    # Fetch historical data in chunks and save to database
    try:
        total_inserted = fetch_historical_data_in_chunks(smartApi, token, start_date, end_date, conn)
        
        if total_inserted > 0:
            logger.info(f"✅ Successfully inserted {total_inserted} records into database")
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
