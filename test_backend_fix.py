#!/usr/bin/env python3
"""Test the backend resolve_price fix."""

import sys
import asyncio
sys.path.insert(0, 'backend')

from backend.app.services.ndis_pricing_service import resolve_price


async def main():
    org_id = 'a1111111-1111-1111-1111-111111111111'
    print("Testing resolve_price function...")
    
    result = await resolve_price('01_011_0107_1_1', org_id, location_type='national')
    if result:
        price_dollars = result['effective_price'] / 100
        print(f'✓ Price resolved: ${price_dollars:.2f}')
        print(f'  Item: {result["item_code"]} - {result["name"]}')
        print(f'  Price (cents): {result["effective_price"]}')
        return True
    else:
        print('✗ Price not found')
        return False


if __name__ == '__main__':
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
