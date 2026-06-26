#!/usr/bin/env python3
"""Apply the participant tasks migration to Supabase."""

import sys
import os
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

# Read the migration SQL
with open('backend/supabase/migrations/056_participant_tasks_instances.sql', 'r') as f:
    migration_sql = f.read()

print("=" * 70)
print("Applying Migration: 056_participant_tasks_instances.sql")
print("=" * 70)

try:
    supabase = get_supabase_admin()
    
    # Split statements by semicolon
    statements = [stmt.strip() for stmt in migration_sql.split(';') if stmt.strip()]
    
    print(f"\nFound {len(statements)} SQL statements to execute")
    print("\nExecuting statements...\n")
    
    for i, statement in enumerate(statements, 1):
        # Get a short description of what we're executing
        stmt_preview = statement[:60].replace('\n', ' ').strip()
        if len(statement) > 60:
            stmt_preview += "..."
        
        print(f"  [{i}/{len(statements)}] {stmt_preview}")
        
        try:
            # Use the Supabase client to execute the statement
            # We'll use the table query interface creatively
            if 'CREATE TABLE' in statement.upper():
                # For CREATE TABLE, we need to use a different approach
                # Try to use the raw query capability
                pass
            
            # Try executing via the auth or settings tables as a workaround
            # Actually, let's try a different approach - query the information schema
            
        except Exception as e:
            print(f"      ⚠️  Note: {type(e).__name__}")
    
    # The Supabase Python client doesn't directly expose raw SQL execution
    # We need to use a workaround or the HTTP API
    
    print("\n" + "=" * 70)
    print("⚠️  MIGRATION CANNOT BE APPLIED VIA PYTHON SDK")
    print("=" * 70)
    print("\nThe Supabase Python client doesn't support raw SQL execution.")
    print("Please apply the migration manually using the Supabase Web Dashboard:")
    print()
    print("1. Go to: https://supabase.com/dashboard/projects")
    print("2. Select your project")
    print("3. Click 'SQL Editor' in the sidebar")
    print("4. Click '+ New Query'")
    print("5. Copy the SQL from: backend/supabase/migrations/056_participant_tasks_instances.sql")
    print("6. Paste it into the editor")
    print("7. Click 'Run' (or press Cmd+Enter / Ctrl+Enter)")
    print()
    print("The migration will take about 5 seconds to complete.")
    print("=" * 70)
    
    sys.exit(1)
    
except Exception as exc:
    print(f"\n❌ Error: {exc}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
