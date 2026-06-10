#!/usr/bin/env python3
"""
One-time backfill script for stale stocks.
Fetches missing 1-min candles from Angel One and saves to PostgreSQL.
Run manually: python3 scripts/backfill-stale-stocks.py
"""

import os
import requests
import psycopg2
from psycopg2.extras import execute_values
from SmartApi.smartConnect import SmartConnect
import pyotp
from datetime import datetime, timedelta, timezone
import time
import sys

DATABASE_URL = os.getenv("DATABASE_URL")
API_KEY     = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN  = os.getenv("ANGELONE_TOTP_TOKEN")

# All stocks — keep this list up to date with the Stock table
STALE = [
    {"symbol": "ADANIPOWER",  "token": "17388",     "exchange": "NSE"},
    {"symbol": "BAJFINANCE",  "token": "317",        "exchange": "NSE"},
    {"symbol": "ETERNAL",     "token": "5097",       "exchange": "NSE"},
    {"symbol": "HDFCBANK",    "token": "1333",       "exchange": "NSE"},
    {"symbol": "ICICIBANK",   "token": "4963",       "exchange": "NSE"},
    {"symbol": "MIFL",        "token": "537800",     "exchange": "BSE"},
    {"symbol": "NIFTY",       "token": "99926000",   "exchange": "NSE"},
    {"symbol": "REDINGTON",   "token": "14255",      "exchange": "NSE"},
    {"symbol": "RELIANCE",    "token": "2885",       "exchange": "NSE"},
    {"symbol": "SBIN",        "token": "3045",       "exchange": "NSE"},
    {"symbol": "SWIGGY",      "token": "27066",      "exchange": "NSE"},
    {"symbol": "VEDL",        "token": "3063",       "exchange": "NSE"},
    {"symbol": "WIPRO",       "token": "3787",       "exchange": "NSE"},
]

IST = timezone(timedelta(hours=5, minutes=30))

def connect():
    return psycopg2.connect(DATABASE_URL)

def get_stock_id(symbol):
    conn = connect()
    cur = conn.cursor()
    cur.execute('SELECT id FROM "Stock" WHERE symbol = %s', (symbol,))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None

def get_last_timestamp(stock_id):
    """Return the from_dt to use for fetching.
    Normally last_ts + 1 min, but if the last trading day has fewer than
    INCOMPLETE_THRESHOLD candles we rewind to the start of that day to fill gaps."""
    INCOMPLETE_THRESHOLD = 360   # full NSE day = 375, BSE = 375 too
    MARKET_OPEN_UTC  = (3, 45)   # 09:15 IST
    conn = connect()
    cur = conn.cursor()
    cur.execute('SELECT MAX(timestamp) FROM "StockPrice" WHERE "stockId" = %s', (stock_id,))
    row = cur.fetchone()
    if not (row and row[0]):
        conn.close()
        return datetime.now(timezone.utc) - timedelta(days=14)
    ts = row[0]
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    # Check candle count for the last calendar day present in DB
    last_day_start_utc = ts.replace(hour=0, minute=0, second=0, microsecond=0)
    cur.execute(
        'SELECT COUNT(*) FROM "StockPrice" WHERE "stockId" = %s AND timestamp >= %s',
        (stock_id, last_day_start_utc)
    )
    count = cur.fetchone()[0]
    conn.close()
    if count < INCOMPLETE_THRESHOLD:
        # Rewind to market open of that day so we re-fetch the gap
        h, m = MARKET_OPEN_UTC
        rewind = last_day_start_utc.replace(hour=h, minute=m)
        print(f"    ⚠️  Last day has only {count} candles — rewinding to {rewind.astimezone(IST).strftime('%Y-%m-%d %H:%M IST')} to fill gaps")
        return rewind
    return ts + timedelta(minutes=1)

