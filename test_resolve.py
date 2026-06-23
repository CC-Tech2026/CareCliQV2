#!/usr/bin/env python3
"""
Verify backend can reach the database and resolve prices.
"""

import sys
import asyncio
sys.path.insert(0, 'backend')

from app.services.ndis_pricing_service import resolve_price
from datetime import date

async def main():
    print("🔍 Testing price resolution logic...")

    try:
        org_id = "a1111111-1111-1111-1111-111111111111"
        item_code = "01_011_0107_1_1"
        as_of_date = date.fromisoformat("2025-11-24")
        location_type = "national"
        
        print(f"   Item Code: {item_code}")
        print(f"   Organization: {org_id}")
        print(f"   As Of Date: {as_of_date}")
        print(f"   Location Type: {location_type}")
        
        # This should work now that we have data
        result = await resolve_price(
            item_code=item_code,
            org_id=org_id,
            as_of_date=as_of_date,
            location_type=location_type
        )
        
        print(f"\n✅ Resolution successful!")
        print(f"   Effective Price: {result.get('effective_price')} cents (${result.get('effective_price', 0) / 100:.2f})")
        print(f"   Item Name: {result.get('item_name')}")
        print(f"   Source: {result.get('effective_price_source')}")
        print(f"\n✅ BACKEND DATA RESOLUTION WORKING!")
        
    except ImportError as e:
        print(f"❌ Import error: {str(e)}")
        print("   (This is expected if ndis_pricing_service.py isn't available)")
    except Exception as e:
        print(f"❌ Error: {str(e)[:200]}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
