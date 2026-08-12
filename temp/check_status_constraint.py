import os
import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

supabase = get_supabase_admin()

# Query the information_schema to find the constraint definition
try:
    # Try to get all shifts with different statuses
    print("Querying shifts by status...")
    for status in ['unassigned', 'scheduled', 'in_progress', 'clocked_in', 'completed', 'cancelled']:
        result = supabase.table('shifts').select('count', count='exact').eq('status', status).execute()
        count = result.count
        print(f"  {status}: {count} shifts")
except Exception as e:
    print(f'Error: {e}')

print("\nAttempting to find constraint definition...")
# We know the constraint rejects 'unassigned', so it's not in the current definition
# Let's test a known valid status to see what works

payload = {
    'id': 'test-scheduled-shift',
    'organization_id': 'a1111111-1111-1111-1111-111111111111',
    'participant_id': 'test-participant',
    'participant_name': 'Test User',
    'worker_id': '00000000-0000-0000-0000-000000000000',
    'scheduled_start': '2026-06-30T12:00:00Z',
    'scheduled_end': '2026-06-30T13:00:00Z',
    'duration_minutes': 60,
    'status': 'scheduled',  # Try with scheduled status
    'created_at': '2026-06-30T12:00:00Z',
    'updated_at': '2026-06-30T12:00:00Z',
}

try:
    result = supabase.table('shifts').insert(payload).execute()
    print('✅ Insert with "scheduled" status succeeded')
    print('This confirms the constraint allows "scheduled" but not "unassigned"')
    # Clean up
    supabase.table('shifts').delete().eq('id', 'test-scheduled-shift').execute()
except Exception as e:
    print(f'Even "scheduled" failed: {e}')
