#!/usr/bin/env python3
"""
Fetch NIFTY 50 Options Data (e.g. NIFTY 05 May 24300 Call)
Uses Angel One SmartAPI - getCandleData with exchange="NFO"

How it works:
1. Downloads Angel One's Scrip Master JSON (~150MB) to find the symbol token
2. Filters for NIFTY OPTIDX contracts matching your strike/expiry/type
3. Fetches historical candle data using getCandleData (same API as equities)

The only difference from equity fetching is:
  - exchange = "NFO" instead of "NSE"
  - Symbol tokens come from the Scrip Master (change every expiry cycle)
"""

import requests
import json
import pandas as pd
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import time
import os
from dotenv import load_dotenv

load_dotenv()

# ==== Angel One Credentials ====
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")

# ==== Scrip Master URL ====
SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"

# ==== Cache file for scrip master (avoid re-downloading) ====
SCRIP_CACHE_FILE = "/tmp/angel_scrip_master.json"


def download_scrip_master(force_refresh=False):
    """
    Download Angel One's instrument master file.
    This is a ~150MB JSON containing ALL tradeable instruments.
    We cache it locally to avoid repeated downloads.
    """
    if not force_refresh and os.path.exists(SCRIP_CACHE_FILE):
        # Use cache if less than 12 hours old
        file_age = time.time() - os.path.getmtime(SCRIP_CACHE_FILE)
        if file_age < 43200:  # 12 hours
            logger.info("Using cached scrip master (less than 12 hours old)")
            with open(SCRIP_CACHE_FILE, 'r') as f:
                return json.load(f)

    logger.info("Downloading Angel One Scrip Master (~150MB, this may take a minute)...")
    response = requests.get(SCRIP_MASTER_URL, timeout=120)
    response.raise_for_status()
    data = response.json()

    # Cache locally
    with open(SCRIP_CACHE_FILE, 'w') as f:
        json.dump(data, f)

    logger.info(f"Downloaded {len(data)} instruments")
    return data


def find_nifty_option_token(scrip_data, strike_price, option_type="CE", expiry_date=None):
    """
    Find the symbol token for a specific NIFTY option contract.
    
    Args:
        scrip_data: List of instrument dicts from scrip master
        strike_price: Strike price (e.g. 24300)
        option_type: "CE" for Call, "PE" for Put
        expiry_date: Expiry date string to match (e.g. "08MAY2026")
                     If None, finds the nearest expiry.
    
    Returns:
        Dict with token, symbol, expiry info or None
    """
    df = pd.DataFrame(scrip_data)

    # Filter for NIFTY options on NFO
    nifty_options = df[
        (df['name'] == 'NIFTY') &
        (df['instrumenttype'] == 'OPTIDX') &
        (df['exch_seg'] == 'NFO')
    ].copy()

    if nifty_options.empty:
        logger.error("No NIFTY options found in scrip master!")
        return None

    logger.info(f"Found {len(nifty_options)} NIFTY option contracts in scrip master")

    # Convert strike to float for reliable comparison
    nifty_options['strike_float'] = nifty_options['strike'].astype(float)

    # Angel One stores strike as strike * 100 (in paise)
    # e.g. 24300 strike is stored as 2430000.0
    target_strike = float(strike_price * 100)

    # Filter by strike price
    strike_matches = nifty_options[nifty_options['strike_float'] == target_strike]

    if strike_matches.empty:
        # Try without the *100 multiplier (some versions may differ)
        strike_matches = nifty_options[nifty_options['strike_float'] == float(strike_price)]

    if strike_matches.empty:
        logger.error(f"No contracts found for strike {strike_price}")
        all_strikes = nifty_options['strike_float'].unique()
        all_strikes.sort()
        close_strikes = sorted(all_strikes, key=lambda x: abs(x - target_strike))[:10]
        logger.info(f"Nearest available strikes: {[s/100 for s in close_strikes]}")
        return None

    # Filter by option type (CE/PE)
    type_matches = strike_matches[strike_matches['symbol'].str.contains(option_type)]

    if type_matches.empty:
        logger.error(f"No {option_type} contracts found for strike {strike_price}")
        return None

    # Filter/sort by expiry
    if expiry_date:
        # User specified exact expiry
        expiry_matches = type_matches[type_matches['expiry'] == expiry_date]
        if expiry_matches.empty:
            # Try parsing the date differently
            logger.warning(f"Exact expiry '{expiry_date}' not found. Available expiries:")
            for _, row in type_matches.iterrows():
                logger.info(f"  {row['symbol']} | Expiry: {row['expiry']} | Token: {row['token']}")
            # Use the nearest one
            result = type_matches.iloc[0]
        else:
            result = expiry_matches.iloc[0]
    else:
        # Find nearest expiry (first one chronologically)
        type_matches = type_matches.copy()
        type_matches['expiry_parsed'] = pd.to_datetime(type_matches['expiry'], format='%d%b%Y', errors='coerce')
        type_matches = type_matches.sort_values('expiry_parsed')

        # Filter only future expiries
        today = datetime.now()
        future_expiries = type_matches[type_matches['expiry_parsed'] >= today]

        if future_expiries.empty:
            logger.warning("No future expiries found, using latest available")
            result = type_matches.iloc[-1]
        else:
            result = future_expiries.iloc[0]

    logger.info(f"Found contract: {result['symbol']}")
    logger.info(f"  Token: {result['token']}")
    logger.info(f"  Expiry: {result['expiry']}")
    logger.info(f"  Strike: {float(result['strike'])/100}")
    logger.info(f"  Lot Size: {result.get('lotsize', 'N/A')}")

    return {
        'token': result['token'],
        'symbol': result['symbol'],
        'expiry': result['expiry'],
        'strike': result['strike'],
        'lotsize': result.get('lotsize', ''),
        'name': result['name'],
    }


