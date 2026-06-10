import os
#!/usr/bin/env python3
"""
Fetch historical data for all stocks from 2023 to present
- Adds missing 2023-2024 data for existing stocks
- Adds RELIANCE stock with full history
"""

import requests
import psycopg2
from psycopg2.extras import execute_batch
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import time

# ==== Angel One Credentials ====
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# ==== Azure PostgreSQL ====
AZURE_DATABASE_URL = os.getenv("DATABASE_URL")

# ==== Scrip Master URL ====
SCRIP_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

# Cache for scrip master
SCRIP_MASTER_CACHE = None


def get_scrip_master():
    """Fetch and cache scrip master"""
    global SCRIP_MASTER_CACHE
    if SCRIP_MASTER_CACHE is None:
        logger.info("📥 Fetching Angel One Scrip Master...")
        response = requests.get(SCRIP_MASTER_URL)
        SCRIP_MASTER_CACHE = response.json()
        logger.info(f"✅ Loaded {len(SCRIP_MASTER_CACHE)} instruments")
    return SCRIP_MASTER_CACHE


def get_symbol_token(symbol):
    """Get Angel One token for a stock symbol"""
    scrip_master = get_scrip_master()
    
    # Map our symbol names to Angel One names
    symbol_map = {
        "NIFTY": ("99926000", "NSE"),  # NIFTY 50 Index
        "WIPRO": ("3787", "NSE"),
        "ADANIPOWER": ("17388", "NSE"),
        "VEDL": ("3063", "NSE"),
        "RELIANCE": ("2885", "NSE"),  # Reliance Industries
    }
    
    if symbol in symbol_map:
        return symbol_map[symbol]
    
    # Search in scrip master
    for item in scrip_master:
        if item.get("symbol") == f"{symbol}-EQ" and item["exch_seg"] == "NSE":
            return (item["token"], "NSE")
    
    return (None, None)


def fetch_data_in_chunks(smartApi, token, exchange, start_date, end_date, interval="ONE_MINUTE"):
    """Fetch historical data in chunks from Angel One"""
    all_data = []
    current_start = start_date

    while current_start < end_date:
        current_end = current_start + timedelta(days=30)  # 30-day chunks
        if current_end > end_date:
            current_end = end_date

        from_str = current_start.strftime("%Y-%m-%d 09:15")
        to_str = current_end.strftime("%Y-%m-%d 15:30")

        params = {
            "exchange": exchange,
            "symboltoken": token,
            "interval": interval,
            "fromdate": from_str,
            "todate": to_str,
        }
        
        try:
            result = smartApi.getCandleData(params)
            if result and "data" in result and result["data"]:
                all_data.extend(result["data"])
                logger.info(f"    ✅ Fetched {len(result['data'])} candles ({from_str[:10]} to {to_str[:10]})")
            else:
                logger.debug(f"    ⚠️  No data for {from_str[:10]} to {to_str[:10]}")
        except Exception as e:
            logger.error(f"    ❌ Error: {e}")

        current_start = current_end
        time.sleep(0.3)  # Rate limiting

    return all_data


def insert_to_db(stock_id, data, conn):
    """Insert fetched data into database"""
    if not data:
        return 0

    cursor = conn.cursor()

    # Prepare records
    records = []
    for candle in data:
        try:
            timestamp_str = candle[0]
            # Angel One returns IST timestamps - keep as-is
            if '+' in timestamp_str:
                timestamp_str = timestamp_str.split('+')[0]
            elif 'Z' in timestamp_str:
                timestamp_str = timestamp_str.replace('Z', '')
            
            timestamp = datetime.fromisoformat(timestamp_str)
            
            record = (
                stock_id,
                timestamp,
                float(candle[1]),  # open
                float(candle[2]),  # high
                float(candle[3]),  # low
                float(candle[4]),  # close
                int(candle[5])     # volume
            )
            records.append(record)
        except Exception as e:
            continue

    # Insert with upsert
    insert_query = """
        INSERT INTO "StockPrice" 
        (id, "stockId", timestamp, open, high, low, close, volume, "createdAt")
        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT ("stockId", timestamp) DO NOTHING
    """

    try:
        execute_batch(cursor, insert_query, records, page_size=1000)
        conn.commit()
        cursor.close()
        return len(records)
    except Exception as e:
        logger.error(f"    ❌ Insert error: {e}")
        conn.rollback()
        cursor.close()
        return 0


