from backend.app.services.supabase_client import get_supabase_admin

supabase = get_supabase_admin()

# Get the full schema for the shifts table
try:
    # Query information_schema to get column details
    result = supabase.rpc(
        'get_column_info',
        {
            'table_name': 'shifts',
            'schema_name': 'public'
        }
    ).execute()
    print('RPC result:', result.data)
except Exception as e:
    print('RPC error:', e)

# Try a different approach - select from information_schema directly
# But supabase-py might not support raw SQL
# Let's check the shifts table structure by inspection
try:
    # Try inserting with NULL worker_id explicitly
    print("\nTesting if worker_id can be NULL:")
    result = supabase.table('shifts').insert({
        'id': '00000000-0000-0000-0000-000000000001',
        'organization_id': 'a1111111-1111-1111-1111-111111111111',
        'participant_id': '00000000-0000-0000-0000-000000000002',
        'participant_name': 'Test',
        'scheduled_start': '2026-06-30T12:00:00Z',
        'scheduled_end': '2026-06-30T13:00:00Z',
        'duration_minutes': 60,
        'status': 'unassigned',
        'worker_id': None,  # Explicitly NULL
        'created_at': '2026-06-30T11:59:00Z',
        'updated_at': '2026-06-30T11:59:00Z',
    }).execute()
    print('Success with NULL worker_id!')
except Exception as e:
    print('Error with NULL worker_id:', str(e))
