from backend.app.services.supabase_client import get_supabase_admin
import uuid
from datetime import datetime, timezone

supabase = get_supabase_admin()

# Test 1: Try without created_by but with shift_type
print("Test 1: Without created_by but with shift_type")
payload1 = {
    'id': str(uuid.uuid4()),
    'organization_id': 'test-org',
    'participant_id': 'test-participant',
    'participant_name': 'Test User',
    'shift_type': 'standard_support',
    'scheduled_start': datetime.now(timezone.utc).isoformat(),
    'scheduled_end': datetime.now(timezone.utc).isoformat(),
    'duration_minutes': 240,
    'status': 'unassigned',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'updated_at': datetime.now(timezone.utc).isoformat(),
}

try:
    result = supabase.table('shifts').insert(payload1).execute()
    print('Insert succeeded')
except Exception as e:
    print('Error:', str(e))
    print()

# Test 2: Try without both created_by and shift_type
print("Test 2: Without created_by and shift_type")
payload2 = {
    'id': str(uuid.uuid4()),
    'organization_id': 'test-org',
    'participant_id': 'test-participant',
    'participant_name': 'Test User',
    'scheduled_start': datetime.now(timezone.utc).isoformat(),
    'scheduled_end': datetime.now(timezone.utc).isoformat(),
    'duration_minutes': 240,
    'status': 'unassigned',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'updated_at': datetime.now(timezone.utc).isoformat(),
}

try:
    result = supabase.table('shifts').insert(payload2).execute()
    print('Insert succeeded!')
    print('Inserted shift ID:', result.data[0]['id'])
except Exception as e:
    print('Error:', str(e))
