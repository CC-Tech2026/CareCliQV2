#!/usr/bin/env python3
"""Test the NDIS pricing API endpoint."""

import requests
import json

# Create a valid JWT token for the test
# This will be verified against the backend's secret_key
from datetime import datetime, timedelta, timezone
import jwt

SECRET_KEY = "changeme-in-production"  # from backend config
ALGORITHM = "HS256"

# Create a valid token for the test coordinator
payload = {
    "sub": "a1111111-1111-1111-1111-111111111111",
    "email": "sarah@sunshine-demo.com",
    "role": "support_coordinator",
    "account_type": "organization",
    "organization_id": "a1111111-1111-1111-1111-111111111111",
}

token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

print(f"Token: {token}")

# Test the API endpoint
url = "http://localhost:8000/api/ndis-pricing/resolve"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
}

body = {
    "item_code": "01_011_0107_1_1",
    "location_type": "national"
}

print(f"\nTesting endpoint: POST {url}")
print(f"Body: {json.dumps(body, indent=2)}")

try:
    response = requests.post(url, json=body, headers=headers, timeout=5)
    print(f"\nStatus Code: {response.status_code}")
    print(f"Response:\n{json.dumps(response.json(), indent=2)}")
    
    if response.status_code == 200:
        data = response.json()
        price = data.get('effective_price', 0)
        print(f"\n✓ SUCCESS: Price resolved to ${price/100:.2f}/hour")
    else:
        print(f"\n✗ FAILED with status {response.status_code}")
except Exception as e:
    print(f"\n✗ ERROR: {e}")
