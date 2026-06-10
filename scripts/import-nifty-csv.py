import os
#!/usr/bin/env python3
"""
Import NIFTY 50 Index data from CSV to Azure PostgreSQL database
"""

import csv
import psycopg2
from psycopg2.extras import execute_batch
from datetime import datetime
from logzero import logger

# Azure PostgreSQL connection
# ==== Database (Azure) ====
DATABASE_URL = os.getenv("DATABASE_URL")

# NIFTY 50 Index stock ID in Database
STOCK_ID = "1314a70d-e1cb-476d-851a-3a5f84ad8f74"

# CSV file path
CSV_FILE = "/Users/priyanshu/Desktop/Desktop/Github/istocks-p/NIFTY_historical_data.csv"

def import_csv_to_db():
    """Import CSV data to Azure database"""
    logger.info("🚀 Starting NIFTY CSV import to Azure database")
    
    # Connect to database
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        logger.info("✅ Connected to Azure PostgreSQL database")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return
    
    # Read CSV and prepare records
    records = []
    with open(CSV_FILE, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                # Parse timestamp
                timestamp_str = row['Timestamp'].strip()
                
                # Handle timezone
                if '+' in timestamp_str:
                    timestamp = datetime.fromisoformat(timestamp_str)
                    timestamp = timestamp.replace(tzinfo=None)
                else:
                    timestamp = datetime.fromisoformat(timestamp_str)
                
                record = (
                    STOCK_ID,
                    timestamp,
                    float(row['Open']),
                    float(row['High']),
                    float(row['Low']),
                    float(row['Close']),
                    int(row['Volume'])
                )
                records.append(record)
                
            except Exception as e:
                logger.warning(f"⚠️  Error parsing row: {row}, Error: {e}")
                continue
    
    logger.info(f"📊 Parsed {len(records)} records from CSV")
    
    # Insert in batches
    insert_query = """
        INSERT INTO "StockPrice" 
        (id, "stockId", timestamp, open, high, low, close, volume, "createdAt")
        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT ("stockId", timestamp) DO NOTHING
    """
    
    batch_size = 5000
    total_inserted = 0
    
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            execute_batch(cursor, insert_query, batch, page_size=1000)
            conn.commit()
            total_inserted += len(batch)
            logger.info(f"✅ Inserted batch {i//batch_size + 1}: {len(batch)} records (Total: {total_inserted})")
        except Exception as e:
            logger.error(f"❌ Error inserting batch: {e}")
            conn.rollback()
    
    # Close connection
    cursor.close()
    conn.close()
    logger.info(f"✅ Database connection closed")
    logger.info(f"🏁 Successfully inserted {total_inserted} NIFTY records into Database!")

if __name__ == "__main__":
    import_csv_to_db()
