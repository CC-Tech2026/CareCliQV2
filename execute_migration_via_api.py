import os
import requests
import json

# Get Supabase credentials from environment
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_ADMIN_KEY = os.getenv('SUPABASE_ADMIN_KEY')

if not SUPABASE_URL or not SUPABASE_ADMIN_KEY:
    print("Error: SUPABASE_URL and SUPABASE_ADMIN_KEY environment variables not set")
    exit(1)

# Read the migration SQL
with open('backend/supabase/migrations/077_make_worker_id_nullable.sql', 'r') as f:
    migration_sql = f.read()

print("=" * 70)
print("Attempting to apply migration via Supabase REST API")
print("=" * 70)

# Try method 1: Using the RPC endpoint if available
# Supabase doesn't have a direct SQL execution endpoint in the REST API,
# but we can try using postgres functions

# Method 2: Check if there's a migration function
headers = {
    'apikey': SUPABASE_ADMIN_KEY,
    'Authorization': f'Bearer {SUPABASE_ADMIN_KEY}',
    'Content-Type': 'application/json'
}

# Try to list available functions
try:
    url = f"{SUPABASE_URL}/rest/v1/rpc"
    print(f"\nAttempting to call Supabase RPC endpoint...")
    print(f"URL: {url}")
    
    # Try to execute via a hypothetical migration function
    # This won't work, but let's see what happens
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/execute_migration",
        headers=headers,
        json={'sql': migration_sql}
    )
    
    print(f"Response status: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")

print("\n" + "=" * 70)
print("Note: Supabase doesn't have a built-in SQL execution endpoint")
print("You must execute the migration manually via the Supabase dashboard")
print("=" * 70)
print("\nMigration SQL:")
print("-" * 70)
print(migration_sql)
print("-" * 70)
print("\nTo apply this migration:")
print("1. Go to https://app.supabase.com/project/[project-id]/sql/new")
print("2. Copy and paste the SQL above")
print("3. Click 'Run'")
print("=" * 70)
