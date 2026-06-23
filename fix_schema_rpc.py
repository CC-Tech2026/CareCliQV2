#!/usr/bin/env python3
"""
Execute SQL via Supabase by creating a temporary RPC function.
"""

import os
import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()

print("📋 Attempting to add missing columns to ndis_price_schedules...")

# List of ALTER TABLE statements to execute one by one
alter_statements = [
    "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS source_document TEXT",
    "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS version TEXT",
    "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS source_json JSONB",
    "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP",
    "ALTER TABLE ndis_price_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
]

# Try using the admin client's postgrest API
# The trick is to use raw_sql or a similar method
try:
    # Try method 1: Using table operations (won't work for DDL, but let's try)
    print("Method 1: Trying through Supabase admin client...")
    
    # Create a temporary table just to see if we can do DDL
    test_ddl = "CREATE TABLE IF NOT EXISTS _test_col_add (id TEXT);"
    
    # The Supabase client doesn't have a direct SQL execute method for DDL
    # We need to use the REST API directly with the right headers
    
    print("❌ Supabase REST API doesn't support direct SQL DDL execution")
    print("   (Supabase recommends using migrations or SQL Editor)")
    
    print("\n💡 Alternative: Use SQL directly in file...")
    
    # Write the SQL statements to a file
    sql_file = "add_columns.sql"
    with open(sql_file, 'w') as f:
        for stmt in alter_statements:
            f.write(stmt + ";\n")
    
    print(f"\n📝 Created {sql_file} with the following statements:")
    print("================================================================================")
    for stmt in alter_statements:
        print(stmt + ";")
    print("================================================================================")
    
    print("\n📋 Instructions:")
    print("   1. Copy the content of add_columns.sql")
    print("   2. Go to https://app.supabase.com/project/sndwllbtmguzduuazahd/sql")
    print("   3. Paste each statement one at a time and click Run")
    print("   4. Or paste all statements at once separated by semicolons")
    print("\n   IMPORTANT: The SQL Editor seems to have issues with multi-line pasting.")
    print("   Try copying this instead:")
    
    # Single line version
    single_line = "; ".join(alter_statements) + ";"
    print(f"\n   {single_line}")
    
    # Copy to clipboard
    import subprocess
    try:
        subprocess.run(['powershell', '-Command', f'"{single_line}" | Set-Clipboard'], 
                       check=True, capture_output=True, cwd=os.getcwd())
        print("\n✅ Single-line SQL copied to clipboard!")
    except:
        print("   (Could not auto-copy to clipboard)")
        
except Exception as e:
    print(f"Error: {str(e)}")
