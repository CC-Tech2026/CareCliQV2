#!/usr/bin/env python
"""
Debug PostgREST authorization issue.
"""
import os
import sys
import requests
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from app.core.config import settings

def test_auth():
    org_id = "a1111111-1111-1111-1111-111111111111"
    item_code = "01_011_0107_1_1"
    
    url = f"{settings.supabase_url}/rest/v1/ndis_price_items"
    
    print("=" * 80)
    print("TEST: Check headers and auth")
    print("=" * 80)
    print(f"SUPABASE_URL: {settings.supabase_url}")
    print(f"Service Role Key (first 20 chars): {settings.supabase_service_role_key[:20]}...")
    
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    
    params = {
        "item_code": f"eq.{item_code}",
        "organization_id": f"eq.{org_id}",
        "limit": "1",
    }
    
    print(f"\nURL: {url}")
    print(f"Headers: {headers}")
    print(f"Params: {params}")
    
    response = requests.get(url, params=params, headers=headers, timeout=10)
    
    print(f"\nStatus Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}")
    print(f"Response Content-Type: {response.headers.get('content-type')}")
    print(f"Response Length: {len(response.content)}")
    print(f"Response Text (first 500 chars): {response.text[:500]}")
    
    try:
        data = response.json()
        print(f"\nJSON parsed successfully: {data}")
    except Exception as e:
        print(f"\nJSON parse error: {e}")

if __name__ == "__main__":
    test_auth()
