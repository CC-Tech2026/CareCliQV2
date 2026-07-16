import os
import glob

print("Searching for 'unassigned' in migration files...")
print("=" * 70)

migration_dir = 'backend/supabase/migrations'
matches = []

for filepath in glob.glob(f'{migration_dir}/*.sql'):
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
        if 'unassigned' in content.lower():
            filename = os.path.basename(filepath)
            # Count occurrences
            count = content.lower().count('unassigned')
            matches.append((filename, count))
            print(f"✓ {filename}: {count} mentions of 'unassigned'")

print("\n" + "=" * 70)
if matches:
    print(f"Found {len(matches)} migration file(s) that mention 'unassigned'")
    print("\nMigrations in order of files found:")
    for name, count in sorted(matches):
        print(f"  - {name}")
else:
    print("No migrations found that mention 'unassigned'")

# Now let's check if migration 043 has been applied by checking the constraint
print("\n" + "=" * 70)
print("Checking if migration 043 has been applied...")
print("Current shifts table status values in database:")

import sys
sys.path.insert(0, 'backend')
from app.services.supabase_client import get_supabase_admin

supabase = get_supabase_admin()

try:
    result = supabase.table('shifts').select('DISTINCT status').execute()
    current_statuses = [row['status'] for row in result.data]
    print(f"  {sorted(current_statuses)}")
    
    if 'unassigned' in current_statuses:
        print("✓ Migration 043 has been applied (unassigned status exists)")
    else:
        print("✗ Migration 043 has NOT been applied (unassigned status missing)")
except Exception as e:
    print(f"Error: {e}")
