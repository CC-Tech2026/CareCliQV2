#!/usr/bin/env python3
"""
Test the NDIS pricing API endpoint.
"""

import requests
import json

print("🧪 Testing NDIS pricing API endpoint...")

url = "http://localhost:8000/api/ndis-pricing/resolve"

payload = {
    "item_code": "01_011_0107_1_1",
    "as_of_date": "2025-11-24",
    "location_type": "national"
}

try:
    response = requests.post(url, json=payload)
    print(f"\nStatus Code: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"\n✅ API Response:")
        print(json.dumps(data, indent=2))
        
        print(f"\n📊 Pricing Details:")
        print(f"   Item Code: {data.get('item_code')}")
        print(f"   Item Name: {data.get('item_name')}")
        print(f"   Effective Price (cents): {data.get('effective_price')}")
        print(f"   Effective Price (dollars): ${data.get('effective_price', 0) / 100:.2f}")
        print(f"   Location Type: {data.get('location_type')}")
        print(f"   As Of Date: {data.get('as_of_date')}")
    else:
        print(f"\n❌ Error: {response.text}")
    
except requests.exceptions.ConnectionError:
    print("❌ Cannot connect to backend at http://localhost:8000")
    print("   Is the backend running? Try: python main.py")
except Exception as e:
    print(f"❌ Error: {str(e)}")