def add_reliance_stock(conn):
    """Add RELIANCE stock to database if not exists"""
    cursor = conn.cursor()
    
    # Check if exists
    cursor.execute('SELECT id FROM "Stock" WHERE symbol = %s', ('RELIANCE',))
    result = cursor.fetchone()
    
    if result:
        logger.info("✅ RELIANCE stock already exists")
        cursor.close()
        return result[0]
    
    # Add new stock
    cursor.execute('''
        INSERT INTO "Stock" (id, symbol, name, exchange, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), %s, %s, %s, NOW(), NOW())
        RETURNING id
    ''', ('RELIANCE', 'Reliance Industries', 'NSE'))
    
    stock_id = cursor.fetchone()[0]
    conn.commit()
    cursor.close()
    
    logger.info(f"✅ Added RELIANCE stock with ID: {stock_id}")
    return stock_id


def main():
    logger.info("=" * 70)
    logger.info("🚀 FETCHING HISTORICAL DATA (2023-2026)")
    logger.info("=" * 70)

    # Connect to database
    try:
        conn = psycopg2.connect(AZURE_DATABASE_URL)
        cursor = conn.cursor()
        logger.info("✅ Connected to Azure PostgreSQL")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return

    # Add RELIANCE stock first
    reliance_id = add_reliance_stock(conn)

    # Get all stocks with their date ranges
    cursor.execute('''
        SELECT s.id, s.symbol, s.name, MIN(sp.timestamp) as earliest
        FROM "Stock" s
        LEFT JOIN "StockPrice" sp ON s.id = sp."stockId"
        GROUP BY s.id, s.symbol, s.name
        ORDER BY s.symbol
    ''')
    stocks = cursor.fetchall()
    cursor.close()

    logger.info(f"\n📊 Found {len(stocks)} stocks to process:")
    for stock in stocks:
        earliest = stock[3] if stock[3] else "No data"
        logger.info(f"   • {stock[1]} ({stock[2]}) - Earliest: {earliest}")

    # Initialize SmartAPI
    smartApi = SmartConnect(api_key=API_KEY)

    # Generate TOTP
    try:
        totp = pyotp.TOTP(TOTP_TOKEN).now()
    except Exception as e:
        logger.error(f"❌ Invalid TOTP Token: {e}")
        conn.close()
        return

    # Authenticate
    data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)

    if not data.get('status'):
        logger.error(f"❌ Authentication Failed: {data}")
        conn.close()
        return

    logger.info("\n✅ Authenticated with Angel One")
    
    # Define date ranges
    start_2023 = datetime(2023, 1, 1)
    today = datetime.now()
    
    total_inserted = 0

    # Process each stock
    for stock_id, symbol, name, earliest_data in stocks:
        logger.info(f"\n{'='*60}")
        logger.info(f"📈 Processing: {symbol} ({name})")
        
        # Get token
        token, exchange = get_symbol_token(symbol)
        
        if not token:
            logger.warning(f"   ⚠️  Could not find token for {symbol}, skipping...")
            continue
        
        logger.info(f"   Token: {token}, Exchange: {exchange}")
        
        # Determine what data to fetch
        if earliest_data is None:
            # No data - fetch from 2023 to today (RELIANCE case)
            fetch_start = start_2023
            fetch_end = today
            logger.info(f"   📅 Fetching FULL history: {fetch_start.date()} to {fetch_end.date()}")
        else:
            # Has data - fetch from 2023 to day before earliest
            fetch_start = start_2023
            fetch_end = earliest_data - timedelta(days=1)
            
            if fetch_start >= fetch_end:
                logger.info(f"   ✅ Already has data from 2023, skipping...")
                continue
            
            logger.info(f"   📅 Fetching missing data: {fetch_start.date()} to {fetch_end.date()}")
        
        # Fetch data
        try:
            data = fetch_data_in_chunks(smartApi, token, exchange, fetch_start, fetch_end)
            
            if data:
                inserted = insert_to_db(stock_id, data, conn)
                total_inserted += inserted
                logger.info(f"   ✅ Inserted {inserted} records for {symbol}")
            else:
                logger.info(f"   ℹ️  No data available for {symbol}")
        except Exception as e:
            logger.error(f"   ❌ Error fetching {symbol}: {e}")

    # Logout
    try:
        smartApi.terminateSession(CLIENT_ID)
        logger.info("\n✅ Logged out from Angel One")
    except Exception as e:
        logger.warning(f"⚠️  Logout warning: {e}")

    conn.close()
    logger.info("\n" + "=" * 70)
    logger.info(f"🎉 DONE! Total records inserted: {total_inserted}")
    logger.info("=" * 70)


if __name__ == "__main__":
    main()
