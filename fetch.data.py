import requests
import json
import csv
from SmartApi.smartConnect import SmartConnect
import pyotp
from logzero import logger
from datetime import datetime, timedelta
import os  # Import the os module for path handling
import time

# Replace with your Angel One credentials
API_KEY = os.getenv("ANGELONE_API_KEY")
CLIENT_ID = os.getenv("ANGELONE_CLIENT_ID")
SECRET_KEY = os.getenv("ANGELONE_SECRET_KEY")
TOTP_TOKEN = os.getenv("ANGELONE_TOTP_TOKEN")  # Required for 2FA (if enabled)

# URL of Angel One's OpenAPI Scrip Master JSON
URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

def get_symbol_token_by_name(name, exchange="NSE"):
    try:
        # Fetch JSON data
        response = requests.get(URL)
        data = response.json()

        # Search for the stock by name (case-insensitive match)
        for item in data:
            if item["name"].lower() == name.lower() and item["exch_seg"] == exchange:
                return item["token"]  # Return the token directly

        return None  # Return None if the stock is not found

    except Exception as e:
        logger.error(f"Error fetching token: {str(e)}")
        return None

def fetch_historical_data_in_chunks(smartApi, token, start_date, end_date, interval="ONE_MINUTE"):
    all_data = []
    current_start_date = start_date

    while current_start_date < end_date:
        # Calculate the end date for the current chunk (e.g., 1 month)
        current_end_date = current_start_date + timedelta(days=30)  # Adjust chunk size as needed
        if current_end_date > end_date:
            current_end_date = end_date

        # Format dates for the API
        from_date_str = current_start_date.strftime("%Y-%m-%d %H:%M")
        to_date_str = current_end_date.strftime("%Y-%m-%d %H:%M")

        # Fetch historical data for the current chunk
        historicParam = {
            "exchange": "NSE",  # Exchange (NSE/BSE)
            "symboltoken": token,  # Use the fetched token
            "interval": interval,  # Interval (1 minute)
            "fromdate": from_date_str,  # Start date and time
            "todate": to_date_str,  # End date and time
        }
        historical_data = None
        for attempt in range(5):
            try:
                historical_data = smartApi.getCandleData(historicParam)
                break
            except Exception as e:
                if "access rate" in str(e).lower() and attempt < 4:
                    wait = 2 ** attempt
                    logger.warning(f"Rate limited, retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    raise

        # Check if data is fetched successfully
        if historical_data and "data" in historical_data:
            all_data.extend(historical_data["data"])
            logger.info(f"✅ Fetched data from {from_date_str} to {to_date_str}")
        else:
            logger.error(f"❌ Error fetching data from {from_date_str} to {to_date_str}")

        # Move to the next chunk
        current_start_date = current_end_date
        time.sleep(0.5)

    return all_data

# Example: Fetch token for "NIFTY"
stock_name = "RELIANCE"
INTERVAL = "FIFTEEN_MINUTE"
token = get_symbol_token_by_name(stock_name)

if not token:
    logger.error(f"Stock name '{stock_name}' not found or token could not be fetched.")
    exit()

# Initialize SmartAPI
smartApi = SmartConnect(api_key=API_KEY)

# Generate TOTP (if 2FA is enabled)
try:
    totp = pyotp.TOTP(TOTP_TOKEN).now()
except Exception as e:
    logger.error("Invalid Token: The provided token is not valid.")
    raise e

# Authenticate
data = smartApi.generateSession(CLIENT_ID, SECRET_KEY, totp)

if data['status'] == False:
    logger.error("Authentication Failed:", data)
else:
    logger.info("✅ Successfully Authenticated")
    authToken = data['data']['jwtToken']
    refreshToken = data['data']['refreshToken']

    # Define date range for more than one year
    start_date = datetime(2024, 1, 1)  # Start date
    end_date = datetime(2026, 6, 7)  # End date

    # Fetch historical data in chunks
    try:
        historical_data = fetch_historical_data_in_chunks(
            smartApi, token, start_date, end_date, interval=INTERVAL
        )

        if historical_data:
            logger.info("✅ Historical Data Fetched Successfully")

            # Define the directory and file path
            directory = "/Users/priyanshu/Desktop/Project icAP"
            csv_file = os.path.join(directory, f"{stock_name}_historical_data_15min.csv")

            # Create the directory if it doesn't exist
            os.makedirs(directory, exist_ok=True)

            # Write data to CSV
            with open(csv_file, mode="w", newline="") as file:
                writer = csv.writer(file)
                # Write header
                writer.writerow(["Timestamp", "Open", "High", "Low", "Close", "Volume"])
                # Write each candle (15-minute data)
                for candle in historical_data:
                    writer.writerow(candle)

            logger.info(f"✅ Historical Data Saved to {csv_file}")
        else:
            logger.error("❌ No data fetched.")

    except Exception as e:
        logger.exception(f"Historic API failed: {e}")

    # Logout
    try:
        logout = smartApi.terminateSession(CLIENT_ID)
        logger.info("✅ Logout Successful")
    except Exception as e:
        logger.exception(f"Logout failed: {e}")