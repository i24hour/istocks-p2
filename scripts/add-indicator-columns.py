#!/usr/bin/env python3
"""
Add the 35 new TradingView-equivalent indicator columns to StockPrice table.
Safe to run multiple times (IF NOT EXISTS).
"""
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

NEW_COLUMNS = [
    # Moving Averages (extra)
    ("wma20",          "DOUBLE PRECISION"),
    ("dema20",         "DOUBLE PRECISION"),
    ("tema20",         "DOUBLE PRECISION"),
    ("hma20",          "DOUBLE PRECISION"),
    ("vwma20",         "DOUBLE PRECISION"),
    # Trend
    ("trix",           "DOUBLE PRECISION"),
    ("kst",            "DOUBLE PRECISION"),
    ("kstSignal",      "DOUBLE PRECISION"),
    ("aroonUp",        "DOUBLE PRECISION"),
    ("aroonDown",      "DOUBLE PRECISION"),
    ("aroonOsc",       "DOUBLE PRECISION"),
    ("psar",           "DOUBLE PRECISION"),
    ("psarSignal",     "INTEGER"),
    ("ichimokuConv",   "DOUBLE PRECISION"),
    ("ichimokuBase",   "DOUBLE PRECISION"),
    ("ichimokuLeadA",  "DOUBLE PRECISION"),
    ("ichimokuLeadB",  "DOUBLE PRECISION"),
    ("ichimokuLagging","DOUBLE PRECISION"),
    # Volume
    ("mfi",            "DOUBLE PRECISION"),
    ("cmf",            "DOUBLE PRECISION"),
    ("pvt",            "DOUBLE PRECISION"),
    ("eom",            "DOUBLE PRECISION"),
    # Oscillators
    ("ao",             "DOUBLE PRECISION"),
    ("uo",             "DOUBLE PRECISION"),
    ("cmo",            "DOUBLE PRECISION"),
    ("tsi",            "DOUBLE PRECISION"),
    ("ppo",            "DOUBLE PRECISION"),
    ("dpo",            "DOUBLE PRECISION"),
    # Volatility / Channels
    ("kcUpper",        "DOUBLE PRECISION"),
    ("kcMiddle",       "DOUBLE PRECISION"),
    ("kcLower",        "DOUBLE PRECISION"),
    ("dcUpper",        "DOUBLE PRECISION"),
    ("dcMiddle",       "DOUBLE PRECISION"),
    ("dcLower",        "DOUBLE PRECISION"),
    ("stdDev20",       "DOUBLE PRECISION"),
]

def run():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    added, skipped = 0, 0
    for col, dtype in NEW_COLUMNS:
        try:
            cur.execute(f'ALTER TABLE "StockPrice" ADD COLUMN IF NOT EXISTS "{col}" {dtype}')
            conn.commit()
            print(f"  ✅ {col} ({dtype})")
            added += 1
        except Exception as e:
            conn.rollback()
            print(f"  ⚠️  {col}: {e}")
            skipped += 1
    cur.close()
    conn.close()
    print(f"\nDone — added: {added}, skipped: {skipped}")

if __name__ == "__main__":
    print("Adding 35 new indicator columns to StockPrice...\n")
    run()
