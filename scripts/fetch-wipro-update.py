
import os
import time
from datetime import datetime, timedelta
import pytz
from SmartApi.smartConnect import SmartConnect
import pyotp
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env')

# Configuration
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")
DATABASE_URL = os.getenv("DATABASE_URL")

WIPRO_TOKEN = "3787"  # Wipro token

def fetch_wipro_update():
    # Initialize Database
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    # Initialize Angel One
    smartApi = SmartConnect(api_key=API_KEY)
    totp = pyotp.TOTP(TOTP_TOKEN).now()
    data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)
    
    if not data['status']:
        print(f"❌ Login failed: {data['message']}")
        return

    print("✅ Login successful")
    
    # Get Wipro stock ID
    cur.execute("SELECT id FROM \"Stock\" WHERE symbol = 'WIPRO'")
    stock_id = cur.fetchone()[0]
    if not stock_id:
        print("❌ Wipro stock not found in DB")
        return

    # Define time range: Nov 21, 2025 to Now
    start_dt = datetime(2025, 11, 21, 9, 15, tzinfo=pytz.timezone('Asia/Kolkata'))
    end_dt = datetime.now(pytz.timezone('Asia/Kolkata'))
    
    print(f"📅 Fetching Wipro data from {start_dt} to {end_dt}")
    
    current_dt = start_dt
    total_fetched = 0
    
    while current_dt < end_dt:
        next_dt = min(current_dt + timedelta(days=20), end_dt)
        
        historicParam = {
            "exchange": "NSE",
            "symboltoken": WIPRO_TOKEN,
            "interval": "ONE_MINUTE",
            "fromdate": current_dt.strftime("%Y-%m-%d %H:%M"),
            "todate": next_dt.strftime("%Y-%m-%d %H:%M")
        }
        
        try:
            response = smartApi.getCandleData(historicParam)
            if response['status'] and response['data']:
                records = response['data']
                print(f"   Fetched {len(records)} records ({current_dt.date()} to {next_dt.date()})")
                
                # Save to DB
                for record in records:
                    timestamp = datetime.strptime(record[0], "%Y-%m-%dT%H:%M:%S%z")
                    
                    cur.execute("""
                        INSERT INTO "StockPrice" (
                            id, "stockId", timestamp, open, high, low, close, volume, "createdAt"
                        ) VALUES (
                            gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, NOW()
                        )
                        ON CONFLICT ("stockId", timestamp) DO UPDATE SET
                            open = EXCLUDED.open,
                            high = EXCLUDED.high,
                            low = EXCLUDED.low,
                            close = EXCLUDED.close,
                            volume = EXCLUDED.volume
                    """, (
                        stock_id, timestamp, 
                        float(record[1]), float(record[2]), float(record[3]), float(record[4]), int(record[5])
                    ))
                
                conn.commit()
                total_fetched += len(records)
            else:
                print(f"   ⚠️ No data for period {current_dt.date()}")
                
        except Exception as e:
            print(f"   ❌ Error: {e}")
            conn.rollback()
            
        current_dt = next_dt
        time.sleep(0.5) # Rate limit
        
    print(f"\n✅ Update complete! Total records fetched: {total_fetched}")
    cur.close()
    conn.close()

if __name__ == "__main__":
    fetch_wipro_update()
