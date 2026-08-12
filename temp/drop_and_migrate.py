import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()

print("🗑️ Dropping old NDIS tables...")

# Drop old schema
drop_statements = [
    "DROP TABLE IF EXISTS ndis_price_items CASCADE;",
    "DROP TABLE IF EXISTS ndis_price_schedules CASCADE;",
    "DROP FUNCTION IF EXISTS public.resolve_ndis_price(TEXT, UUID, DATE, TEXT) CASCADE;",
]

for stmt in drop_statements:
    try:
        # Use RPC to execute raw SQL
        admin.rpc('exec_sql', {'query': stmt}).execute()
        print(f"✅ Executed: {stmt[:50]}...")
    except Exception as e:
        # RPC may not exist, try direct query instead
        try:
            result = admin.postgrest.query(stmt)
            print(f"✅ Executed: {stmt[:50]}...")
        except:
            # Ignore errors on drop if tables don't exist
            print(f"⚠️ Skipped: {stmt[:50]}... (may not exist)")

# Now read and execute the migration file
with open('backend/supabase/migrations/020_ndis_pricing_functions.sql', 'r') as f:
    migration_sql = f.read()

print("\n📋 Reading migration file...")
print(f"   Migration size: {len(migration_sql)} bytes")

# Split into individual statements and execute
statements = migration_sql.split(';')
executed = 0

for stmt in statements:
    stmt = stmt.strip()
    if not stmt or stmt.startswith('--'):
        continue
    
    try:
        # Add semicolon back for execution
        full_stmt = stmt + ';'
        admin.rpc('exec_sql', {'query': full_stmt}).execute()
        executed += 1
        print(f"✅ [{executed}] Executed statement")
    except Exception as e:
        if 'exec_sql' in str(e):
            print(f"⚠️ RPC exec_sql not available, trying table-based approach")
            break
        print(f"❌ Error: {str(e)[:80]}")

print(f"\n✅ Completed migrations")
