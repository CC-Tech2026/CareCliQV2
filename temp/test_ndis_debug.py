#!/usr/bin/env python
"""
Debug NDIS pricing 404 issue.
Check: Are items in database? What's the right query format?
"""
import os
import sys
import json
from datetime import date

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.core.config import settings
from app.services.supabase_client import get_supabase_admin

async def main():
    supabase = get_supabase_admin()
    
    org_id = "a1111111-1111-1111-1111-111111111111"
    item_code = "01_011_0107_1_1"
    
    print("=" * 80)
    print("STEP 1: Check if items exist in database at all")
    print("=" * 80)
    try:
        result = supabase.table("ndis_price_items").select("count").execute()
        print(f"✓ Total items in table: {result.data}")
    except Exception as e:
        print(f"✗ Error counting items: {e}")
        return
    
    print("\n" + "=" * 80)
    print("STEP 2: List first 5 items to see structure")
    print("=" * 80)
    try:
        result = supabase.table("ndis_price_items").select("*").limit(5).execute()
        if result.data:
            for item in result.data[:5]:
                print(f"\nItem:")
                for key in ["id", "item_code", "organization_id", "name", "valid_from", "valid_to"]:
                    print(f"  {key}: {item.get(key)}")
        else:
            print("✗ No items found")
    except Exception as e:
        print(f"✗ Error: {e}")
        return
    
    print("\n" + "=" * 80)
    print(f"STEP 3: Query for specific item_code='{item_code}' (no org filter)")
    print("=" * 80)
    try:
        result = supabase.table("ndis_price_items").select("*").eq("item_code", item_code).execute()
        print(f"Found {len(result.data)} items")
        if result.data:
            print(json.dumps(result.data[0], indent=2, default=str))
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("\n" + "=" * 80)
    print(f"STEP 4: Query with org_id filter")
    print("=" * 80)
    try:
        result = supabase.table("ndis_price_items").select("*").eq("item_code", item_code).eq("organization_id", org_id).execute()
        print(f"Found {len(result.data)} items for org {org_id}")
        if result.data:
            print(json.dumps(result.data[0], indent=2, default=str))
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("\n" + "=" * 80)
    print(f"STEP 5: Query with valid_from date filter")
    print("=" * 80)
    try:
        today = date.today().isoformat()
        result = (
            supabase.table("ndis_price_items")
            .select("*")
            .eq("item_code", item_code)
            .eq("organization_id", org_id)
            .lte("valid_from", today)
            .order("valid_from", desc=True)
            .limit(1)
            .execute()
        )
        print(f"Found {len(result.data)} items")
        if result.data:
            print(json.dumps(result.data[0], indent=2, default=str))
        else:
            print("✗ No items found - check valid_from dates")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    print("\n" + "=" * 80)
    print("STEP 6: Check if RLS is blocking access")
    print("=" * 80)
    try:
        # Try with service role (should bypass RLS if that's the issue)
        result = supabase.table("ndis_price_items").select("organization_id, item_code").limit(5).execute()
        print(f"✓ Service role can access. Organization IDs present:")
        orgs = set()
        for item in result.data:
            orgs.add(item.get("organization_id"))
        for org in sorted(list(orgs)):
            print(f"  - {org}")
    except Exception as e:
        print(f"✗ RLS error: {e}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
