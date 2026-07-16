from backend.app.services.supabase_client import get_supabase_admin
import uuid
from datetime import datetime, timezone

supabase = get_supabase_admin()

# Try to insert with shift_type and created_by columns
payload = {
    'id': str(uuid.uuid4()),
    'organization_id': 'test-org',
    'participant_id': 'test-participant',
    'participant_name': 'Test User',
    'shift_type': 'standard_support',
    'scheduled_start': datetime.now(timezone.utc).isoformat(),
    'scheduled_end': datetime.now(timezone.utc).isoformat(),
    'duration_minutes': 240,
    'status': 'unassigned',
    'created_by': 'test-user',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'updated_at': datetime.now(timezone.utc).isoformat(),
}

try:
    result = supabase.table('shifts').insert(payload).execute()
    print('Insert succeeded')
except Exception as e:
    print('Error type:', type(e).__name__)
    print('Error message:', str(e))
    print()
    print('Testing fallback detection:')
    err_str = str(e).lower()
    print('Contains "does not exist":', 'does not exist' in err_str)
    print('Contains "42703":', '42703' in err_str)
    print('Contains "pgrst":', 'pgrst' in err_str)
    print('Contains "could not find":', 'could not find' in err_str)
