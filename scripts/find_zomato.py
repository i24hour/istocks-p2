import requests

URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"

print("Downloading scrip master...")
data = requests.get(URL).json()

print("First item structure:", data[0])

print("\nSearching for token 543320 (Zomato BSE)...")
for scrip in data:
    if scrip.get('token') == '543320':
        print(f"Token 543320 is: {scrip}")

print("\nSearching for 'PAYTM'...")
for scrip in data:
    if "PAYTM" in str(scrip).upper():
        print(f"Found PAYTM: {scrip}")
        break
        
print("Done.")
