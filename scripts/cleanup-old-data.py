#!/usr/bin/env python3
"""
Cleanup Old Data Script
-----------------------
Deletes stock price data older than 5 years to maintain a rolling window.
This script should be run periodically (e.g., weekly or monthly) via cron.
"""

import psycopg2
from logzero import logger
from datetime import datetime, timedelta
import os

# ==== Database (Azure) ====
DATABASE_URL = os.getenv("DATABASE_URL")

def cleanup_old_data():
    """Delete data older than 5 years"""
    logger.info("="*70)
    logger.info("🧹 STORAGE CLEANUP - Removing data older than 5 years")
    logger.info("="*70)

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        logger.info("✅ Connected to Database")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return

    # Calculate cutoff date
    cutoff_date = datetime.now() - timedelta(days=5*365)
    cutoff_str = cutoff_date.strftime("%Y-%m-%d %H:%M:%S")
    
    logger.info(f"📅 Cutoff Date: {cutoff_str}")
    logger.info("   (All 1-minute candle data before this date will be permanently deleted)")

    # Count rows to be deleted first
    try:
        cursor.execute('SELECT COUNT(*) FROM "StockPrice" WHERE timestamp < %s', (cutoff_date,))
        count = cursor.fetchone()[0]
        logger.info(f"📊 Found {count} records older than 5 years")
        
        if count == 0:
            logger.info("✨ No data to clean up. Database is within retention limits.")
            conn.close()
            return
            
        # Execute Deletion
        logger.info("🚀 Starting deletion... this might take a while.")
        cursor.execute('DELETE FROM "StockPrice" WHERE timestamp < %s', (cutoff_date,))
        deleted_rows = cursor.rowcount
        conn.commit()
        
        logger.info(f"✅ Successfully deleted {deleted_rows} records.")
        
    except Exception as e:
        logger.error(f"❌ Error during cleanup: {e}")
        conn.rollback()
    
    cursor.close()
    conn.close()
    logger.info("="*70)

if __name__ == "__main__":
    cleanup_old_data()