def fetch_candles(smart, token, exchange, from_dt, to_dt):
    """Fetch 1-min candles in 1-day chunks."""
    all_candles = []
    cursor = from_dt
    while cursor < to_dt:
        chunk_end = min(cursor + timedelta(days=1), to_dt)
        from_str = cursor.astimezone(IST).strftime("%Y-%m-%d %H:%M")
        to_str   = chunk_end.astimezone(IST).strftime("%Y-%m-%d %H:%M")
        try:
            resp = smart.getCandleData({
                "exchange": exchange,
                "symboltoken": token,
                "interval": "ONE_MINUTE",
                "fromdate": from_str,
                "todate": to_str,
            })
            candles = resp.get("data") or []
            if candles:
                all_candles.extend(candles)
                print(f"    got {len(candles)} candles ({from_str} → {to_str})")
            else:
                print(f"    no data  ({from_str} → {to_str})")
        except Exception as e:
            print(f"    ⚠️  chunk error: {e}")
        cursor = chunk_end + timedelta(minutes=1)   # +1 min avoids boundary duplicate
        time.sleep(0.35)  # respect Angel One rate limit
    return all_candles

def save_candles(stock_id, candles):
    if not candles:
        return 0
    records = []
    for c in candles:
        try:
            raw = str(c[0]).strip()
            if raw.endswith("Z") or "+" in raw[10:]:
                ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            else:
                ts = datetime.fromisoformat(raw.replace(" ", "T") + "+05:30")
            # Generate deterministic ID: price_<stockId_short>_<yyyyMMddHHmmss>
            ts_utc = ts.astimezone(timezone.utc)
            row_id = f"price_{stock_id[:8]}_{ts_utc.strftime('%Y%m%d%H%M%S')}"
            records.append((
                row_id,
                stock_id, ts,
                float(c[1]), float(c[2]), float(c[3]), float(c[4]), int(c[5])
            ))
        except Exception:
            continue

    conn = connect()
    cur = conn.cursor()
    inserted = 0
    CHUNK = 500
    for i in range(0, len(records), CHUNK):
        execute_values(cur, """
            INSERT INTO "StockPrice" (id, "stockId", timestamp, open, high, low, close, volume)
            VALUES %s
            ON CONFLICT ("stockId", timestamp) DO NOTHING
        """, records[i:i+CHUNK])
        inserted += cur.rowcount
    conn.commit()
    conn.close()
    return inserted

def main():
    print("🔐 Authenticating with Angel One...")
    smart = SmartConnect(api_key=API_KEY)
    totp = pyotp.TOTP(TOTP_TOKEN).now()
    resp = smart.generateSession(CLIENT_ID, SECRET_KEY, totp)
    if not resp.get("status"):
        print(f"❌ Auth failed: {resp}")
        sys.exit(1)
    print("✅ Authenticated\n")

    now_utc = datetime.now(timezone.utc)

    for cfg in STALE:
        sym     = cfg["symbol"]
        token   = cfg["token"]
        exchange = cfg["exchange"]

        stock_id = get_stock_id(sym)
        if not stock_id:
            print(f"⚠️  {sym}: not found in Stock table, skipping")
            continue

        from_dt = get_last_timestamp(stock_id)  # already accounts for incomplete days

        # Don't go further back than 14 days
        floor = now_utc - timedelta(days=14)
        if from_dt < floor:
            from_dt = floor

        if from_dt >= now_utc:
            print(f"✅ {sym}: already up to date")
            continue

        lag_hours = (now_utc - from_dt).total_seconds() / 3600
        print(f"📈 {sym} (token {token}, {exchange}): fetching from {from_dt.astimezone(IST).strftime('%Y-%m-%d %H:%M IST')} ({lag_hours:.1f}h to fill)")

        candles = fetch_candles(smart, token, exchange, from_dt, now_utc)
        if not candles:
            print(f"   ℹ️  no new candles returned\n")
            continue

        inserted = save_candles(stock_id, candles)
        print(f"   ✅ {sym}: saved {inserted}/{len(candles)} new candles\n")

    try:
        smart.terminateSession(CLIENT_ID)
    except Exception:
        pass
    print("🏁 Backfill complete.")

if __name__ == "__main__":
    main()
