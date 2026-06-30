#!/usr/bin/env python3
"""Execute participant tasks migration against Supabase database."""

import sys
import os
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

# Read the migration SQL
with open('backend/supabase/migrations/056_participant_tasks_instances.sql', 'r') as f:
    migration_sql = f.read()

try:
    supabase = get_supabase_admin()
    
    # Try to use the raw_sql method if available
    try:
        # Try the direct SQL method
        statements = [stmt.strip() for stmt in migration_sql.split(';') if stmt.strip()]
        
        print(f"Executing {len(statements)} SQL statements...")
        
        for i, statement in enumerate(statements, 1):
            # Try each statement
            try:
                # Use the from_ method on a table to get to raw SQL
                # This is a workaround since Supabase Python client doesn't directly expose raw SQL
                print(f"  Statement {i}/{len(statements)}: {statement[:50]}...")
                
                # For now, let's just print what we're trying to execute
                # Migrations will need to be applied through Supabase UI
                
            except Exception as e:
                print(f"    Error: {e}")
        
        print("\n⚠️  Direct SQL execution not available through Python SDK")
        print("\nTo apply this migration manually:")
        print("1. Go to https://supabase.com/dashboard/project/[PROJECT_ID]/sql")
        print("2. Open the SQL Editor")
        print("3. Copy the contents of: backend/supabase/migrations/056_participant_tasks_instances.sql")
        print("4. Paste and execute in the SQL Editor")
        
    except Exception as e:
        print(f"Error: {e}")
    
except Exception as exc:
    print(f"❌ Error: {exc}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
