#!/usr/bin/env python3
"""
Fetch and update ALL stocks in the database with latest data from Angel One
Updates from last available date to today
"""

import requests
import psycopg2
from psycopg2.extras import execute_batch
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import time
import pandas as pd
import ta
import os

# ==== Angel One Credentials ====
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# ==== Azure PostgreSQL ====
# ==== Database (Azure) ====
DATABASE_URL = os.getenv("DATABASE_URL")

# ==== Angel One Scrip Master URL ====
SCRIP_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

# Cache for scrip master to avoid multiple fetches
SCRIP_MASTER_CACHE = None


def get_scrip_master():
    """Fetch and cache scrip master"""
    global SCRIP_MASTER_CACHE
    if SCRIP_MASTER_CACHE is None:
        logger.info("📥 Fetching Angel One Scrip Master...")
        response = requests.get(SCRIP_MASTER_URL)
        SCRIP_MASTER_CACHE = response.json()
        logger.info(f"✅ Loaded {len(SCRIP_MASTER_CACHE)} instruments")
    return SCRIP_MASTER_CACHE


def get_symbol_token(symbol, exchange="NSE"):
    """Get Angel One token for a stock symbol"""
    scrip_master = get_scrip_master()
    
    # Map our symbol names to Angel One names
    symbol_map = {
        "NIFTY": "NIFTY",
        "WIPRO": "WIPRO-EQ",
        "ADANIPOWER": "ADANIPOWER-EQ",
        "VEDL": "VEDL-EQ",
        "ETERNAL": "ETERNAL-EQ",
        "SWIGGY": "SWIGGY-EQ",
        "HDFCBANK": "HDFCBANK-EQ",
        "RELIANCE": "RELIANCE-EQ",
        "MIFL": "MANGIND",
        "ICICIBANK": "ICICIBANK-EQ",
        "SBIN": "SBIN-EQ",
        "BAJFINANCE": "BAJFINANCE-EQ",
        "REDINGTON": "REDINGTON-EQ",
    }
    
    search_name = symbol_map.get(symbol, symbol)
    
    for item in scrip_master:
        # For NIFTY, it's in NFO/NSE index
        if symbol == "NIFTY":
            if item["name"] == "NIFTY" and item["exch_seg"] == "NSE":
                return item["token"], "NSE"
        else:
            # For stocks, search by symbol or trading symbol
            if (item.get("symbol") == search_name or item.get("name") == search_name) and item["exch_seg"] == exchange:
                return item["token"], exchange
    
    return None, None


def fetch_data_in_chunks(smartApi, token, exchange, start_date, end_date, interval="ONE_MINUTE"):
    """Fetch historical data in chunks from Angel One"""
    all_data = []
    current_start = start_date

    while current_start < end_date:
        current_end = current_start + timedelta(days=5)  # 5-day chunks
        if current_end > end_date:
            current_end = end_date

        from_str = current_start.strftime("%Y-%m-%d 09:15")
        to_str = current_end.strftime("%Y-%m-%d 15:30")

        params = {
            "exchange": exchange,
            "symboltoken": token,
            "interval": interval,
            "fromdate": from_str,
            "todate": to_str,
        }
        
        try:
            result = smartApi.getCandleData(params)
            if result and "data" in result and result["data"]:
                all_data.extend(result["data"])
                logger.info(f"    ✅ Fetched {len(result['data'])} candles ({from_str} to {to_str})")
            else:
                logger.debug(f"    ⚠️  No data for {from_str} to {to_str}")
        except Exception as e:
            logger.error(f"    ❌ Error: {e}")

        current_start = current_end
        time.sleep(0.2) # Avoid rate limits

    return all_data

