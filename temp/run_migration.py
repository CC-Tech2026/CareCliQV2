#!/usr/bin/env python3
"""Execute NDIS pricing SQL migration against Supabase database."""

import sys
import os
import json
import http.client
sys.path.insert(0, 'backend')

from app.core.config import settings

# Read the migration SQL
with open('backend/supabase/migrations/020_ndis_pricing_functions.sql', 'r') as f:
    migration_sql = f.read()

# Extract Supabase project ID and API key from config
supabase_url = settings.supabase_url.replace('https://', '').replace('http://', '')
service_role_key = settings.supabase_service_role_key

# Extract host and project_id
# Format: project-id.supabase.co
project_id = supabase_url.split('.')[0]

try:
    # Use HTTP client to execute SQL via Supabase REST API
    conn = http.client.HTTPSConnection(supabase_url)
    
    # Prepare headers with authorization
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {service_role_key}',
        'apikey': service_role_key,
    }
    
    # Supabase SQL RPC endpoint
    body = json.dumps({'query': migration_sql})
    
    # Try the SQL RPC endpoint
    conn.request('POST', '/rest/v1/rpc/sql', body, headers)
    response = conn.getresponse()
    response_text = response.read().decode()
    
    if response.status == 200:
        print("✅ Migration executed successfully!")
        print(f"Response: {response_text[:200]}")
    else:
        print(f"⚠️  SQL RPC returned {response.status}: {response_text[:200]}")
        raise Exception(f"HTTP {response.status}")
        
    conn.close()
    
except Exception as e:
    print(f"❌ Migration failed: {str(e)}")
    print("\n📋 Instead, manually paste this SQL into Supabase SQL Editor:")
    print("=" * 80)
    print(migration_sql[:500] + "\n... (truncated)")
    print("=" * 80)
    sys.exit(1)