def list_nifty_expiries(scrip_data, option_type="CE", strike_price=None):
    """
    List all available NIFTY option expiry dates.
    Useful for finding the right expiry string.
    """
    df = pd.DataFrame(scrip_data)

    nifty_options = df[
        (df['name'] == 'NIFTY') &
        (df['instrumenttype'] == 'OPTIDX') &
        (df['exch_seg'] == 'NFO')
    ]

    if strike_price:
        target_strike = float(strike_price * 100)
        nifty_options = nifty_options[nifty_options['strike'].astype(float) == target_strike]

    nifty_options = nifty_options[nifty_options['symbol'].str.contains(option_type)]

    expiries = nifty_options['expiry'].unique()
    expiries_parsed = []
    for exp in expiries:
        try:
            parsed = datetime.strptime(exp, '%d%b%Y')
            expiries_parsed.append((exp, parsed))
        except:
            expiries_parsed.append((exp, datetime.max))

    expiries_parsed.sort(key=lambda x: x[1])

    logger.info(f"\n{'='*50}")
    logger.info(f"Available NIFTY {option_type} Expiries:")
    logger.info(f"{'='*50}")
    for exp_str, exp_date in expiries_parsed:
        if exp_date < datetime.max:
            logger.info(f"  {exp_str}  ({exp_date.strftime('%d %B %Y, %A')})")
        else:
            logger.info(f"  {exp_str}")

    return [e[0] for e in expiries_parsed]


def fetch_option_candles(jwt_token, api_key, token, start_date, end_date, interval="FIVE_MINUTE"):
    """
    Fetch historical candle data for an options contract.
    Uses raw HTTP with JWT Bearer token (same as working TS implementation).
    """
    all_data = []
    current_start = start_date

    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': 'CLIENT_LOCAL_IP',
        'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
        'X-MACAddress': 'MAC_ADDRESS',
        'X-PrivateKey': api_key,
        'Authorization': f'Bearer {jwt_token}',
    }

    while current_start < end_date:
        # Use smaller chunks for options (5 days) since data volume is high
        current_end = current_start + timedelta(days=5)
        if current_end > end_date:
            current_end = end_date

        from_str = current_start.strftime("%Y-%m-%d 09:15")
        to_str = current_end.strftime("%Y-%m-%d 15:30")

        payload = {
            "exchange": "NFO",
            "symboltoken": token,
            "interval": interval,
            "fromdate": from_str,
            "todate": to_str,
        }

        try:
            resp = requests.post(
                'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
                headers=headers,
                json=payload,
                timeout=15
            )
            result = resp.json()
            if result.get("data"):
                all_data.extend(result["data"])
                logger.info(f"Fetched {len(result['data'])} candles ({from_str[:10]} to {to_str[:10]})")
            else:
                logger.debug(f"No data for {from_str[:10]} to {to_str[:10]} | {result.get('message', '')}")
        except Exception as e:
            logger.error(f"Error fetching candles: {e}")

        current_start = current_end
        time.sleep(0.3)

    return all_data


