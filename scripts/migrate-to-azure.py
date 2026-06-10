#!/usr/bin/env python3
"""
Migrate data from Neon PostgreSQL to Azure PostgreSQL
"""

import os
import psycopg2
from psycopg2.extras import execute_batch
from datetime import datetime

# Source: Neon PostgreSQL (set NEON_DATABASE_URL in environment)
NEON_URL = os.getenv("NEON_DATABASE_URL")
if not NEON_URL:
    raise SystemExit("NEON_DATABASE_URL is required")

# Target: Azure PostgreSQL  
AZURE_URL = os.getenv("DATABASE_URL")
if not AZURE_URL:
    raise SystemExit("DATABASE_URL is required")

def migrate_table(table_name, columns, source_conn, target_conn, batch_size=1000):
    """Migrate a single table"""
    print(f"\n📦 Migrating {table_name}...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    # Get count
    source_cur.execute(f'SELECT COUNT(*) FROM "{table_name}"')
    total = source_cur.fetchone()[0]
    print(f"   Total records: {total}")
    
    if total == 0:
        print(f"   ⏭️  Skipping (empty)")
        return 0
    
    # Fetch all data
    cols_str = ', '.join([f'"{c}"' for c in columns])
    source_cur.execute(f'SELECT {cols_str} FROM "{table_name}"')
    rows = source_cur.fetchall()
    
    # Insert into target
    placeholders = ', '.join(['%s'] * len(columns))
    insert_sql = f'INSERT INTO "{table_name}" ({cols_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
    
    try:
        execute_batch(target_cur, insert_sql, rows, page_size=batch_size)
        target_conn.commit()
        print(f"   ✅ Migrated {len(rows)} records")
        return len(rows)
    except Exception as e:
        print(f"   ❌ Error: {e}")
        target_conn.rollback()
        return 0

def main():
    print("=" * 60)
    print("🚀 NEON → AZURE POSTGRESQL MIGRATION")
    print("=" * 60)
    
    # Connect to both databases
    print("\n📡 Connecting to databases...")
    source_conn = psycopg2.connect(NEON_URL)
    target_conn = psycopg2.connect(AZURE_URL)
    print("   ✅ Connected to Neon (source)")
    print("   ✅ Connected to Azure (target)")
    
    total_migrated = 0
    
    # Tables and their columns (in order of dependencies)
    tables = [
        ("Stock", ["id", "symbol", "name", "exchange", "createdAt", "updatedAt"]),
        ("User", ["id", "name", "email", "emailVerified", "password", "image", "createdAt", "updatedAt"]),
        ("Account", ["id", "userId", "type", "provider", "providerAccountId", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"]),
        ("Session", ["id", "sessionToken", "userId", "expires"]),
        ("VerificationToken", ["identifier", "token", "expires"]),
        ("StockPrice", ["id", "stockId", "timestamp", "open", "high", "low", "close", "volume", "sma20", "sma50", "sma200", "ema12", "ema26", "macd", "macdSignal", "macdHistogram", "adx", "plusDI", "minusDI", "rsi", "stochK", "stochD", "cci", "williamsR", "roc", "bbUpper", "bbMiddle", "bbLower", "atr", "obv", "createdAt"]),
        ("StockInsight", ["id", "stockId", "type", "title", "description", "severity", "value", "threshold", "createdAt"]),
        ("ChatSession", ["id", "stockId", "userId", "title", "createdAt", "updatedAt"]),
        ("ChatMessage", ["id", "sessionId", "role", "content", "sql", "createdAt"]),
        ("Strategy", ["id", "name", "description", "code", "logic", "entryRules", "exitRules", "indicators", "timeframe", "tags", "visibility", "isVerified", "version", "authorId", "parentId", "stars", "forks", "views", "createdAt", "updatedAt"]),
        ("Backtest", ["id", "strategyId", "stockId", "userId", "startDate", "endDate", "initialCapital", "finalCapital", "returnPct", "maxDrawdown", "winRate", "totalTrades", "profitFactor", "sharpeRatio", "trades", "equityCurve", "status", "error", "createdAt"]),
        ("StrategyStar", ["id", "strategyId", "userId", "createdAt"]),
    ]
    
    for table_name, columns in tables:
        try:
            migrated = migrate_table(table_name, columns, source_conn, target_conn)
            total_migrated += migrated
        except Exception as e:
            print(f"   ⚠️  Table {table_name} error: {e}")
    
    # Close connections
    source_conn.close()
    target_conn.close()
    
    print("\n" + "=" * 60)
    print(f"🎉 MIGRATION COMPLETE! Total records: {total_migrated}")
    print("=" * 60)

if __name__ == "__main__":
    main()
