#!/usr/bin/env python
"""
Test PostgREST query format directly with requests.
Compare SDK vs direct HTTP requests.
"""
import os
import sys
import json
import requests
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from app.core.config import settings

def test_postgrest_query():
    org_id = "a1111111-1111-1111-1111-111111111111"
    item_code = "01_011_0107_1_1"
    as_of_date = date.today().isoformat()
    
    url = f"{settings.supabase_url}/rest/v1/ndis_price_items"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    
    print("=" * 80)
    print("TEST 1: Simple query - just item_code")
    print("=" * 80)
    params = {
        "item_code": f"eq.{item_code}",
    }
    print(f"URL: {url}")
    print(f"Params: {params}")
    try:
        response = requests.get(url, params=params, headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Found: {len(data)} items")
        if data:
            print(f"First item: {data[0]['item_code']}")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("\n" + "=" * 80)
    print("TEST 2: With organization_id filter")
    print("=" * 80)
    params = {
        "item_code": f"eq.{item_code}",
        "organization_id": f"eq.{org_id}",
    }
    print(f"Params: {params}")
    try:
        response = requests.get(url, params=params, headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Found: {len(data)} items")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("\n" + "=" * 80)
    print("TEST 3: With date filter")
    print("=" * 80)
    params = {
        "item_code": f"eq.{item_code}",
        "organization_id": f"eq.{org_id}",
        "valid_from": f"lte.{as_of_date}",
    }
    print(f"Params: {params}")
    try:
        response = requests.get(url, params=params, headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Found: {len(data)} items")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("\n" + "=" * 80)
    print("TEST 4: With ordering")
    print("=" * 80)
    params = {
        "item_code": f"eq.{item_code}",
        "organization_id": f"eq.{org_id}",
        "valid_from": f"lte.{as_of_date}",
        "order": "valid_from.desc",
        "limit": "1",
    }
    print(f"Params: {params}")
    try:
        response = requests.get(url, params=params, headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Found: {len(data)} items")
        if data:
            print(f"Item: {json.dumps(data[0], indent=2, default=str)}")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("\n" + "=" * 80)
    print("TEST 5: Check what parameters were actually sent")
    print("=" * 80)
    import urllib.parse
    params = {
        "item_code": f"eq.{item_code}",
        "organization_id": f"eq.{org_id}",
        "valid_from": f"lte.{as_of_date}",
        "order": "valid_from.desc",
        "limit": "1",
    }
    query_string = urllib.parse.urlencode(params)
    print(f"Query string: {query_string}")
    print(f"Full URL: {url}?{query_string}")

if __name__ == "__main__":
    test_postgrest_query()
