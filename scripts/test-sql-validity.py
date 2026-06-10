
import psycopg2
import json
from datetime import datetime
import os

# Credentials from known working script
DATABASE_URL = os.getenv("DATABASE_URL")

def test_query():
    print("🚀 Connecting to Azure DB...")
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        print("✅ Connected!")
        
        # The EXACT query we are using in route.ts
        sql = """
      SELECT 
        s."id" AS "stockId", 
        p."close", 
        p."volume"::text, 
        p."timestamp", 
        p."rn"
      FROM "Stock" s
      CROSS JOIN LATERAL (
        SELECT 
          "close", 
          "volume", 
          "timestamp", 
          CAST(ROW_NUMBER() OVER (ORDER BY "timestamp" DESC) AS INTEGER) AS "rn"
        FROM "StockPrice"
        WHERE "stockId" = s."id"
        ORDER BY "timestamp" DESC
        LIMIT 2
      ) p
        """
        
        print("⚡ Executing SQL Query...")
        cursor.execute(sql)
        rows = cursor.fetchall()
        print(f"✅ Query successful! Returned {len(rows)} rows.")
        
        if len(rows) > 0:
            print("🔍 Sample Row 0:", rows[0])
            # Check types
            print("   - stockId type:", type(rows[0][0]))
            print("   - close type:", type(rows[0][1]))
            print("   - volume type:", type(rows[0][2])) # Should be str
            print("   - timestamp type:", type(rows[0][3]))
            print("   - rn type:", type(rows[0][4])) # Should be int
            
    except Exception as e:
        print("❌ SQL/DB Error:", e)
    finally:
        if conn: conn.close()

if __name__ == "__main__":
    test_query()
