import os
import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin
import uuid
from datetime import datetime, timezone

supabase = get_supabase_admin()

# Get a valid organization_id
result = supabase.table('shifts').select('organization_id').limit(1).execute()
valid_org_id = result.data[0]['organization_id'] if result.data else 'a1111111-1111-1111-1111-111111111111'

# Test with the placeholder worker_id and valid status
print("Testing with placeholder worker_id...")
payload = {
    'id': str(uuid.uuid4()),
    'organization_id': valid_org_id,
    'participant_id': str(uuid.uuid4()),
    'participant_name': 'Test User',
    'worker_id': '00000000-0000-0000-0000-000000000000',  # Placeholder
    'scheduled_start': datetime.now(timezone.utc).isoformat(),
    'scheduled_end': datetime.now(timezone.utc).isoformat(),
    'duration_minutes': 240,
    'status': 'unassigned',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'updated_at': datetime.now(timezone.utc).isoformat(),
}

try:
    result = supabase.table('shifts').insert(payload).execute()
    print('✅ Insert succeeded!')
    print(f'Inserted shift ID: {result.data[0]["id"]}')
except Exception as e:
    error_str = str(e)
    print(f'❌ Error: {error_str}')
    
    # Check if it's a status constraint error
    if 'shifts_status_check' in error_str:
        print("\n⚠️ The 'unassigned' status is not in the CHECK constraint")
        print("This means migration 043_shift_scheduling_v2.sql hasn't been applied")
        print("\nNeed to add 'unassigned' to the valid statuses")
    elif 'worker_id' in error_str.lower():
        print("\n⚠️ Still having issues with worker_id")
    else:
        print(f"\n⚠️ Unexpected error")
