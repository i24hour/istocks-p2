import psycopg2
from datetime import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL")

def check():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        print(f"Connected to DB. Querying data ranges...")
        print("-" * 60)
        print(f"{'SYMBOL':<15} {'START DATE':<20} {'END DATE':<20} {'DAYS'}")
        print("-" * 60)
        
        query = """
            SELECT 
                s.symbol, 
                MIN(sp.timestamp) as start_date, 
                MAX(sp.timestamp) as end_date
            FROM "Stock" s
            JOIN "StockPrice" sp ON s.id = sp."stockId"
            GROUP BY s.symbol
            ORDER BY s.symbol
        """
        
        cursor.execute(query)
        rows = cursor.fetchall()
        
        for symbol, start, end in rows:
            days = (end - start).days if start and end else 0
            s_str = start.strftime('%Y-%m-%d') if start else "N/A"
            e_str = end.strftime('%Y-%m-%d') if end else "N/A"
            print(f"{symbol:<15} {s_str:<20} {e_str:<20} {days}")

        print("-" * 60)
        
        # Overall
        cursor.execute('SELECT MIN(timestamp), MAX(timestamp) FROM "StockPrice"')
        overall = cursor.fetchone()
        print(f"\nOVERALL RANGE: {overall[0]}  to  {overall[1]}")
        
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check()
