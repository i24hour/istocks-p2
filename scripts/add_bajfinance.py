import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cursor = conn.cursor()

# Check if BAJFINANCE already exists
cursor.execute('SELECT id FROM "Stock" WHERE symbol = %s', ('BAJFINANCE',))
existing = cursor.fetchone()

if existing:
    print(f"✅ BAJFINANCE already exists with ID: {existing[0]}")
else:
    # Insert BAJFINANCE
    cursor.execute('''
        INSERT INTO "Stock" (id, symbol, name, exchange, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), %s, %s, %s, NOW(), NOW())
        RETURNING id
    ''', ('BAJFINANCE', 'Bajaj Finance Ltd', 'NSE'))
    stock_id = cursor.fetchone()[0]
    conn.commit()
    print(f"✅ Added BAJFINANCE stock with ID: {stock_id}")

conn.close()
