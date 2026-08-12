from backend.app.services.supabase_client import get_supabase_admin
import uuid
from datetime import datetime, timezone

supabase = get_supabase_admin()

# Get a valid organization_id from the database
try:
    result = supabase.table('shifts').select('organization_id').limit(1).execute()
    if result.data:
        valid_org_id = result.data[0]['organization_id']
        print(f'Using valid org_id: {valid_org_id}')
    else:
        print('No shifts found, using test org')
        valid_org_id = '550e8400-e29b-41d4-a716-446655440000'
except Exception as e:
    print(f'Error getting org_id: {e}')
    valid_org_id = '550e8400-e29b-41d4-a716-446655440000'

# Test without both created_by and shift_type
print("\nTesting insert without problematic columns:")
payload = {
    'id': str(uuid.uuid4()),
    'organization_id': valid_org_id,
    'participant_id': str(uuid.uuid4()),
    'participant_name': 'Test User',
    'scheduled_start': datetime.now(timezone.utc).isoformat(),
    'scheduled_end': datetime.now(timezone.utc).isoformat(),
    'duration_minutes': 240,
    'status': 'unassigned',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'updated_at': datetime.now(timezone.utc).isoformat(),
}

try:
    result = supabase.table('shifts').insert(payload).execute()
    print('Insert succeeded!')
    print('Inserted shift ID:', result.data[0]['id'])
except Exception as e:
    print('Error:', str(e))
