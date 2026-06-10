import os
#!/usr/bin/env python3
"""
Recalculate Technical Indicators for all stocks
Fetches all price data, calculates indicators using 'ta' library, and updates the database.
"""

import pandas as pd
import ta
import numpy as np
import psycopg2
from psycopg2.extras import execute_batch
from logzero import logger

# ==== Database URL ====
DATABASE_URL = os.getenv("DATABASE_URL")

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def add_indicators(df):
    """Add technical indicators to DataFrame"""
    try:
        # Sort by timestamp ascending
        df = df.sort_values('timestamp')
        
        # 1. Trend Indicators
        df['sma20'] = ta.trend.sma_indicator(df['close'], window=20)
        df['sma50'] = ta.trend.sma_indicator(df['close'], window=50)
        df['sma200'] = ta.trend.sma_indicator(df['close'], window=200)
        df['ema12'] = ta.trend.ema_indicator(df['close'], window=12)
        df['ema26'] = ta.trend.ema_indicator(df['close'], window=26)
        
        # MACD
        result_macd = ta.trend.MACD(df['close'])
        df['macd'] = result_macd.macd()
        df['macdSignal'] = result_macd.macd_signal()
        df['macdHistogram'] = result_macd.macd_diff()
        
        # ADX
        df['adx'] = ta.trend.adx(df['high'], df['low'], df['close'])
        df['plusDI'] = ta.trend.adx_pos(df['high'], df['low'], df['close'])
        df['minusDI'] = ta.trend.adx_neg(df['high'], df['low'], df['close'])
        
        # Supertrend (10, 3)
        try:
            high = df['high'].values
            low = df['low'].values
            close = df['close'].values
            
            # Calculate ATR (10)
            atr10 = ta.volatility.average_true_range(df['high'], df['low'], df['close'], window=10).fillna(0).values
            
            # Basic Upper and Lower Bands
            multiplier = 3
            hl2 = (high + low) / 2
            basic_upper = hl2 + (multiplier * atr10)
            basic_lower = hl2 - (multiplier * atr10)
            
            # Initialize arrays
            n = len(df)
            final_upper = np.zeros(n)
            final_lower = np.zeros(n)
            supertrend = np.zeros(n)
            direction = np.zeros(n, dtype=int) # 1: Uptrend (Green), -1: Downtrend (Red)
            
            # Set initial values
            direction[0] = 1
            
            # Iterative calculation (Numba would be faster, but basic numpy loop is ok for 300k, better than iloc)
            # We must use a loop because next value depends on previous final band
            
            for i in range(1, n):
                # Final Upper Band
                if (basic_upper[i] < final_upper[i-1]) or (close[i-1] > final_upper[i-1]):
                    final_upper[i] = basic_upper[i]
                else:
                    final_upper[i] = final_upper[i-1]
                
                # Final Lower Band
                if (basic_lower[i] > final_lower[i-1]) or (close[i-1] < final_lower[i-1]):
                    final_lower[i] = basic_lower[i]
                else:
                    final_lower[i] = final_lower[i-1]
                
                # Supertrend Direction
                prev_dir = direction[i-1]
                curr_dir = prev_dir
                
                if prev_dir == 1: # Uptrend
                    if close[i] < final_lower[i]:
                        curr_dir = -1 # Change to Downtrend
                    else:
                        curr_dir = 1
                else: # Downtrend
                    if close[i] > final_upper[i]:
                        curr_dir = 1 # Change to Uptrend
                    else:
                        curr_dir = -1
                
                direction[i] = curr_dir
                
                # Supertrend Value
                if curr_dir == 1:
                    supertrend[i] = final_lower[i]
                else:
                    supertrend[i] = final_upper[i]
            
            df['supertrend'] = supertrend
            df['supertrendDirection'] = direction

        except Exception as e:
            logger.error(f"Error calculating Supertrend: {e}")
            df['supertrend'] = None
            df['supertrendDirection'] = None

        # 2. Momentum Indicators
        df['rsi'] = ta.momentum.rsi(df['close'], window=14)
        df['stochK'] = ta.momentum.stoch(df['high'], df['low'], df['close'])
        df['stochD'] = ta.momentum.stoch_signal(df['high'], df['low'], df['close'])
        df['cci'] = ta.trend.cci(df['high'], df['low'], df['close'])
        df['williamsR'] = ta.momentum.williams_r(df['high'], df['low'], df['close'])
        df['roc'] = ta.momentum.roc(df['close'])
        
        # 3. Volatility Indicators
        bb = ta.volatility.BollingerBands(df['close'])
        df['bbUpper'] = bb.bollinger_hband()
        df['bbMiddle'] = bb.bollinger_mavg()
        df['bbLower'] = bb.bollinger_lband()
        df['atr'] = ta.volatility.average_true_range(df['high'], df['low'], df['close'])
        
        # 4. Volume Indicators
        df['obv'] = ta.volume.on_balance_volume(df['close'], df['volume'])
        df['vwap'] = ta.volume.volume_weighted_average_price(df['high'], df['low'], df['close'], df['volume'])
        df['forceIndex'] = ta.volume.force_index(df['close'], df['volume'])
        
    except Exception as e:
        logger.error(f"Error calculating indicators: {e}")
    
    return df

