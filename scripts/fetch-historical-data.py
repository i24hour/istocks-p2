import os
#!/usr/bin/env python3
"""
Fetch historical WIPRO 1-minute data from Jan 1, 2015 to Oct 16, 2025
This will fill the gap before the current data (Oct 17 - Nov 21, 2025)
"""

import psycopg2
from psycopg2.extras import execute_batch
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import time
import json

# Angel One credentials
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_CODE = os.getenv("ANGELONE_CLIENT_ID")
PASSWORD = os.getenv("ANGELONE_SECRET_KEY")
TOTP_SECRET = os.getenv("ANGELONE_TOTP_TOKEN")

# PostgreSQL connection
DB_CONFIG = {
    'host': 'localhost',
    'database': 'stock_analysis',
    'user': 'priyanshu',
    'port': 5432
}

# WIPRO details
STOCK_SYMBOL = "WIPRO-EQ"
STOCK_TOKEN = "3787"
STOCK_ID = "cmi2cmbzn0000ne9p2v0g98ry"  # From your database

def get_totp():
    """Generate TOTP for authentication"""
    return pyotp.TOTP(TOTP_SECRET).now()

def authenticate_angel_one():
    """Authenticate with Angel One API"""
    try:
        smart_api = SmartConnect(api_key=API_KEY)
        totp = get_totp()
        
        data = smart_api.generateSession(CLIENT_CODE, PASSWORD, totp)
        
        if data['status']:
            logger.info(f"✅ Successfully authenticated with Angel One")
            return smart_api
        else:
            logger.error(f"❌ Authentication failed: {data}")
            return None
            
    except Exception as e:
        logger.error(f"❌ Authentication error: {e}")
        return None

def fetch_historical_chunk(smart_api, from_date, to_date):
    """
    Fetch historical data for a date range
    Angel One API has limits, so we fetch in chunks
    """
    try:
        params = {
            "exchange": "NSE",
            "symboltoken": STOCK_TOKEN,
            "interval": "ONE_MINUTE",
            "fromdate": from_date.strftime("%Y-%m-%d %H:%M"),
            "todate": to_date.strftime("%Y-%m-%d %H:%M")
        }
        
        logger.info(f"Fetching data from {params['fromdate']} to {params['todate']}")
        
        hist_data = smart_api.getCandleData(params)
        
        if hist_data and 'data' in hist_data and hist_data['data']:
            candles = hist_data['data']
            logger.info(f"✅ Fetched {len(candles)} candles")
            return candles
        else:
            logger.warning(f"⚠️  No data received for {from_date} to {to_date}")
            return []
            
    except Exception as e:
        logger.error(f"❌ Error fetching data: {e}")
        return []

def save_to_database(candles, conn):
    """Save candles to PostgreSQL database"""
    if not candles:
        return 0
    
    cursor = conn.cursor()
    
    # Prepare data for insertion
    records = []
    for candle in candles:
        # candle format: [timestamp, open, high, low, close, volume]
        timestamp = datetime.strptime(candle[0], "%Y-%m-%dT%H:%M:%S%z")
        # Remove timezone info for storage
        timestamp = timestamp.replace(tzinfo=None)
        
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
        ("stockId", timestamp, open, high, low, close, volume, "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT ("stockId", timestamp) DO NOTHING
    """
    
    execute_batch(cursor, insert_query, records, page_size=1000)
    conn.commit()
    
    inserted_count = cursor.rowcount
    logger.info(f"✅ Inserted {inserted_count} new records into database")
    
    cursor.close()
    return inserted_count

def main():
    """Main function to fetch historical data"""
    logger.info("🚀 Starting historical data fetch")
    
    # Date range
    start_date = datetime(2015, 1, 1, 9, 15)  # Jan 1, 2015, 9:15 AM
    end_date = datetime(2025, 10, 16, 15, 30)  # Oct 16, 2025, 3:30 PM
    
    logger.info(f"📅 Fetching data from {start_date} to {end_date}")
    logger.info(f"⚠️  This will take a LONG time (~10 years of 1-min data)")
    logger.info(f"⚠️  Estimated: ~1.5 million records to fetch")
    logger.info(f"⚠️  Angel One API limits: Max 1000 candles per request")
    logger.info(f"⚠️  We'll fetch in 7-day chunks with 2 second delays")
    
    user_confirm = input("\n⚠️  This will take several HOURS. Continue? (yes/no): ")
    if user_confirm.lower() != 'yes':
        logger.info("❌ User cancelled. Exiting.")
        return
    
    # Authenticate
    smart_api = authenticate_angel_one()
    if not smart_api:
        logger.error("❌ Failed to authenticate. Exiting.")
        return
    
    # Connect to database
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        logger.info("✅ Connected to PostgreSQL database")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return
    
    # Fetch data in 7-day chunks (safer for API limits)
    # 7 days × 6.25 hours × 60 min = ~2,625 candles per chunk (within 1000 limit after market hours)
    current_date = start_date
    total_inserted = 0
    chunk_count = 0
    
    while current_date < end_date:
        # Fetch 7 days at a time
        chunk_end = min(current_date + timedelta(days=7), end_date)
        
        # Fetch data
        candles = fetch_historical_chunk(smart_api, current_date, chunk_end)
        
        # Save to database
        if candles:
            inserted = save_to_database(candles, conn)
            total_inserted += inserted
        
        # Move to next chunk
        current_date = chunk_end + timedelta(minutes=1)
        chunk_count += 1
        
        # Rate limiting - wait 2 seconds between requests to avoid API throttling
        logger.info(f"⏳ Waiting 2 seconds before next request...")
        time.sleep(2)
        
        # Progress update every 5 chunks
        if chunk_count % 5 == 0:
            progress_pct = ((current_date - start_date).days / (end_date - start_date).days) * 100
            logger.info(f"📊 Progress: {progress_pct:.1f}% - Processed {chunk_count} chunks, inserted {total_inserted} records")
            logger.info(f"📅 Current date: {current_date}")
    
    # Close database connection
    conn.close()
    
    # Logout from Angel One
    try:
        smart_api.terminateSession(CLIENT_CODE)
        logger.info("✅ Logged out successfully")
    except:
        pass
    
    logger.info(f"🏁 Historical data fetch complete!")
    logger.info(f"📊 Total records inserted: {total_inserted}")
    logger.info(f"📅 Date range: {start_date} to {end_date}")

if __name__ == "__main__":
    main()
