import os
#!/usr/bin/env python3
"""
Add SWIGGY stock with historical data (IPO was Nov 2024)
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

# SWIGGY Token (Corrected: SWIGGY-EQ)
SWIGGY_TOKEN = "27066"
SWIGGY_EXCHANGE = "NSE"


def fetch_data_in_chunks(smartApi, token, exchange, start_date, end_date, interval="ONE_MINUTE"):
    """Fetch historical data in chunks from Angel One"""
    all_data = []
    current_start = start_date

    while current_start < end_date:
        current_end = current_start + timedelta(days=30)
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
                logger.info(f"  ✅ Fetched {len(result['data'])} candles ({from_str[:10]} to {to_str[:10]})")
            else:
                logger.debug(f"  ⚠️  No data for {from_str[:10]} to {to_str[:10]}")
        except Exception as e:
            logger.error(f"  ❌ Error: {e}")

        current_start = current_end
        time.sleep(0.3)

    return all_data


def main():
    logger.info("=" * 60)
    logger.info("🛵 ADDING SWIGGY STOCK DATA")
    logger.info("=" * 60)

    # Connect to database
    try:
        conn = psycopg2.connect(AZURE_DATABASE_URL)
        cursor = conn.cursor()
        logger.info("✅ Connected to Azure PostgreSQL")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return

    # Check if SWIGGY exists
    cursor.execute('SELECT id FROM "Stock" WHERE symbol = %s', ('SWIGGY',))
    result = cursor.fetchone()
    
    if result:
        stock_id = result[0]
        logger.info(f"✅ SWIGGY already exists with ID: {stock_id}")
    else:
        # Add SWIGGY stock
        cursor.execute('''
            INSERT INTO "Stock" (id, symbol, name, exchange, "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), %s, %s, %s, NOW(), NOW())
            RETURNING id
        ''', ('SWIGGY', 'Swiggy', 'NSE'))
        stock_id = cursor.fetchone()[0]
        conn.commit()
        logger.info(f"✅ Added SWIGGY stock with ID: {stock_id}")

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

    logger.info("✅ Authenticated with Angel One")

    # SWIGGY IPO was Nov 2024, so start from Nov 2024
    start_date = datetime(2024, 11, 1)
    end_date = datetime.now()
    
    logger.info(f"\n📅 Fetching data: {start_date.date()} to {end_date.date()}")
    
    data = fetch_data_in_chunks(smartApi, SWIGGY_TOKEN, SWIGGY_EXCHANGE, start_date, end_date)
    
    logger.info(f"\n📊 Total candles fetched: {len(data)}")

    if data:
        # Prepare records
        records = []
        for candle in data:
            try:
                timestamp_str = candle[0]
                if '+' in timestamp_str:
                    timestamp_str = timestamp_str.split('+')[0]
                elif 'Z' in timestamp_str:
                    timestamp_str = timestamp_str.replace('Z', '')
                
                timestamp = datetime.fromisoformat(timestamp_str)
                
                record = (
                    stock_id,
                    timestamp,
                    float(candle[1]),
                    float(candle[2]),
                    float(candle[3]),
                    float(candle[4]),
                    int(candle[5])
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
            logger.info(f"✅ Inserted {len(records)} records for SWIGGY")
        except Exception as e:
            logger.error(f"❌ Insert error: {e}")
            conn.rollback()

    # Logout
    try:
        smartApi.terminateSession(CLIENT_ID)
        logger.info("✅ Logged out from Angel One")
    except:
        pass

    conn.close()
    logger.info("\n" + "=" * 60)
    logger.info("🎉 SWIGGY DATA ADDED SUCCESSFULLY!")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
