#!/usr/bin/env python3
"""
Auto-fetch stock data from Angel One and save to PostgreSQL
Runs during market hours to fetch latest data
Updated for Azure PostgreSQL
"""

import requests
import psycopg2
from psycopg2.extras import execute_batch
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import time
import os
from dotenv import load_dotenv

# Load environment variables from project root
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(project_root, '.env.local')
load_dotenv(env_path)

API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# Database connection from environment (Azure PostgreSQL by default)
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://user:password@localhost:5432/postgres?sslmode=require",
)

# Stocks to fetch every minute
STOCKS_CONFIG = [
    {
        "symbol": "WIPRO",
        "name": "Wipro Limited",
        "angel_one_name": "WIPRO",
        "exchange": "NSE",
    },
    {
        "symbol": "ICICIBANK",
        "name": "ICICI Bank Limited",
        "angel_one_name": "ICICIBANK",
        "exchange": "NSE",
    },
    {
        "symbol": "REDINGTON",
        "name": "Redington Limited",
        "angel_one_name": "REDINGTON",
        "exchange": "NSE",
    },
]

# Angel One Scrip Master URL
SCRIP_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

def get_symbol_token(name, exchange="NSE"):
    """Fetch token for a stock by name"""
    try:
        response = requests.get(SCRIP_MASTER_URL)
        data = response.json()

        for item in data:
            if item["name"].lower() == name.lower() and item["exch_seg"] == exchange:
                return item["token"]

        return None
    except Exception as e:
        logger.error(f"Error fetching token: {str(e)}")
        return None


def get_stock_id(symbol):
    """Get stock ID from database by symbol"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute('SELECT id FROM "Stock" WHERE symbol = %s', (symbol,))
        result = cur.fetchone()

        cur.close()
        conn.close()

        if result:
            return result[0]
        return None

    except Exception as e:
        logger.error(f"❌ Error getting stock ID: {str(e)}")
        return None


def create_stock_record(symbol, name, exchange):
    """Create a stock record in the database if it doesn't exist"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Generate a deterministic ID to avoid duplicates
        import hashlib

        stock_id = f"stock_{hashlib.md5(symbol.encode()).hexdigest()[:20]}"

        insert_query = """
            INSERT INTO "Stock" (id, symbol, name, exchange, "createdAt", "updatedAt")
            VALUES (%s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (symbol) DO UPDATE
            SET name = EXCLUDED.name,
                exchange = EXCLUDED.exchange,
                "updatedAt" = NOW()
            RETURNING id
        """

        cur.execute(insert_query, (stock_id, symbol, name, exchange))
        result = cur.fetchone()
        stock_id = result[0]

        conn.commit()
        cur.close()
        conn.close()

        logger.info(f"✅ Stock record ready: {symbol} (ID: {stock_id})")
        return stock_id

    except Exception as e:
        logger.error(f"❌ Error creating stock record: {str(e)}")
        return None


