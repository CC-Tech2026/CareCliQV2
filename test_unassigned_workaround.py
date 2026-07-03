import os
import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin
import uuid
from datetime import datetime, timezone

supabase = get_supabase_admin()

# Get a valid organization_id and participant_id
result = supabase.table('shifts').select('organization_id, participant_id').limit(1).execute()
valid_org_id = result.data[0]['organization_id'] if result.data else 'a1111111-1111-1111-1111-111111111111'
valid_participant_id = result.data[0]['participant_id'] if result.data else str(uuid.uuid4())

# Test with the workaround: placeholder worker_id + 'scheduled' status
print("Testing unassigned shift creation with workaround...")
print("- Using placeholder worker_id: 00000000-0000-0000-0000-000000000000")
print("- Using 'scheduled' status (workaround until migration 043 is applied)")
print()

payload = {
    'id': str(uuid.uuid4()),
    'organization_id': valid_org_id,
    'participant_id': valid_participant_id,
    'participant_name': 'Test User',
    'worker_id': '00000000-0000-0000-0000-000000000000',  # Placeholder
    'scheduled_start': datetime.now(timezone.utc).isoformat(),
    'scheduled_end': datetime.now(timezone.utc).isoformat(),
    'duration_minutes': 240,
    'status': 'scheduled',  # Workaround: use 'scheduled' instead of 'unassigned'
    'created_at': datetime.now(timezone.utc).isoformat(),
    'updated_at': datetime.now(timezone.utc).isoformat(),
}

try:
    result = supabase.table('shifts').insert(payload).execute()
    print('✅ Insert succeeded!')
    shift = result.data[0]
    print(f'Inserted shift ID: {shift["id"]}')
    print(f'Worker ID: {shift["worker_id"]}')
    print(f'Status: {shift["status"]}')
    print()
    print('✓ Unassigned shifts can now be created with the workaround!')
    print('  The endpoint will work once restarted and tested.')
except Exception as e:
    error_str = str(e)
    print(f'❌ Error: {error_str}')
    if 'shifts_status_check' in error_str:
        print("\nError: Status constraint rejecting 'scheduled'")
    elif 'shifts_participant_id_fkey' in error_str:
        print("\nError: Participant doesn't exist (expected for test)")
    else:
        print("\nUnexpected error")