def process_stock(stock_id, symbol):
    logger.info(f"Processing {symbol}...")
    
    conn = get_db_connection()
    try:
        # Fetch all OHLCV data
        query = 'SELECT id, timestamp, open, high, low, close, volume FROM "StockPrice" WHERE "stockId" = %s ORDER BY timestamp ASC'
        df = pd.read_sql(query, conn, params=(stock_id,))
        
        if df.empty:
            logger.warning(f"No data for {symbol}")
            return

        # Calculate indicators
        df = add_indicators(df)
        
        # Update Database
        # We only update rows where indicators are null to save time? 
        # Or update all to be safe? Updating all recent ones is better.
        # Let's update all.
        
        update_query = """
            UPDATE "StockPrice"
            SET sma20=%s, sma50=%s, sma200=%s, ema12=%s, ema26=%s,
                macd=%s, "macdSignal"=%s, "macdHistogram"=%s,
                adx=%s, "plusDI"=%s, "minusDI"=%s,
                rsi=%s, "stochK"=%s, "stochD"=%s,
                cci=%s, "williamsR"=%s, roc=%s,
                "bbUpper"=%s, "bbMiddle"=%s, "bbLower"=%s,
                atr=%s, obv=%s, vwap=%s, "forceIndex"=%s,
                supertrend=%s, "supertrendDirection"=%s
            WHERE id=%s
        """
        
        records = []
        for index, row in df.iterrows():
            # Replace NaN with None for SQL
            r = row.where(pd.notnull(row), None)
            
            record = (
                r['sma20'], r['sma50'], r['sma200'], r['ema12'], r['ema26'],
                r['macd'], r['macdSignal'], r['macdHistogram'],
                r['adx'], r['plusDI'], r['minusDI'],
                r['rsi'], r['stochK'], r['stochD'],
                r['cci'], r['williamsR'], r['roc'],
                r['bbUpper'], r['bbMiddle'], r['bbLower'],
                r['atr'], r['obv'], r['vwap'], r['forceIndex'],
                r['supertrend'], r['supertrendDirection'],
                r['id']
            )
            records.append(record)
            
        cursor = conn.cursor()
        execute_batch(cursor, update_query, records, page_size=1000)
        conn.commit()
        logger.info(f"✅ Updated {len(records)} records for {symbol}")
        
    except Exception as e:
        logger.error(f"❌ Failed to process {symbol}: {e}")
    finally:
        conn.close()

def main():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, symbol FROM "Stock"')
    stocks = cursor.fetchall()
    conn.close()
    
    logger.info(f"Found {len(stocks)} stocks to process")
    
    for stock_id, symbol in stocks:
        process_stock(stock_id, symbol)

if __name__ == "__main__":
    main()
