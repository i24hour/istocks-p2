
import psycopg2
import os

DATABASE_URL = os.getenv("DATABASE_URL")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # Check NIFTY
    cursor.execute("""
        SELECT COUNT(*) FROM "StockPrice" sp
        JOIN "Stock" s ON sp."stockId" = s.id
        WHERE s.symbol = 'NIFTY' AND sp.supertrend IS NOT NULL
    """)
    nifty_count = cursor.fetchone()[0]
    
    # Check Zomato
    cursor.execute("""
        SELECT COUNT(*) FROM "StockPrice" sp
        JOIN "Stock" s ON sp."stockId" = s.id
        WHERE s.symbol = 'ETERNAL' AND sp.supertrend IS NOT NULL
    """)
    zomato_count = cursor.fetchone()[0]
    
    # Check Any
    cursor.execute('SELECT COUNT(*) FROM "StockPrice" WHERE supertrend IS NOT NULL')
    total_count = cursor.fetchone()[0]

    print(f"NIFTY Supertrend Rows: {nifty_count}")
    print(f"ZOMATO Supertrend Rows: {zomato_count}")
    print(f"Total Supertrend Rows: {total_count}")
    
    conn.close()

except Exception as e:
    print(f"Error: {e}")
