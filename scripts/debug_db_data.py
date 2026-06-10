
import psycopg2
import os

# Updated connection string from your script
# ==== Database (Azure) ====
DATABASE_URL = os.getenv("DATABASE_URL")

def check_data():
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # Check HDFC Bank and NIFTY specifically
    symbols = ['HDFCBANK', 'NIFTY', 'ICICIBANK', 'RELIANCE']
    
    print(f"Checking data for: {symbols}")
    
    for sym in symbols:
        print(f"\n--- {sym} ---")
        # 1. Get ID
        cursor.execute('SELECT id, name FROM "Stock" WHERE symbol = %s', (sym,))
        res = cursor.fetchone()
        if not res:
            print(f"❌ Stock not found in 'Stock' table")
            continue
            
        stock_id, name = res
        print(f"ID: {stock_id}, Name: {name}")
        
        # 2. Check recent prices
        cursor.execute("""
            SELECT timestamp, close 
            FROM "StockPrice" 
            WHERE "stockId" = %s 
            ORDER BY timestamp DESC 
            LIMIT 5
        """, (stock_id,))
        prices = cursor.fetchall()
        
        if not prices:
            print("❌ No price data found!")
        else:
            print(f"✅ Found {len(prices)} records. Last 5:")
            for p in prices:
                print(f"   {p[0]} - ₹{p[1]}")

    conn.close()

if __name__ == "__main__":
    check_data()
