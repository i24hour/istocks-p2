import os
#!/usr/bin/env python3
"""
Fetch NIFTY data from Angel One and insert directly into Azure PostgreSQL database
For: 21, 22, 23 December 2024
"""

import requests
import psycopg2
from psycopg2.extras import execute_batch
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import uuid

# ==== Angel One Credentials ====
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# ==== Azure PostgreSQL ====
# ==== Database (Azure) ====
DATABASE_URL = os.getenv("DATABASE_URL")
STOCK_ID = "1314a70d-e1cb-476d-851a-3a5f84ad8f74"  # NIFTY stock ID

# ==== Angel One Scrip Master URL ====
SCRIP_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"


def get_symbol_token(name, exchange="NSE"):
    """Get Angel One token for a stock symbol"""
    try:
        response = requests.get(SCRIP_MASTER_URL)
        data = response.json()
        for item in data:
            if item["name"].lower() == name.lower() and item["exch_seg"] == exchange:
                return item["token"]
        return None
    except Exception as e:
        logger.error(f"Error fetching token: {e}")
        return None


def fetch_data_in_chunks(smartApi, token, start_date, end_date, interval="ONE_MINUTE"):
    """Fetch historical data in chunks from Angel One"""
    all_data = []
    current_start = start_date

    while current_start < end_date:
        current_end = current_start + timedelta(days=5)  # 5-day chunks
        if current_end > end_date:
            current_end = end_date

        from_str = current_start.strftime("%Y-%m-%d 09:15")
        to_str = current_end.strftime("%Y-%m-%d 15:30")

        params = {
            "exchange": "NSE",
            "symboltoken": token,
            "interval": interval,
            "fromdate": from_str,
            "todate": to_str,
        }
        
        try:
            result = smartApi.getCandleData(params)
            if result and "data" in result and result["data"]:
                all_data.extend(result["data"])
                logger.info(f"✅ Fetched {len(result['data'])} candles from {from_str} to {to_str}")
            else:
                logger.warning(f"⚠️  No data for {from_str} to {to_str}")
        except Exception as e:
            logger.error(f"❌ Error fetching {from_str} to {to_str}: {e}")

        current_start = current_end

    return all_data


def insert_to_db(data):
    """Insert fetched data directly into Azure database"""
    if not data:
        logger.error("❌ No data to insert")
        return 0

    logger.info(f"📊 Preparing to insert {len(data)} records into Azure database")

    # Connect to database
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        logger.info("✅ Connected to Azure PostgreSQL")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return 0

    # Prepare records
    # Angel One format: [timestamp, open, high, low, close, volume]
    records = []
    for candle in data:
        try:
            timestamp_str = candle[0]  # "2024-12-21T09:15:00+05:30"
            
            # Parse and remove timezone for database
            if '+' in timestamp_str:
                timestamp = datetime.fromisoformat(timestamp_str)
                timestamp = timestamp.replace(tzinfo=None)
            else:
                timestamp = datetime.fromisoformat(timestamp_str)
            
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
        except Exception as e:
            logger.warning(f"⚠️  Error parsing candle: {candle}, Error: {e}")
            continue

    logger.info(f"📊 Prepared {len(records)} valid records")

    # Insert query with upsert (avoid duplicates)
    insert_query = """
        INSERT INTO "StockPrice" 
        (id, "stockId", timestamp, open, high, low, close, volume, "createdAt")
        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT ("stockId", timestamp) DO NOTHING
    """

    # Insert in batches
    batch_size = 2000
    total_inserted = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            execute_batch(cursor, insert_query, batch, page_size=500)
            conn.commit()
            total_inserted += len(batch)
            logger.info(f"✅ Inserted batch {i//batch_size + 1}: {len(batch)} records")
        except Exception as e:
            logger.error(f"❌ Error inserting batch: {e}")
            conn.rollback()

    cursor.close()
    conn.close()
    logger.info(f"🏁 Successfully inserted {total_inserted} records into Azure!")
    return total_inserted


def main():
    """Main function to fetch and insert NIFTY data"""
    logger.info("="*60)
    logger.info("🚀 NIFTY Data Fetcher - Dec 21, 22, 23, 2024")
    logger.info("="*60)

    # Get NIFTY token
    stock_name = "NIFTY"
    token = get_symbol_token(stock_name)
    
    if not token:
        logger.error(f"❌ Could not find token for {stock_name}")
        return

    logger.info(f"📈 NIFTY Token: {token}")

    # Initialize SmartAPI
    smartApi = SmartConnect(api_key=API_KEY)

    # Generate TOTP
    try:
        totp = pyotp.TOTP(TOTP_TOKEN).now()
    except Exception as e:
        logger.error(f"❌ Invalid TOTP Token: {e}")
        return

    # Authenticate
    data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)

    if not data.get('status'):
        logger.error(f"❌ Authentication Failed: {data}")
        return

    logger.info("✅ Successfully Authenticated with Angel One")

    # Define date range: Dec 20, 21, 22, 23, 2025
    start_date = datetime(2025, 12, 20)
    end_date = datetime(2025, 12, 23, 23, 59)  # End of Dec 23

    logger.info(f"📅 Fetching data from {start_date} to {end_date}")

    # Fetch data
    try:
        historical_data = fetch_data_in_chunks(smartApi, token, start_date, end_date)
        
        if historical_data:
            logger.info(f"✅ Fetched {len(historical_data)} total candles")
            
            # Insert into Azure database
            inserted = insert_to_db(historical_data)
            logger.info(f"🎉 Done! Inserted {inserted} records for Dec 21, 22, 23")
        else:
            logger.error("❌ No data fetched from Angel One")

    except Exception as e:
        logger.exception(f"❌ Error: {e}")

    # Logout
    try:
        smartApi.terminateSession(CLIENT_ID)
        logger.info("✅ Logged out from Angel One")
    except Exception as e:
        logger.warning(f"⚠️  Logout warning: {e}")


if __name__ == "__main__":
    main()