def calculate_indicators(data):
    """Calculate technical indicators using pandas and ta"""
    if not data:
        return pd.DataFrame()

    # Convert to DataFrame if list of dicts/tuples, else assume it's already list of lists/tuples
    if isinstance(data, list):
        if len(data) > 0 and isinstance(data[0], dict):
             df = pd.DataFrame(data)
        elif len(data) > 0 and isinstance(data[0], (list, tuple)):
             df = pd.DataFrame(data, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        else:
             return pd.DataFrame()
    else:
        # Assume it's a DF?
        return pd.DataFrame()

    # Process Timestamps
    df['timestamp'] = df['timestamp'].astype(str)
    try:
        df['timestamp'] = df['timestamp'].apply(lambda x: x.split('+')[0].replace('Z', ''))
    except:
        pass
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Sort
    df = df.sort_values('timestamp')
    
    # Numeric conversion
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col])

    try:
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
            high = df['high']
            low = df['low']
            close = df['close']
            
            # Calculate ATR (10)
            atr10 = ta.volatility.average_true_range(high, low, close, window=10)
            
            # Basic Upper and Lower Bands
            multiplier = 3
            hl2 = (high + low) / 2
            basic_upper = hl2 + (multiplier * atr10)
            basic_lower = hl2 - (multiplier * atr10)
            
            # Initialize columns
            final_upper = pd.Series(index=df.index, dtype='float64')
            final_lower = pd.Series(index=df.index, dtype='float64')
            supertrend = pd.Series(index=df.index, dtype='float64')
            direction = pd.Series(index=df.index, dtype='int64') # 1: Uptrend (Green), -1: Downtrend (Red)
            
            # Iterative calculation
            for i in range(len(df)):
                if i == 0:
                    final_upper.iloc[i] = 0.0
                    final_lower.iloc[i] = 0.0
                    direction.iloc[i] = 1
                    continue
                
                # Final Upper Band
                if (basic_upper.iloc[i] < final_upper.iloc[i-1]) or (close.iloc[i-1] > final_upper.iloc[i-1]):
                    final_upper.iloc[i] = basic_upper.iloc[i]
                else:
                    final_upper.iloc[i] = final_upper.iloc[i-1]
                
                # Final Lower Band
                if (basic_lower.iloc[i] > final_lower.iloc[i-1]) or (close.iloc[i-1] < final_lower.iloc[i-1]):
                    final_lower.iloc[i] = basic_lower.iloc[i]
                else:
                    final_lower.iloc[i] = final_lower.iloc[i-1]
                
                # Supertrend Direction
                prev_dir = direction.iloc[i-1]
                curr_dir = prev_dir
                
                if prev_dir == 1: # Uptrend
                    if close.iloc[i] < final_lower.iloc[i]:
                        curr_dir = -1 # Change to Downtrend
                    else:
                        curr_dir = 1
                else: # Downtrend
                    if close.iloc[i] > final_upper.iloc[i]:
                        curr_dir = 1 # Change to Uptrend
                    else:
                        curr_dir = -1
                
                direction.iloc[i] = curr_dir
                
                # Supertrend Value
                if curr_dir == 1:
                    supertrend.iloc[i] = final_lower.iloc[i]
                else:
                    supertrend.iloc[i] = final_upper.iloc[i]
            
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

def insert_to_db(stock_id, df, conn):
    """Insert fetched data into Azure database"""
    if df.empty:
        return 0

    cursor = conn.cursor()

    # Prepare records
    records = []
    for index, row in df.iterrows():
        try:
            # Replace NaN with None
            r = row.where(pd.notnull(row), None)
            
            record = (
                stock_id,
                r['timestamp'],
                float(r['open']), 
                float(r['high']),
                float(r['low']), 
                float(r['close']),
                int(r['volume']),
                r['sma20'], r['sma50'], r['sma200'], r['ema12'], r['ema26'],
                r['macd'], r['macdSignal'], r['macdHistogram'],
                r['adx'], r['plusDI'], r['minusDI'],
                r['rsi'], r['stochK'], r['stochD'],
                r['cci'], r['williamsR'], r['roc'],
                r['bbUpper'], r['bbMiddle'], r['bbLower'],
                r['atr'], r['obv'], r['vwap'], r['forceIndex'],
                r['supertrend'], r['supertrendDirection']
            )
            records.append(record)
        except Exception as e:
            continue

    # Insert with upsert
    insert_query = """
        INSERT INTO "StockPrice" 
        (id, "stockId", timestamp, open, high, low, close, volume, 
         sma20, sma50, sma200, ema12, ema26,
         macd, "macdSignal", "macdHistogram",
         adx, "plusDI", "minusDI",
         rsi, "stochK", "stochD",
         cci, "williamsR", roc,
         "bbUpper", "bbMiddle", "bbLower",
         atr, obv, vwap, "forceIndex",
         supertrend, "supertrendDirection",
         "createdAt")
        VALUES (
            gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s,
            NOW()
        )
        ON CONFLICT ("stockId", timestamp) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            sma20 = EXCLUDED.sma20, sma50 = EXCLUDED.sma50, sma200 = EXCLUDED.sma200,
            ema12 = EXCLUDED.ema12, ema26 = EXCLUDED.ema26,
            macd = EXCLUDED.macd, "macdSignal" = EXCLUDED."macdSignal", "macdHistogram" = EXCLUDED."macdHistogram",
            adx = EXCLUDED.adx, "plusDI" = EXCLUDED."plusDI", "minusDI" = EXCLUDED."minusDI",
            rsi = EXCLUDED.rsi, "stochK" = EXCLUDED."stochK", "stochD" = EXCLUDED."stochD",
            cci = EXCLUDED.cci, "williamsR" = EXCLUDED."williamsR", roc = EXCLUDED.roc,
            "bbUpper" = EXCLUDED."bbUpper", "bbMiddle" = EXCLUDED."bbMiddle", "bbLower" = EXCLUDED."bbLower",
            atr = EXCLUDED.atr, obv = EXCLUDED.obv, vwap = EXCLUDED.vwap, "forceIndex" = EXCLUDED."forceIndex",
            supertrend = EXCLUDED.supertrend, "supertrendDirection" = EXCLUDED."supertrendDirection"
    """

    try:
        execute_batch(cursor, insert_query, records, page_size=500)
        conn.commit()
        return len(records)
    except Exception as e:
        conn.rollback()
        logger.error(f"❌ Database Insert Error: {e}")
        return 0


