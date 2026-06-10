
def calculate_indicators(data):
    """Calculate technical indicators using pandas and ta"""
    if not data:
        return []

    # Convert to DataFrame if list of dicts/tuples, else assume it's already list of lists/tuples
    # check structure
    if isinstance(data, list) and len(data) > 0:
        if isinstance(data[0], dict):
             df = pd.DataFrame(data)
        elif isinstance(data[0], (list, tuple)):
             # Angel One returns list of values: [timestamp, open, high, low, close, volume]
             df = pd.DataFrame(data, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])

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
