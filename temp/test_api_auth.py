#!/usr/bin/env python3
"""
Test the NDIS pricing API endpoint with authentication.
"""

import requests
import json
import os
import sys

sys.path.insert(0, 'backend')

from app.services.auth_service import AuthService
from app.models import LoginRequest

print("🧪 Testing NDIS pricing API endpoint with auth...")

# Test credentials (from conversation history)
email = "sarah@sunshine-demo.com"
password = "Sarahsunshine#2026"

auth_service = AuthService()

try:
    # Login to get token
    print(f"🔐 Logging in as {email}...")
    login_request = LoginRequest(email=email, password=password)
    auth_result = auth_service.login(login_request)
    
    if not auth_result:
        print("❌ Login failed")
        sys.exit(1)
    
    access_token = auth_result.get("access_token")
    print(f"✅ Login successful, got token")
    
    # Now test the API with the token
    url = "http://localhost:8000/api/ndis-pricing/resolve"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "item_code": "01_011_0107_1_1",
        "as_of_date": "2025-11-24",
        "location_type": "national"
    }
    
    print(f"\n📍 Testing endpoint: {url}")
    response = requests.post(url, json=payload, headers=headers)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"\n✅ API Response:")
        print(json.dumps(data, indent=2))
        
        if "effective_price" in data:
            print(f"\n📊 Pricing Details:")
            print(f"   Item Code: {data.get('item_code')}")
            print(f"   Item Name: {data.get('item_name')}")
            print(f"   Effective Price (cents): {data.get('effective_price')}")
            print(f"   Effective Price (dollars): ${data.get('effective_price', 0) / 100:.2f}")
            print(f"\n✅ PRICING RESOLUTION WORKING!")
    else:
        print(f"\n❌ Error: {response.text}")
    
except requests.exceptions.ConnectionError:
    print("❌ Cannot connect to backend at http://localhost:8000")
    print("   Is the backend running? Try: python main.py")
except Exception as e:
    print(f"❌ Error: {str(e)}")
    import traceback
    traceback.print_exc()
