import os
#!/usr/bin/env python3
"""
Daily Maintenance Script
1. Runs update-all-stocks.py to fetch today's data
2. Deletes data older than 5 years to maintain rolling window
"""

import sys
import subprocess
import psycopg2
from datetime import datetime
from logzero import logger

# ==== Configuration ====
DATABASE_URL = os.getenv("DATABASE_URL")
UPDATE_SCRIPT_PATH = "/opt/istocks-live/scripts/update-all-stocks.py"
PYTHON_PATH = "/opt/istocks-live/venv/bin/python3"

def run_daily_update():
    """Run the stock update script"""
    logger.info("⏰ Starting Daily Update...")
    try:
        # Run update-all-stocks.py
        result = subprocess.run(
            [PYTHON_PATH, UPDATE_SCRIPT_PATH],
            capture_output=True,
            text=True
        )
        
        logger.info(result.stdout)
        
        if result.returncode != 0:
            logger.error(f"❌ Update Script Failed:\n{result.stderr}")
            return False
            
        logger.info("✅ Daily Update Completed Successfully")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error running update script: {e}")
        return False

def cleanup_old_data():
    """Delete data older than 5 years"""
    logger.info("🧹 Starting 5-Year Data Cleanup...")
    
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        # Calculate cutoff date details for logging
        cursor.execute("SELECT NOW() - INTERVAL '5 years'")
        cutoff_date = cursor.fetchone()[0]
        logger.info(f"📅 Deleting data older than: {cutoff_date}")
        
        # Execute Delete
        delete_query = """
        WITH deleted AS (
            DELETE FROM "StockPrice"
            WHERE timestamp < NOW() - INTERVAL '5 years'
            RETURNING *
        )
        SELECT COUNT(*) FROM deleted;
        """
        
        cursor.execute(delete_query)
        deleted_count = cursor.fetchone()[0]
        
        conn.commit()
        cursor.close()
        conn.close()
        
        logger.info(f"✅ Cleanup Complete. Deleted {deleted_count} old records.")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error during cleanup: {e}")
        return False

def main():
    logger.info("="*50)
    logger.info(f"🚀 DAILY MAINTENANCE JOB STARTED: {datetime.now()}")
    logger.info("="*50)
    
    # 1. Update Data
    update_success = run_daily_update()
    
    # 2. Cleanup Old Data (only if update ran, or independent? Let's run independent)
    cleanup_success = cleanup_old_data()
    
    logger.info("="*50)
    if update_success and cleanup_success:
        logger.info("🎉 DAILY JOB COMPLETED SUCCESSFULLY")
    else:
        logger.error("⚠️ DAILY JOB COMPLETED WITH ERRORS")
    logger.info("="*50)

if __name__ == "__main__":
    main()