def main():
    logger.info("======================================================================")
    logger.info("🚀 UPDATE ALL STOCKS - Fetching latest data from Angel One")
    logger.info("======================================================================")

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        logger.info("✅ Connected to Azure PostgreSQL")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return

    # Fetch stocks to update
    try:
        cursor.execute('SELECT id, symbol, name, exchange FROM "Stock" WHERE "isActive" = true')
        stocks = cursor.fetchall()
    except Exception as e:
        logger.warning(f"⚠️  isActive column missing, fetching all stocks instead: {e}")
        conn.rollback()
        try:
            cursor.execute('SELECT id, symbol, name, exchange FROM "Stock"')
            stocks = cursor.fetchall()
        except Exception as inner_e:
            logger.error(f"❌ Failed to fetch stocks list: {inner_e}")
            return

    # Initialize Angel One API
    try:
        smartApi = SmartConnect(api_key=API_KEY)
        totp = pyotp.TOTP(TOTP_TOKEN).now()
        data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)
        
        if data['status'] == False:
            logger.error(f"❌ Angel One Login Failed: {data['message']}")
            return
            
        authToken = data['data']['jwtToken']
        refreshToken = data['data']['refreshToken']
        
        # Fetch the feedtoken
        feedToken = smartApi.getfeedToken()
        smartApi.getProfile(refreshToken)
        
        logger.info("✅ Authenticated with Angel One")
    
    except Exception as e:
        logger.error(f"❌ Login Exception: {e}")
        return

    symbol_filter = os.getenv("UPDATE_SYMBOLS", "").strip().upper()
    selected_symbols = [s.strip().upper() for s in symbol_filter.split(',') if s.strip()] if symbol_filter else None

    logger.info(f"📊 Found {len(stocks)} stocks to update")
    
    today = datetime.now()
    
    for stock_id, symbol, name, exchange in stocks:
        if selected_symbols and symbol.upper() not in selected_symbols:
            continue
        try:
            # Check last update
            cursor.execute('SELECT MAX(timestamp) FROM "StockPrice" WHERE "stockId" = %s', (stock_id,))
            last_date = cursor.fetchone()[0]
            
            # If no data, start from 1 year ago. If data, start from last date
            if last_date:
                start_date = last_date
            else:
                start_date = today - timedelta(days=365) # 1 year default

            logger.info(f"📈 Processing: {symbol} ({name})")

            token, exchange = get_symbol_token(symbol, exchange)
            if not token:
                logger.warning(f"⚠️  Token not found for {symbol}")
                continue
                
            logger.info(f"   Token: {token}, Exchange: {exchange}")
            
            # Fetch NEW data from API
            api_data = fetch_data_in_chunks(smartApi, token, exchange, start_date, today)
            
            if not api_data:
                logger.info(f"   ⚠️ No new data for {symbol}")
                continue

            # Load NEW data into DF
            df_new = pd.DataFrame(api_data, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
             # Process Timestamps
            df_new['timestamp'] = df_new['timestamp'].astype(str)
            try:
                df_new['timestamp'] = df_new['timestamp'].apply(lambda x: x.split('+')[0].replace('Z', ''))
            except:
                pass
            try:
                df_new['timestamp'] = pd.to_datetime(df_new['timestamp'])
            except:
                 pass
            
             # Numeric conversion
            for col in ['open', 'high', 'low', 'close', 'volume']:
                df_new[col] = pd.to_numeric(df_new[col])
            
            # Fetch LAST 300 ROWS from DB to provide context for indicators
            query_hist = 'SELECT timestamp, open, high, low, close, volume FROM "StockPrice" WHERE "stockId" = %s ORDER BY timestamp DESC LIMIT 300'
            df_hist = pd.read_sql(query_hist, conn, params=(stock_id,))
            
            if not df_hist.empty:
                # Sort ascending
                df_hist = df_hist.sort_values('timestamp')
                # Combine
                df_combined = pd.concat([df_hist, df_new]).drop_duplicates(subset=['timestamp']).sort_values('timestamp')
            else:
                df_combined = df_new

            # Calculate Indicators
            # Pass list of dicts to our helper
            data_list = df_combined.to_dict('records')
            df_calculated = calculate_indicators(data_list)
            
            # Filter to insert only new rows (or overlap)
            # Actually, to be safe, filtering for rows >= start_date is good.
            # But converting start_date to TS might be tricky.
            # Let's just upsert all calculated rows (at most 300 + new). 
            # Upsert handles duplication.
            
            inserted = insert_to_db(stock_id, df_calculated, conn)
            logger.info(f"   ✅ Inserted/Updated {inserted} records for {symbol}")

        except Exception as e:
            logger.error(f"❌ Error processing {symbol}: {e}")
            continue

    try:
        smartApi.terminateSession(CLIENT_ID)
        logger.info("✅ Logged out from Angel One")
    except:
        pass

    conn.close()
    logger.info("======================================================================")
    logger.info("🎉 DONE! All stocks updated.")
    logger.info("======================================================================")


if __name__ == "__main__":
    main()