def get_last_fetched_date(stock_id):
    """Get the last timestamp we have data for a stock"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        cur.execute(
            """
            SELECT MAX(timestamp)
            FROM "StockPrice"
            WHERE "stockId" = %s
            """,
            (stock_id,),
        )

        result = cur.fetchone()
        cur.close()
        conn.close()

        if result and result[0]:
            return result[0]
        # If no data, go back 30 days
        return datetime.now() - timedelta(days=30)

    except Exception as e:
        logger.error(f"Error getting last date for {stock_id}: {str(e)}")
        return datetime.now() - timedelta(days=30)

def fetch_data_in_chunks(smartApi, token, start_date, end_date, interval="ONE_MINUTE"):
    """Fetch historical data in chunks to avoid API limits"""
    all_data = []
    current_start = start_date
    
    while current_start < end_date:
        # Fetch 1 day at a time to avoid API limits
        current_end = current_start + timedelta(days=1)
        if current_end > end_date:
            current_end = end_date
        
        from_date_str = current_start.strftime("%Y-%m-%d %H:%M")
        to_date_str = current_end.strftime("%Y-%m-%d %H:%M")
        
        logger.info(f"Fetching data from {from_date_str} to {to_date_str}")
        
        try:
            historicParam = {
                "exchange": "NSE",
                "symboltoken": token,
                "interval": interval,
                "fromdate": from_date_str,
                "todate": to_date_str,
            }
            
            historical_data = smartApi.getCandleData(historicParam)
            
            if "data" in historical_data and historical_data["data"]:
                all_data.extend(historical_data["data"])
                logger.info(f"✅ Fetched {len(historical_data['data'])} records")
            else:
                logger.warning(f"⚠️  No data for {from_date_str} to {to_date_str}")
            
            # Sleep to avoid rate limits (500ms between requests)
            time.sleep(0.5)
            
        except Exception as e:
            logger.error(f"❌ Error fetching data: {str(e)}")
        
        current_start = current_end
    
    return all_data

def save_to_database(stock_id, data):
    """Save fetched data to PostgreSQL database"""
    if not data:
        logger.warning("No data to save")
        return 0

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        records = []
        for candle in data:
            timestamp = datetime.strptime(candle[0], "%Y-%m-%dT%H:%M:%S%z")

            record_id = f"price_{stock_id}_{timestamp.strftime('%Y%m%d%H%M%S')}"

            records.append(
                (
                    record_id,
                    stock_id,
                    timestamp,
                    float(candle[1]),
                    float(candle[2]),
                    float(candle[3]),
                    float(candle[4]),
                    int(candle[5]),
                )
            )

        insert_query = """
            INSERT INTO "StockPrice"
            (id, "stockId", timestamp, open, high, low, close, volume)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
        """

        execute_batch(cur, insert_query, records, page_size=200)
        conn.commit()

        inserted_count = cur.rowcount
        cur.close()
        conn.close()

        logger.info(f"✅ Inserted {inserted_count} new records into database")
        return inserted_count

    except Exception as e:
        logger.error(f"❌ Database error: {str(e)}")
        return 0

def main():
    """Main function to fetch and save data for all configured stocks"""
    logger.info("🚀 Starting auto-fetch stock data script (1-minute cadence)")
    logger.info(f"📊 Stocks: {', '.join([s['symbol'] for s in STOCKS_CONFIG])}")

    # Authenticate once
    try:
        smartApi = SmartConnect(api_key=API_KEY)
        totp = pyotp.TOTP(TOTP_TOKEN).now()

        data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)

        if not data.get("status", False):
            logger.error(f"❌ Authentication failed: {data}")
            return

        logger.info("✅ Successfully authenticated with Angel One")

    except Exception as e:
        logger.error(f"❌ Authentication error: {str(e)}")
        return

    for stock in STOCKS_CONFIG:
        symbol = stock["symbol"]
        name = stock["name"]
        exchange = stock.get("exchange", "NSE")

        # Ensure stock record exists and fetch ID
        stock_id = get_stock_id(symbol)
        if not stock_id:
            stock_id = create_stock_record(symbol, name, exchange)
        if not stock_id:
            logger.error(f"❌ Skipping {symbol} (could not get/create stock id)")
            continue

        # Token
        token = get_symbol_token(stock["angel_one_name"], exchange)
        if not token:
            logger.error(f"❌ Could not fetch token for {symbol}")
            continue
        logger.info(f"✅ Token for {symbol}: {token}")

        # Fetch range
        last_date = get_last_fetched_date(stock_id)
        start_date = last_date + timedelta(minutes=1)
        end_date = datetime.now()

        logger.info(f"📊 {symbol}: fetching {start_date} -> {end_date}")

        try:
            historical_data = fetch_data_in_chunks(smartApi, token, start_date, end_date)

            if historical_data:
                logger.info(f"✅ {symbol}: fetched {len(historical_data)} records")
                inserted = save_to_database(stock_id, historical_data)
                logger.info(f"✅ {symbol}: saved {inserted} new records")
            else:
                logger.warning(f"⚠️  {symbol}: no new data fetched")

        except Exception as e:
            logger.error(f"❌ {symbol}: error in fetch/save: {str(e)}")

    # Logout
    try:
        smartApi.terminateSession(CLIENT_ID)
        logger.info("✅ Logged out successfully")
    except Exception as e:
        logger.warning(f"⚠️  Logout warning: {str(e)}")

    logger.info("🏁 Script completed")

if __name__ == "__main__":
    main()
