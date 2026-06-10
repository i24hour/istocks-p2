#!/usr/bin/env python3
"""
Calculate Supertrend indicator for all stock data in the database.

Supertrend Formula:
- Period: 10 (uses ATR)
- Multiplier: 3

Supertrend Direction:
- 1 = GREEN (bullish/uptrend)
- -1 = RED (bearish/downtrend)
"""

import os
import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv
import pandas as pd
import numpy as np
from datetime import datetime

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')

def get_connection():
    """Create database connection from DATABASE_URL"""
    return psycopg2.connect(DATABASE_URL)

def calculate_supertrend(df, period=10, multiplier=3):
    """
    Calculate Supertrend indicator.
    
    Args:
        df: DataFrame with columns: high, low, close
        period: ATR period (default 10)
        multiplier: Band multiplier (default 3)
    
    Returns:
        DataFrame with supertrend and supertrendDirection columns added
    """
    df = df.copy().reset_index(drop=True)
    n = len(df)
    
    # Convert to numpy for speed
    high = df['high'].astype(float).values
    low = df['low'].astype(float).values
    close = df['close'].astype(float).values
    
    # Calculate True Range
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        hl = high[i] - low[i]
        hc = abs(high[i] - close[i-1])
        lc = abs(low[i] - close[i-1])
        tr[i] = max(hl, hc, lc)
    
    # Calculate ATR (Simple Moving Average of TR)
    atr = np.zeros(n)
    atr[:period] = np.nan
    for i in range(period, n):
        atr[i] = np.mean(tr[i-period+1:i+1])
    
    # Calculate basic bands
    hl2 = (high + low) / 2
    basic_upper = hl2 + (multiplier * atr)
    basic_lower = hl2 - (multiplier * atr)
    
    # Initialize arrays
    final_upper = np.zeros(n)
    final_lower = np.zeros(n)
    supertrend = np.zeros(n)
    direction = np.zeros(n)
    
    # First valid index
    first_valid = period
    
    # Initialize
    final_upper[first_valid] = basic_upper[first_valid]
    final_lower[first_valid] = basic_lower[first_valid]
    supertrend[first_valid] = final_lower[first_valid]  # Start bullish
    direction[first_valid] = 1
    
    # Calculate for remaining
    for i in range(first_valid + 1, n):
        # Final Upper Band
        if basic_upper[i] < final_upper[i-1] or close[i-1] > final_upper[i-1]:
            final_upper[i] = basic_upper[i]
        else:
            final_upper[i] = final_upper[i-1]
        
        # Final Lower Band
        if basic_lower[i] > final_lower[i-1] or close[i-1] < final_lower[i-1]:
            final_lower[i] = basic_lower[i]
        else:
            final_lower[i] = final_lower[i-1]
        
        # Supertrend
        if supertrend[i-1] == final_upper[i-1]:
            # Was bearish
            if close[i] <= final_upper[i]:
                supertrend[i] = final_upper[i]
                direction[i] = -1
            else:
                supertrend[i] = final_lower[i]
                direction[i] = 1
        else:
            # Was bullish
            if close[i] >= final_lower[i]:
                supertrend[i] = final_lower[i]
                direction[i] = 1
            else:
                supertrend[i] = final_upper[i]
                direction[i] = -1
    
    # Set invalid period values to NaN
    supertrend[:first_valid] = np.nan
    direction[:first_valid] = np.nan
    
    result = pd.DataFrame({
        'supertrend': supertrend,
        'supertrendDirection': direction
    })
    
    return result

def process_stock(conn, stock_id, stock_symbol):
    """Process supertrend calculation for a single stock"""
    print(f"\nProcessing {stock_symbol}...")
    
    # Fetch price data using cursor directly (avoids SQLAlchemy warning)
    cursor = conn.cursor()
    query = """
        SELECT id, timestamp, high, low, close, atr
        FROM "StockPrice"
        WHERE "stockId" = %s
        ORDER BY timestamp ASC
    """
    cursor.execute(query, (stock_id,))
    rows = cursor.fetchall()
    cursor.close()
    
    if len(rows) < 15:
        print(f"  Skipping - only {len(rows)} records (need at least 15)")
        return 0
    
    # Convert to DataFrame
    df = pd.DataFrame(rows, columns=['id', 'timestamp', 'high', 'low', 'close', 'atr'])
    
    print(f"  Found {len(df)} price records")
    
    # Calculate supertrend
    result = calculate_supertrend(df)
    
    # Merge back with IDs
    df['supertrend'] = result['supertrend']
    df['supertrendDirection'] = result['supertrendDirection']
    
    # Filter out NaN values
    update_df = df[df['supertrend'].notna()][['id', 'supertrend', 'supertrendDirection']]
    
    if len(update_df) == 0:
        print("  No valid supertrend values calculated")
        return 0
    
    print(f"  Calculated {len(update_df)} supertrend values")
    
    # Update database
    cursor = conn.cursor()
    update_query = """
        UPDATE "StockPrice"
        SET supertrend = %s, "supertrendDirection" = %s
        WHERE id = %s
    """
    
    updates = [(row['supertrend'], int(row['supertrendDirection']), row['id']) 
               for _, row in update_df.iterrows()]
    
    execute_batch(cursor, update_query, updates, page_size=1000)
    conn.commit()
    cursor.close()
    
    print(f"  ✓ Updated {len(updates)} records")
    
    # Show sample
    last_row = update_df.iloc[-1]
    direction = "🟢 GREEN (Bullish)" if last_row['supertrendDirection'] == 1 else "🔴 RED (Bearish)"
    print(f"  Latest: Supertrend={last_row['supertrend']:.2f}, Direction={direction}")
    
    return len(updates)

def main():
    print("=" * 60)
    print("SUPERTREND CALCULATOR")
    print("=" * 60)
    print(f"Started at: {datetime.now()}")
    print(f"Settings: Period=10, Multiplier=3")
    
    conn = get_connection()
    
    # Get all stocks
    cursor = conn.cursor()
    cursor.execute('SELECT id, symbol FROM "Stock" ORDER BY symbol')
    stocks = cursor.fetchall()
    cursor.close()
    
    print(f"\nFound {len(stocks)} stocks to process")
    
    total_updated = 0
    for stock_id, symbol in stocks:
        try:
            updated = process_stock(conn, stock_id, symbol)
            total_updated += updated
        except Exception as e:
            print(f"  ERROR: {e}")
            conn.rollback()
    
    conn.close()
    
    print("\n" + "=" * 60)
    print(f"COMPLETE! Updated {total_updated} total records")
    print(f"Finished at: {datetime.now()}")
    print("=" * 60)

if __name__ == "__main__":
    main()
