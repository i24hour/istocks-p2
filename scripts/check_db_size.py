import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

try:
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cursor = conn.cursor()

    print("--- Row Counts ---")
    cursor.execute('SELECT count(*) FROM "Stock"')
    print(f"Stocks: {cursor.fetchone()[0]}")

    cursor.execute('SELECT count(*) FROM "StockPrice"')
    print(f"StockPrice Rows: {cursor.fetchone()[0]}")

    # Check if SqlErrorLog exists
    cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'SqlErrorLog')")
    if cursor.fetchone()[0]:
        cursor.execute('SELECT count(*) FROM "SqlErrorLog"')
        print(f"SqlErrorLog Rows: {cursor.fetchone()[0]}")
    else:
        print("SqlErrorLog Rows: Table does not exist")

    print("\n--- Table Sizes ---")
    query = """
    SELECT
        table_name,
        pg_size_pretty(pg_total_relation_size(quote_ident(table_name))),
        pg_total_relation_size(quote_ident(table_name))
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;
    """
    cursor.execute(query)
    for row in cursor.fetchall():
        print(f"{row[0]}: {row[1]}")

    print(f"\n--- Total Database Size ---")
    cursor.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
    print(f"Total DB Size: {cursor.fetchone()[0]}")

    conn.close()
except Exception as e:
    print(f"Error: {e}")
