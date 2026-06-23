import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()

# Check if tables exist and what columns they have
print("📊 Checking current table schemas...")

try:
    schedules = admin.table('ndis_price_schedules').select('*').limit(0).execute()
    print("✅ ndis_price_schedules exists")
except Exception as e:
    if '404' in str(e) or 'not found' in str(e).lower():
        print("❌ ndis_price_schedules does NOT exist")
    else:
        print(f"⚠️ Error checking ndis_price_schedules: {str(e)[:80]}")

try:
    items = admin.table('ndis_price_items').select('*').limit(0).execute()
    print("✅ ndis_price_items exists")
except Exception as e:
    if '404' in str(e) or 'not found' in str(e).lower():
        print("❌ ndis_price_items does NOT exist")
    else:
        print(f"⚠️ Error checking ndis_price_items: {str(e)[:80]}")

# Now try to load pricing data
print("\n📥 Attempting to load pricing data...")

import json
from app.services.ndis_pricing_service import load_price_schedule

with open('ndis_real_data.json', 'r') as f:
    pricing_data = json.load(f)

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
        print(f"   Items Loaded: {result['items_loaded']}")
        return True
    except Exception as e:
        print(f"❌ Error loading: {e}")
        import traceback
        traceback.print_exc()
        return False

import asyncio
asyncio.run(load())
