
import psycopg2
import os

# ==== Database (Azure) ====
DATABASE_URL = os.getenv("DATABASE_URL")

def check_range():
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    print("Checking Data Range in StockPrice...")
    
    # Global Range
    cursor.execute('SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM "StockPrice"')
    min_ts, max_ts, count = cursor.fetchone()
    
    print(f"\n📊 Total Records: {count}")
    print(f"📅 Start Date: {min_ts}")
    print(f"📅 End Date:   {max_ts}")
    
    # Range by Top 3 Stocks (to see if uneven)
    print("\n--- By Stock Sample ---")
    cursor.execute('''
        SELECT s.symbol, MIN(p.timestamp), MAX(p.timestamp)
        FROM "StockPrice" p
        JOIN "Stock" s ON p."stockId" = s.id
        WHERE s.symbol IN ('HDFCBANK', 'RELIANCE', 'NIFTY')
        GROUP BY s.symbol
    ''')
    for row in cursor.fetchall():
        print(f"{row[0]}: {row[1]}  ->  {row[2]}")

    conn.close()

if __name__ == "__main__":
    check_range()
