import sys
import json
sys.path.insert(0, 'backend')

from app.services.ndis_pricing_service import load_price_schedule
from app.services.supabase_client import get_supabase_admin

# Load test data
with open('ndis_test_data.json', 'r') as f:
    source_json = json.load(f)

# Get the test user's organization
admin = get_supabase_admin()
users = admin.table('users').select('*').eq('email', 'sarah@sunshine-demo.com').execute()
if not users.data:
    print("ERROR: Test user not found")
    sys.exit(1)

user_org_id = users.data[0]['organization_id']
print(f"Using organization: {user_org_id}")

# Create mock user object (as support_coordinator)
test_user = {
    'id': users.data[0]['id'],
    'email': 'sarah@sunshine-demo.com',
    'role': 'support_coordinator',
    'organization_id': user_org_id,
}

# Call the service directly
async def test_load():
    try:
        result = await load_price_schedule(test_user, source_json)
        print("✅ Success:")
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(f"❌ Error: {e}")

import asyncio
asyncio.run(test_load())
