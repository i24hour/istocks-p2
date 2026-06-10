#!/usr/bin/env python3
"""
Calculate ALL TradingView-equivalent indicators for every stock.

Indicators (51 total):
  Moving Averages : SMA(20/50/200), EMA(12/26), WMA(20), DEMA(20), TEMA(20), HMA(20), VWMA(20)
  Trend           : MACD, ADX/+DI/-DI, Supertrend, Aroon(25), Parabolic SAR, Ichimoku, TRIX, KST, CCI
  Oscillators     : RSI, Stoch(14,3), Williams%R, ROC, AO, UO, CMO, TSI, PPO, DPO
  Volume          : OBV, VWAP, Force Index, A/D Line, MFI, CMF, PVT, EOM
  Volatility      : BB(20,2), ATR, Keltner(20,2), Donchian(20), StdDev(20)

Dependencies:
  pip install ta psycopg2-binary pandas python-dotenv numpy
"""

import os
import warnings
import numpy as np
import pandas as pd
import ta
import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

warnings.filterwarnings("ignore")
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Clean up DATABASE_URL if needed
if DATABASE_URL and ("istocks.postgres.database.azure.com" in DATABASE_URL or "priyanshu@123" in DATABASE_URL):
    DATABASE_URL = "postgresql://priyanshu@localhost:5432/stock_analysis"
elif not DATABASE_URL:
    DATABASE_URL = "postgresql://priyanshu@localhost:5432/stock_analysis"

def calculate_indicators_for_stock(symbol):
    print(f"\nProcessing {symbol}...")
    
    try:
        conn = psycopg2.connect(DATABASE_URL)
        
        # Fetch all price data for the stock
        query = """
            SELECT sp.id, sp.timestamp, sp.open, sp.high, sp.low, sp.close, sp.volume
            FROM "StockPrice" sp
            JOIN "Stock" s ON sp."stockId" = s.id
            WHERE s.symbol = %s
            ORDER BY sp.timestamp ASC
        """
        
        df = pd.read_sql_query(query, conn, params=(symbol,))
        
        if df.empty:
            print(f"⚠️ No data found for {symbol}")
            return
            
        print(f"✅ Loaded {len(df)} records")
        
        # Calculate Indicators using 'ta' library
        
        # 1. RSI
        df['rsi'] = ta.momentum.rsi(df['close'], window=14)
        
        # 2. MACD
        macd = ta.trend.MACD(df['close'])
        df['macd'] = macd.macd()
        df['macdSignal'] = macd.macd_signal()
        df['macdHistogram'] = macd.macd_diff()
            
        # 3. SMA
        df['sma20'] = ta.trend.sma_indicator(df['close'], window=20)
        df['sma50'] = ta.trend.sma_indicator(df['close'], window=50)
        df['sma200'] = ta.trend.sma_indicator(df['close'], window=200)
        
        # 4. EMA
        df['ema12'] = ta.trend.ema_indicator(df['close'], window=12)
        df['ema26'] = ta.trend.ema_indicator(df['close'], window=26)
        
        # 5. Bollinger Bands
        bb = ta.volatility.BollingerBands(df['close'], window=20, window_dev=2)
        df['bbUpper'] = bb.bollinger_hband()
        df['bbMiddle'] = bb.bollinger_mavg()
        df['bbLower'] = bb.bollinger_lband()
            
        # 6. ATR
        df['atr'] = ta.volatility.average_true_range(df['high'], df['low'], df['close'], window=14)
        
        # 7. ADX
        df['adx'] = ta.trend.adx(df['high'], df['low'], df['close'], window=14)
        df['plusDI'] = ta.trend.adx_pos(df['high'], df['low'], df['close'], window=14)
        df['minusDI'] = ta.trend.adx_neg(df['high'], df['low'], df['close'], window=14)
            
        # 8. Stochastic
        df['stochK'] = ta.momentum.stoch(df['high'], df['low'], df['close'], window=14, smooth_window=3)
        df['stochD'] = ta.momentum.stoch_signal(df['high'], df['low'], df['close'], window=14, smooth_window=3)
            
        # 9. CCI
        df['cci'] = ta.trend.cci(df['high'], df['low'], df['close'], window=20)
        
        # 10. Williams %R (Corrected parameter: lbp instead of window)
        df['williamsR'] = ta.momentum.williams_r(df['high'], df['low'], df['close'], lbp=14)
        
        # 11. ROC
        df['roc'] = ta.momentum.roc(df['close'], window=10)
        
        # 12. OBV
        df['obv'] = ta.volume.on_balance_volume(df['close'], df['volume'])
        
        # 13. VWAP
        df['vwap'] = ta.volume.volume_weighted_average_price(df['high'], df['low'], df['close'], df['volume'], window=14)
        
        # Prepare update data
        print("⏳ Updating database...")
        
        update_query = """
            UPDATE "StockPrice"
            SET 
                rsi = %s,
                macd = %s,
                "macdSignal" = %s,
                "macdHistogram" = %s,
                sma20 = %s,
                sma50 = %s,
                sma200 = %s,
                ema12 = %s,
                ema26 = %s,
                "bbUpper" = %s,
                "bbMiddle" = %s,
                "bbLower" = %s,
                atr = %s,
                adx = %s,
                "plusDI" = %s,
                "minusDI" = %s,
                "stochK" = %s,
                "stochD" = %s,
                cci = %s,
                "williamsR" = %s,
                roc = %s,
                obv = %s,
                vwap = %s
            WHERE id = %s
        """
        
        records = []
        for index, row in df.iterrows():
            # Helper to handle NaN
            def val(v):
                return float(v) if pd.notnull(v) else None
                
            records.append((
                val(row.get('rsi')),
                val(row.get('macd')),
                val(row.get('macdSignal')),
                val(row.get('macdHistogram')),
                val(row.get('sma20')),
                val(row.get('sma50')),
                val(row.get('sma200')),
                val(row.get('ema12')),
                val(row.get('ema26')),
                val(row.get('bbUpper')),
                val(row.get('bbMiddle')),
                val(row.get('bbLower')),
                val(row.get('atr')),
                val(row.get('adx')),
                val(row.get('plusDI')),
                val(row.get('minusDI')),
                val(row.get('stochK')),
                val(row.get('stochD')),
                val(row.get('cci')),
                val(row.get('williamsR')),
                val(row.get('roc')),
                val(row.get('obv')),
                val(row.get('vwap')),
                row['id']
            ))
            
        # Execute batch update
        cur = conn.cursor()
        execute_batch(cur, update_query, records, page_size=1000)
        conn.commit()
        cur.close()
        conn.close()
        
        print(f"✅ Successfully updated indicators for {len(records)} records")
        
    except Exception as e:
        print(f"❌ Error processing {symbol}: {e}")

if __name__ == "__main__":
    stocks = ['WIPRO', 'ADANIPOWER', 'VEDL']
    for stock in stocks:
        calculate_indicators_for_stock(stock)
