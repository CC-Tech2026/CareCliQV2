import sys
sys.path.insert(0, 'backend')
from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()

# Check ndis_price_schedules
schedules = admin.table('ndis_price_schedules').select('*').execute()
print(f'✅ Schedules count: {len(schedules.data)}')

# Check ndis_price_items  
items = admin.table('ndis_price_items').select('*').limit(5).execute()
print(f'✅ Items count: {len(items.data)}')
if items.data:
    for item in items.data[:2]:
        code = item.get('item_code')
        name = item.get('name')
        print(f'   - {code}: {name}')
else:
    print('   - No items found')
