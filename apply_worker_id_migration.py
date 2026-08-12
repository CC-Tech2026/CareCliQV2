#!/usr/bin/env python3
"""Apply the make_worker_id_nullable migration to Supabase."""

import sys
import os
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

# Read the migration SQL
with open('migrations/make_worker_id_nullable.sql', 'r') as f:
    migration_sql = f.read()

print("=" * 70)
print("Applying Migration: make_worker_id_nullable.sql")
print("=" * 70)

try:
    supabase = get_supabase_admin()
    
    # Split statements by semicolon
    statements = [stmt.strip() for stmt in migration_sql.split(';') if stmt.strip()]
    
    print(f"\nFound {len(statements)} SQL statements to execute")
    print("\nExecuting statements...\n")
    
    executed = 0
    for i, statement in enumerate(statements, 1):
        # Get a short description of what we're executing
        stmt_preview = statement[:60].replace('\n', ' ').strip()
        if len(statement) > 60:
            stmt_preview += "..."
        
        try:
            # Try to execute using table operations
            # This won't work for raw SQL, so we need to find another approach
            print(f"Statement {i}: {stmt_preview}")
            print(f"  Status: Requires manual execution via SQL editor")
        except Exception as e:
            print(f"  Error: {e}")
    
    print("\n" + "=" * 70)
    print("Note: supabase-py SDK doesn't support raw SQL execution")
    print("Please execute the following SQL manually via Supabase SQL editor:")
    print("=" * 70)
    print(migration_sql)
    print("=" * 70)
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
