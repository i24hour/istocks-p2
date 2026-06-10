import time
import os
import json
import uuid
import psycopg2
import requests
import pandas as pd
import pandas_ta as ta
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# We expect DATABASE_URL in .env (passed via deploy)
DB_URL = os.getenv("DATABASE_URL")
# Main API is running locally on port 8080 on the same EC2 instance
API_URL = "http://localhost:8080" 

def get_db_connection():
    return psycopg2.connect(DB_URL)

def fetch_candles(symbol):
    try:
        # Fetch 300 candles to ensure indicators are accurate
        # Using the local fast-api endpoint which proxies to Angel One
        # Timeout to prevent hanging
        r = requests.get(f"{API_URL}/candles?symbol={symbol}&interval=ONE_MINUTE&count=300", timeout=5)
        if r.status_code != 200:
            # print(f"Error fetching candles: {r.status_code} {r.text}")
            return None
            
        d = r.json()
        if d.get('success'):
            df = pd.DataFrame(d['data'])
            # Ensure correct types
            if df.empty: return None
            df['close'] = df['close'].astype(float)
            df['high'] = df['high'].astype(float)
            df['low'] = df['low'].astype(float)
            df['open'] = df['open'].astype(float)
            df['volume'] = df['volume'].astype(float)
            return df
    except Exception as e:
        print(f"Candle fetch exception for {symbol}: {e}")
    return None

def calculate_indicators(df):
    # Calculate common indicators used in conditions
    try:
        # RSI (14)
        df.ta.rsi(length=14, append=True) 
        # MACD (12, 26, 9)
        df.ta.macd(append=True) 
        # SMA (20, 50)
        df.ta.sma(length=20, append=True) 
        df.ta.sma(length=50, append=True) 
        # EMA (20)
        df.ta.ema(length=20, append=True) 
        # ADX (14)
        df.ta.adx(append=True) 
    except Exception as e:
        print(f"Indicator calc error: {e}")
    
    return df

def get_indicator_value(row, name):
    name = name.upper()
    # Map user-friendly names to pandas_ta column names
    if name == 'RSI': return row.get('RSI_14')
    if name == 'MACD': return row.get('MACD_12_26_9')
    if name == 'SMA20': return row.get('SMA_20')
    if name == 'SMA50': return row.get('SMA_50')
    if name == 'EMA20': return row.get('EMA_20')
    if name == 'ADX': return row.get('ADX_14')
    
    # Try generic lookup if key exists directly (e.g. custom names)
    if name in row: return row[name]
    
    return None

def check_conditions(df, conditions):
    if df is None or df.empty: return False
    
    last_row = df.iloc[-1]
    
    for cond in conditions:
        indic = cond.get('indicator', '').upper()
        op = cond.get('operator')
        thresh = float(cond.get('threshold', 0))
        
        val = get_indicator_value(last_row, indic)
        
        # print(f"Checking {indic} {op} {thresh}. Current: {val}")
        
        if val is None:
            # Indicator not found or nan, condition fails
            return False
            
        met = False
        if op in ['<', 'below', 'less than']: met = val < thresh
        elif op in ['>', 'above', 'greater than']: met = val > thresh
        elif op == '<=': met = val <= thresh
        elif op == '>=': met = val >= thresh
        elif op == '=': met = abs(val - thresh) < 0.01
        
        if not met: return False
        
    return True

def execute_trade(conn, order_id, symbol, action, quantity, price, pending_data):
    cursor = conn.cursor()
    try:
        total_value = price * quantity
        
        # 1. Update TradingOrder status
        # Note: Using quoted "TradingOrder" and "executedPrice" to match Prisma default case
        update_query = """
            UPDATE "TradingOrder" 
            SET status = 'EXECUTED', "executedPrice" = %s, "executedAt" = NOW(), "positionValue" = %s
            WHERE id = %s
        """
        cursor.execute(update_query, (price, total_value, order_id))
        
        # 2. Insert Chat Message (History Persistence)
        session_id = pending_data.get('sessionId') if pending_data else None
        
        if session_id:
            msg_id = str(uuid.uuid4())
            # Format a clear success message
            content_text = f"✅ **Auto-Executed**: {action} {quantity} {symbol} @ ₹{price}\nConditions matched. Server-side execution."
            
            insert_msg = """
                INSERT INTO "ChatMessage" (id, "sessionId", role, content, "createdAt")
                VALUES (%s, %s, 'assistant', %s, NOW())
            """
            cursor.execute(insert_msg, (msg_id, session_id, content_text))
            
        conn.commit()
        print(f"[{datetime.now()}] EXECUTED trade {order_id} for {symbol}")
        
    except Exception as e:
        conn.rollback()
        print(f"Failed to execute trade {order_id}: {e}")
    finally:
        cursor.close()

def main():
    print("Starting iStocks Trade Watcher...")
    if not DB_URL:
        print("Error: DATABASE_URL not set in .env")
        return

    while True:
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            # Fetch PENDING trades
            cur.execute('SELECT id, symbol, "entryCondition", "quantity", "orderType" FROM "TradingOrder" WHERE status = \'PENDING\' AND "tradingMode" = \'PAPER\'')
            orders = cur.fetchall()
            
            # Group by symbol to optimize calls? 
            # For now simple loop loop is robust enough for low volume.
            
            for order in orders:
                oid, symbol, cond_json, qty, action = order
                
                # cond_json wraps { conditions: [...], sessionId: ... }
                # It comes from Prisma Json type, so psycopg2 should adapters it to dict
                if not cond_json or 'conditions' not in cond_json:
                    continue
                    
                conditions = cond_json['conditions']
                
                # Fetch Data & Check
                df = fetch_candles(symbol)
                if df is not None and not df.empty:
                    df = calculate_indicators(df)
                    if check_conditions(df, conditions):
                        # Execute!
                        current_price = df.iloc[-1]['close']
                        execute_trade(conn, oid, symbol, action, qty, current_price, cond_json)
            
            cur.close()
            conn.close()
            
        except Exception as e:
            # print(f"Watcher Loop Error: {e}")
            if conn: 
                try: conn.close()
                except: pass
        
        time.sleep(5) # Poll every 5 seconds

if __name__ == "__main__":
    main()
