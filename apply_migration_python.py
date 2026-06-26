#!/usr/bin/env python3
"""Apply Supabase migration using Python and HTTP requests."""

import sys
import os
import json
import urllib.request
import urllib.error

sys.path.insert(0, 'backend')

from app.core.config import settings

print("=" * 70)
print("Supabase Migration Applicator")
print("=" * 70)
print()

# Get configuration
supabase_url = settings.supabase_url
service_role_key = settings.supabase_service_role_key

if not supabase_url or not service_role_key:
    print("❌ Error: Supabase configuration not found")
    print()
    print("Please ensure environment variables are set:")
    print("  SUPABASE_URL=https://PROJECT_ID.supabase.co")
    print("  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key")
    print()
    sys.exit(1)

# Extract project ID
import re
match = re.match(r"https://(.+?)\.supabase\.co", supabase_url)
if not match:
    print(f"❌ Error: Invalid Supabase URL format: {supabase_url}")
    sys.exit(1)

project_id = match.group(1)

print(f"Project ID: {project_id}")
print(f"Supabase URL: {supabase_url}")
print()

# Read migration file
migration_file = "backend/supabase/migrations/056_participant_tasks_instances.sql"
if not os.path.exists(migration_file):
    print(f"❌ Error: Migration file not found: {migration_file}")
    sys.exit(1)

with open(migration_file, 'r') as f:
    sql_content = f.read()

print(f"Migration file: {migration_file}")
print(f"File size: {len(sql_content)} bytes")
print()

# Try to execute via HTTP API
print("Attempting to execute migration via Supabase SQL endpoint...")
print()

try:
    # Prepare the request
    uri = f"https://{project_id}.supabase.co/rest/v1/rpc/sql"
    
    headers = {
        "Authorization": f"Bearer {service_role_key}",
        "apikey": service_role_key,
        "Content-Type": "application/json"
    }
    
    body = json.dumps({
        "query": sql_content
    }).encode('utf-8')
    
    print(f"Endpoint: POST {uri}")
    print()
    
    # Make the request
    req = urllib.request.Request(uri, data=body, headers=headers, method='POST')
    
    try:
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode('utf-8')
            if response.status == 200:
                print("✅ Migration executed successfully!")
                print()
                print(f"Response: {response_text[:200]}")
                sys.exit(0)
    except urllib.error.HTTPError as e:
        error_text = e.read().decode('utf-8')
        print(f"⚠️  HTTP {e.code}: {error_text[:200]}")
        print()
        
except Exception as e:
    print(f"❌ Error: {e}")
    print()

# If we get here, automated method failed
print("=" * 70)
print("MANUAL MIGRATION REQUIRED")
print("=" * 70)
print()
print("The automated migration could not be applied.")
print("Please apply manually using the Supabase Web Dashboard:")
print()
print(f"1. Open: https://supabase.com/dashboard/project/{project_id}/sql")
print()
print("2. Click '+ New Query' button")
print()
print("3. Copy and paste this SQL:")
print()
print("-" * 70)
print(sql_content)
print("-" * 70)
print()
print("4. Click 'Run' button (or Cmd+Enter / Ctrl+Enter)")
print()
print("5. Wait for 'Success' message")
print()
print("6. Verify new tables in Table Editor:")
print("   - participant_tasks")
print("   - shift_tasks")
print()
print("=" * 70)
print()

sys.exit(1)
