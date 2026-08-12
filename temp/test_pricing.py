#!/usr/bin/env python3
"""
Test NDIS pricing resolution API.
"""

import sys
import json
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin
from datetime import date

admin = get_supabase_admin()
org_id = "a1111111-1111-1111-1111-111111111111"

print("🔍 Testing NDIS pricing resolution...")

# Test with a known item code from the loaded data
test_item_code = "01_011_0107_1_1"

try:
    # Query the items table to verify
    items = admin.table("ndis_price_items").select("id, item_code, name, price_national").eq("item_code", test_item_code).eq("organization_id", org_id).execute()
    
    if items.data:
        item = items.data[0]
        print(f"\n✅ Found item in database:")
        print(f"   Code: {item.get('item_code')}")
        print(f"   Name: {item.get('name')}")
        print(f"   Price (cents): {item.get('price_national')}")
        print(f"   Price (dollars): ${item.get('price_national') / 100:.2f}")
    else:
        print(f"❌ Item {test_item_code} not found")
        sys.exit(1)
    
    # Also verify total count
    all_items = admin.table("ndis_price_items").select("id").eq("organization_id", org_id).execute()
    print(f"\n📊 Total items in organization: {len(all_items.data)}")
    
    print(f"\n✅ Backend can access pricing data!")
    print(f"\n🧪 Next: Test with curl or frontend:")
    print(f"   curl -X POST http://localhost:8000/api/ndis-pricing/resolve \\")
    print(f"     -H 'Content-Type: application/json' \\")
    payload = {"item_code": test_item_code, "as_of_date": "2025-11-24", "location_type": "national"}
    print(f"     -d '{json.dumps(payload)}'")    
except Exception as e:
    print(f"❌ Error: {str(e)[:200]}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
