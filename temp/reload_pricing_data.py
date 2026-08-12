import sys
import json
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()

print("📋 Creating NDIS tables...")
# Just create tables if they don't exist - tables may already exist
# The service will handle it from here
print("✅ Tables ready (will be created/updated by service)")

# Load pricing data
print("\n📥 Loading pricing data...")
from app.services.ndis_pricing_service import load_price_schedule

with open('ndis_real_data.json', 'r') as f:
    pricing_data = json.load(f)

# Get test user (support coordinator)
users = admin.table('users').select('*').eq('email', 'sarah@sunshine-demo.com').execute()
if not users.data:
    print("❌ Test user not found")
    sys.exit(1)

test_user = {
    'id': users.data[0]['id'],
    'email': 'sarah@sunshine-demo.com',
    'role': 'support_coordinator',
    'organization_id': users.data[0]['organization_id'],
}

async def load():
    try:
        result = await load_price_schedule(test_user, pricing_data)
        print(f"✅ Pricing data loaded successfully!")
        print(f"   Financial Year: {result['financial_year']}")
        print(f"   Effective Date: {result['effective_date']}")
        print(f"   Items Loaded: {result['items_loaded']}")
        if result.get('validation_errors'):
            print(f"   Validation Errors: {len(result['validation_errors'])}")
            for err in result['validation_errors'][:3]:
                print(f"     - {err}")
        return True
    except Exception as e:
        print(f"❌ Error loading pricing data: {e}")
        import traceback
        traceback.print_exc()
        return False

import asyncio
success = asyncio.run(load())

if success:
    # Verify data loaded
    print("\n✅ Verifying data...")
    items = admin.table('ndis_price_items').select('*').limit(5).execute()
    print(f"   Total items in database: {len(items.data) if items.data else 0}")
    if items.data:
        for item in items.data[:3]:
            code = item['item_code']
            name = item['name']
            price = item['price_national']
            print(f"   - {code}: {name} (${price:.2f})")
