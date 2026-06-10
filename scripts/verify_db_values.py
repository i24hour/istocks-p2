
import psycopg2
import os

# Azure DB URL
DATABASE_URL = os.getenv("DATABASE_URL")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # Check NIFTY latest data
    print("\n--- NIFTY LATEST DATA ---")
    cursor.execute("""
        SELECT sp.timestamp, sp.close, sp.rsi, sp.supertrend, sp."supertrendDirection" 
        FROM "StockPrice" sp
        JOIN "Stock" s ON sp."stockId" = s.id
        WHERE s.symbol = 'NIFTY'
        ORDER BY sp.timestamp DESC 
        LIMIT 1
    """)
    row = cursor.fetchone()
    if row:
        print(f"Time: {row[0]}")
        print(f"Close: {row[1]}")
        print(f"RSI: {row[2]}")
        print(f"Supertrend: {row[3]}")
        print(f"Direction: {row[4]}")
    else:
        print("No data found for NIFTY")

    # Check Zomato
    print("\n--- ZOMATO (ETERNAL) LATEST DATA ---")
    cursor.execute("""
        SELECT sp.timestamp, sp.close, sp.rsi, sp.sma20, sp.macd 
        FROM "StockPrice" sp
        JOIN "Stock" s ON sp."stockId" = s.id
        WHERE s.symbol = 'ETERNAL'
        ORDER BY sp.timestamp DESC 
        LIMIT 1
    """)
    row = cursor.fetchone()
    if row:
        print(f"Time: {row[0]}")
        print(f"Close: {row[1]}")
        print(f"RSI: {row[2]}")
        print(f"SMA20: {row[3]}")
        print(f"MACD: {row[4]}")
    else:
         print("No data found for ETERNAL (Zomato)")

    conn.close()

except Exception as e:
    print(f"Error: {e}")
