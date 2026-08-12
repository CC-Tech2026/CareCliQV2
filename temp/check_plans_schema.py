#!/usr/bin/env python3
from backend.app.core.database import supabase_client
import json

# Check the actual structure of the plans table
try:
    response = supabase_client.table('plans').select('*').limit(1).execute()
    if response.data:
        plan = response.data[0]
        print("Sample plan structure found:")
        print(json.dumps(plan, indent=2, default=str))
    else:
        print("No plans exist yet. Checking table schema...")
        # Try to create a test plan and see what fields are required
except Exception as e:
    print(f"Error: {e}")

# Check what fields the plans table accepts
try:
    print("\nAttempting to query plans table schema...")
    response = supabase_client.table('plans').select().limit(0).execute()
    print(f"Plans table exists and is accessible")
except Exception as e:
    print(f"Error accessing plans table: {e}")