def main():
    logger.info("=" * 70)
    logger.info("NIFTY OPTIONS DATA FETCHER")
    logger.info("=" * 70)

    # ================================================================
    # CONFIGURATION - Change these values for your desired contract
    # ================================================================
    TARGET_STRIKE = 24600       # Strike price
    TARGET_TYPE = "CE"          # CE = Call, PE = Put
    TARGET_EXPIRY = "05MAY2026" # Set to None for nearest expiry, or e.g. "05MAY2026"
    FETCH_INTERVAL = "ONE_MINUTE"  # ONE_MINUTE, FIVE_MINUTE, FIFTEEN_MINUTE, ONE_DAY
    # ================================================================

    # Step 1: Download scrip master to find token
    logger.info("\n[Step 1] Downloading Scrip Master...")
    scrip_data = download_scrip_master()

    # Step 2: List available expiries (informational)
    logger.info("\n[Step 2] Listing available expiries...")
    list_nifty_expiries(scrip_data, TARGET_TYPE, TARGET_STRIKE)

    # Step 3: Find the specific option token
    logger.info(f"\n[Step 3] Finding token for NIFTY {TARGET_STRIKE} {TARGET_TYPE}...")
    contract = find_nifty_option_token(scrip_data, TARGET_STRIKE, TARGET_TYPE, TARGET_EXPIRY)

    if not contract:
        logger.error("Could not find the option contract. Check strike/expiry.")
        return

    # Step 4: Authenticate with Angel One
    logger.info("\n[Step 4] Authenticating with Angel One...")
    smartApi = SmartConnect(api_key=API_KEY)

    try:
        totp = pyotp.TOTP(TOTP_TOKEN).now()
    except Exception as e:
        logger.error(f"Invalid TOTP Token: {e}")
        return

    session_data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)
    if not session_data.get('status'):
        logger.error(f"Authentication Failed: {session_data}")
        return

    jwt_token = smartApi.access_token
    logger.info(f"Authenticated (JWT: {jwt_token[:20] if jwt_token else 'None'}...)")

    # Step 5: Fetch candle data
    logger.info(f"\n[Step 5] Fetching candle data for {contract['symbol']}...")

    # Fetch last 3 days of data
    end_date = datetime.now()
    start_date = end_date - timedelta(days=3)

    from_str = start_date.strftime("%Y-%m-%d 09:15")
    to_str = end_date.strftime("%Y-%m-%d 15:30")

    params = {
        "exchange": "NFO",
        "symboltoken": contract['token'],
        "interval": FETCH_INTERVAL,
        "fromdate": from_str,
        "todate": to_str,
    }

    logger.info(f"Request params: {params}")

    candle_data = []

    # Method 1: SmartConnect library (same as ec2-live-server)
    try:
        result = smartApi.getCandleData(params)
        if result and result.get("data"):
            candle_data = result["data"]
            logger.info(f"[SmartConnect] Fetched {len(candle_data)} candles")
        else:
            msg = result.get('message', '') if result else 'No result'
            logger.warning(f"[SmartConnect] Failed: {msg}")
    except Exception as e:
        logger.error(f"[SmartConnect] Error: {e}")

    # Method 2: Raw HTTP fallback (if library failed)
    if not candle_data and jwt_token:
        logger.info("Trying raw HTTP with Bearer token...")
        try:
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-UserType': 'USER',
                'X-SourceID': 'WEB',
                'X-ClientLocalIP': 'CLIENT_LOCAL_IP',
                'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
                'X-MACAddress': 'MAC_ADDRESS',
                'X-PrivateKey': API_KEY,
                'Authorization': f'Bearer {jwt_token}',
            }
            resp = requests.post(
                'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
                headers=headers,
                json=params,
                timeout=15
            )
            raw_result = resp.json()
            if raw_result.get("data"):
                candle_data = raw_result["data"]
                logger.info(f"[Raw HTTP] Fetched {len(candle_data)} candles")
            else:
                logger.warning(f"[Raw HTTP] Failed: {raw_result.get('message', '')}")
        except Exception as e:
            logger.error(f"[Raw HTTP] Error: {e}")

    # Step 6: Display results
    if candle_data:
        logger.info(f"\n{'='*70}")
        logger.info(f"RESULTS: {contract['symbol']}")
        logger.info(f"{'='*70}")
        logger.info(f"Total candles fetched: {len(candle_data)}")
        logger.info(f"Interval: {FETCH_INTERVAL}")
        logger.info(f"Date range: {start_date.date()} to {end_date.date()}")
        logger.info(f"")

        # Show latest 10 candles
        logger.info(f"Latest 10 candles:")
        logger.info(f"{'Timestamp':<25} {'Open':>10} {'High':>10} {'Low':>10} {'Close':>10} {'Volume':>12}")
        logger.info("-" * 80)
        for candle in candle_data[-10:]:
            ts = candle[0][:19]
            logger.info(f"{ts:<25} {candle[1]:>10.2f} {candle[2]:>10.2f} {candle[3]:>10.2f} {candle[4]:>10.2f} {candle[5]:>12}")

        # Save to CSV
        csv_filename = f"nifty_{TARGET_STRIKE}_{TARGET_TYPE}_{contract['expiry']}.csv"
        csv_path = os.path.join(os.path.dirname(__file__), csv_filename)

        with open(csv_path, 'w') as f:
            f.write("timestamp,open,high,low,close,volume\n")
            for candle in candle_data:
                ts = candle[0][:19]
                f.write(f"{ts},{candle[1]},{candle[2]},{candle[3]},{candle[4]},{candle[5]}\n")

        logger.info(f"\nData saved to: {csv_path}")
    else:
        logger.warning("No candle data returned.")
        logger.warning("Possible reasons:")
        logger.warning("  1. Market is closed (current time: 10:31 PM IST). Run during 9:15 AM - 3:30 PM.")
        logger.warning("  2. The API key may need 'Historical API' enabled on SmartAPI dashboard.")
        logger.warning("  3. The contract may not have traded on these dates.")
        logger.warning("TIP: Run this during market hours tomorrow for live data!")

    # Cleanup
    try:
        smartApi.terminateSession(CLIENT_ID)
        logger.info("Logged out from Angel One")
    except:
        pass

    logger.info("=" * 70)
    logger.info("DONE!")
    logger.info("=" * 70)


if __name__ == "__main__":
    main()
