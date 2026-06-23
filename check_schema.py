#!/usr/bin/env python3
"""
Check current NDIS table schema and add missing columns if needed.
"""

import sys
import os
sys.path.insert(0, 'backend')
from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()

print("📋 Current ndis_price_schedules schema:")
try:
    schedules = admin.table('ndis_price_schedules').select('*').limit(1).execute()
    if schedules.data:
        cols = list(schedules.data[0].keys())
        for col in sorted(cols):
            print(f"  ✓ {col}")
    else:
        print("  (table empty, checking from schema...)")
        # Query information_schema
        result = admin.postgrest.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='ndis_price_schedules' ORDER BY ordinal_position"
        )
        if result:
            for row in result:
                print(f"  ✓ {row}")
except Exception as e:
    print(f"  Error: {str(e)[:100]}")

print("\n📋 Current ndis_price_items schema:")
try:
    items = admin.table('ndis_price_items').select('*').limit(1).execute()
    if items.data:
        cols = list(items.data[0].keys())
        for col in sorted(cols):
            print(f"  ✓ {col}")
    else:
        print("  (table empty, checking from schema...)")
except Exception as e:
    print(f"  Error: {str(e)[:100]}")

print("\n🔍 Required columns for load_price_schedule:")
required = ["id", "organization_id", "financial_year", "effective_date", "source_document", "version", "source_json", "created_at", "updated_at"]
print(f"  {', '.join(required)}")

print("\n✅ If columns are missing, they need to be added via SQL migration.")
