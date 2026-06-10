#!/usr/bin/env python3
"""
seed-angel-tokens.py
---------------------
Downloads the Angel One Scrip Master (publicly available JSON) and populates
the Stock table with angelToken + exchange for every NSE-listed equity.

What it does:
  1. Fetches ~100k rows from Angel One scrip master
  2. Filters to NSE equities only   (exch_seg == "NSE", instrumenttype == "")
  3. Strips "-EQ" suffix from symbol  (e.g. "RELIANCE-EQ" → "RELIANCE")
  4. Upserts each row into the Stock table:
       - If stock exists (by symbol): updates angelToken + name
       - If stock does not exist    : creates a new row

Usage:
  python3 scripts/seed-angel-tokens.py

  The script reads DATABASE_URL from .env automatically.

Dependencies:
  pip install psycopg2-binary requests python-dotenv
"""

import os
import sys
import time
import requests
import psycopg2
from psycopg2.extras import execute_values

# ── Load .env ──────────────────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("❌  DATABASE_URL not found in .env")
    sys.exit(1)

# ── Angel One Scrip Master URL ─────────────────────────────────────────────────
SCRIP_MASTER_URL = (
    "https://margincalculator.angelbroking.com"
    "/OpenAPI_File/files/OpenAPIScripMaster.json"
)

# ── Helpers ────────────────────────────────────────────────────────────────────

def fetch_scrip_master():
    print("⬇️   Downloading Angel One Scrip Master (this takes ~10s)...")
    r = requests.get(SCRIP_MASTER_URL, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    data = r.json()
    print(f"✅  Downloaded {len(data):,} total instruments")
    return data


def filter_nse_equities(data):
    """Keep only NSE spot equities:
       - exch_seg  == "NSE"
       - instrumenttype == "" (not futures/options/currency)
       - symbol ends with "-EQ"
    """
    equities = [
        row for row in data
        if row.get("exch_seg") == "NSE"
        and row.get("instrumenttype", "") == ""
        and str(row.get("symbol", "")).endswith("-EQ")
    ]
    print(f"✅  Filtered to {len(equities):,} NSE equity instruments")
    return equities


def build_rows(equities):
    """Return list of (symbol, name, exchange, angel_token) tuples."""
    rows = []
    seen = set()
    for row in equities:
        raw_symbol = str(row["symbol"])                        # e.g. "RELIANCE-EQ"
        symbol = raw_symbol.removesuffix("-EQ").strip().upper()
        if symbol in seen:
            continue
        seen.add(symbol)

        name    = str(row.get("name", symbol)).strip()
        token   = str(row.get("token", "")).strip()
        if not token:
            continue

        rows.append((symbol, name, "NSE", token))

    print(f"✅  Prepared {len(rows):,} unique equity rows")
    return rows


def upsert_to_db(rows):
    """Bulk-upsert into the Stock table using a single statement."""
    conn = psycopg2.connect(DATABASE_URL)
    cur  = conn.cursor()

    # How many already exist?
    cur.execute('SELECT COUNT(*) FROM "Stock"')
    before = cur.fetchone()[0]
    print(f"ℹ️   Stock rows before upsert: {before:,}")

    # Upsert: create row if symbol doesn't exist, update token+name if it does.
    # We use a CTE + CUID-like ID (we rely on gen_random_uuid or cuid).
    # Prisma uses cuid() as default for @id — for new rows we generate a uuid
    # (close enough; Prisma only cares that it's unique text).
    upsert_sql = """
        INSERT INTO "Stock" (id, symbol, name, exchange, "angelToken", "createdAt", "updatedAt")
        VALUES %s
        ON CONFLICT (symbol)
        DO UPDATE SET
            "angelToken" = EXCLUDED."angelToken",
            name         = EXCLUDED.name,
            "updatedAt"  = NOW()
    """

    # We generate a simple pseudo-cuid for new rows:
    # format: c<timestamp_hex><4_random_hex>
    import uuid, datetime

    def new_id():
        return "c" + uuid.uuid4().hex[:24]   # 25 chars, collision-safe

    now = datetime.datetime.utcnow()
    values = [
        (new_id(), symbol, name, exchange, token, now, now)
        for symbol, name, exchange, token in rows
    ]

    BATCH = 500
    total = len(values)
    inserted = 0
    for i in range(0, total, BATCH):
        chunk = values[i:i + BATCH]
        execute_values(cur, upsert_sql, chunk)
        inserted += len(chunk)
        print(f"  ⚡ Upserted {inserted:,}/{total:,}...", end="\r")

    conn.commit()

    cur.execute('SELECT COUNT(*) FROM "Stock"')
    after = cur.fetchone()[0]
    new_rows = after - before
    print(f"\n✅  Done! Stock rows after upsert: {after:,}  (+{new_rows:,} new)")

    cur.close()
    conn.close()


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    t0 = time.time()
    print("=" * 60)
    print("  Angel One Token Seeder — NSE Equity Stock Table")
    print("=" * 60)

    data     = fetch_scrip_master()
    equities = filter_nse_equities(data)
    rows     = build_rows(equities)
    upsert_to_db(rows)

    elapsed = time.time() - t0
    print(f"\n🎉  Completed in {elapsed:.1f}s")
    print("    Run `npx prisma studio` to verify the data.")


if __name__ == "__main__":
    main()
