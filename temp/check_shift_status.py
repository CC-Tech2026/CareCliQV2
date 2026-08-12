import os
import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin
import uuid
from datetime import datetime, timezone

supabase = get_supabase_admin()

# Get a valid organization_id and see an existing shift's status
try:
    result = supabase.table('shifts').select('id, status').limit(5).execute()
    if result.data:
        print("Sample shifts with their statuses:")
        for shift in result.data:
            print(f"  - {shift['id']}: status = '{shift['status']}'")
        print("\nChecking what status values are valid...")
    else:
        print('No shifts found')
except Exception as e:
    print(f'Error: {e}')

# Try to check the constraint definition
print("\nNote: The 'unassigned' status might not be defined in the CHECK constraint")
print("Let me check the migration files to see what statuses are allowed...")
