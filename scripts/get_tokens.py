import requests
import json

URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

TARGET_SYMBOLS = [
    "ADANIPOWER", "ZOMATO", "HDFCBANK", "ICICIBANK", 
    "MIFL", "NIFTY", "RELIANCE", "SBIN", "SWIGGY", 
    "VEDL", "WIPRO", "INFY", "TCS", "BANKNIFTY"
]

print(f"Downloading Scrip Master from {URL}...")
try:
    response = requests.get(URL)
    data = response.json()
    print(f"Downloaded {len(data)} scrips.")
    
    found_tokens = {}
    
    for scrip in data:
        name = scrip.get("name")
        symbol = scrip.get("symbol")
        exch_seg = scrip.get("exch_seg")
        
        # We want NSE Equity (NSE_CM) which usually has exch_seg 'NSE'
        # For indices like NIFTY, it might be different.
        
        if name in TARGET_SYMBOLS and exch_seg == "NSE":
            if symbol.endswith("-EQ"):
                found_tokens[name] = {
                    "token": scrip.get("token"),
                    "symbol": symbol,
                    "name": name,
                    "exch_seg": exch_seg
                }

        # Debug: Exhaustive ZOMATO search
        if "ZOM" in name_upper or "ZOM" in symbol_upper:
             print(f"DEBUG ZOMATO ALL: {name}, {symbol}, {exch_seg}, {scrip.get('token')}")

        if name == "ZOMATO" or "ZOMATO" in symbol: # Keep original logic but it might fail if case sensitive match failed
             if exch_seg == "NSE" and symbol.endswith("-EQ"):
                found_tokens["ZOMATO"] = {
                    "token": scrip.get("token"),
                    "symbol": symbol,
                    "name": name,
                    "exch_seg": exch_seg
                }

        if name == "MIFL" or symbol == "MIFL":
             # Dashboard says BSE: MIFL
             if exch_seg == "BSE_CM" or exch_seg == "BSE": # Try wider BSE check
                found_tokens["MIFL"] = {
                    "token": scrip.get("token"),
                    "symbol": symbol,
                    "name": name,
                    "exch_seg": exch_seg
                }
        
        # Special case for Indices
        if name in ["NIFTY", "BANKNIFTY"] and exch_seg == "NSE":
             found_tokens[name] = {
                    "token": scrip.get("token"),
                    "symbol": symbol,
                    "name": name,
                    "exch_seg": exch_seg
                }

    print("\nFound Tokens:")
    print(json.dumps(found_tokens, indent=2))

except Exception as e:
    print(f"Error: {e}")
