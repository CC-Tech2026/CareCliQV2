#!/usr/bin/env python3
"""
Add missing columns to existing NDIS tables using ALTER TABLE.
This is safer than dropping and recreating.
"""

import sys
import os
sys.path.insert(0, 'backend')
from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()

# Define the columns we need to add (if they don't exist)
columns_to_add_schedules = [
    ("source_document", "TEXT"),
    ("version", "TEXT"),
    ("source_json", "JSONB"),
    ("created_at", "TIMESTAMP"),
    ("updated_at", "TIMESTAMP"),
]

columns_to_add_items = [
    ("effective_date", "DATE"),
    ("support_category_number", "TEXT"),
    ("support_category_name", "TEXT"),
    ("created_at", "TIMESTAMP"),
    ("updated_at", "TIMESTAMP"),
]

print("🔍 Checking ndis_price_schedules columns...")

# Try to insert a test record to see which columns are missing
import uuid
test_id = str(uuid.uuid4())
test_payload = {
    "id": test_id,
    "organization_id": "a1111111-1111-1111-1111-111111111111",
    "financial_year": "2025-26",
    "effective_date": "2025-11-24",
    "source_document": "test",
    "version": "1.0",
    "source_json": {},
    "created_at": None,
    "updated_at": None,
}

try:
    result = admin.table("ndis_price_schedules").insert(test_payload).execute()
    print("✅ ndis_price_schedules has required columns for load_price_schedule")
    
    # Delete test record
    admin.table("ndis_price_schedules").delete().eq("id", test_payload["id"]).execute()
except Exception as e:
    error_str = str(e)
    print(f"❌ Error with ndis_price_schedules: {error_str[:150]}")
    
    if "Could not find the" in error_str and "column" in error_str:
        # Extract column name
        import re
        match = re.search(r"Could not find the '([^']+)' column", error_str)
        if match:
            col_name = match.group(1)
            print(f"   Missing column: {col_name}")
            print(f"   Need to add via SQL: ALTER TABLE ndis_price_schedules ADD COLUMN {col_name} TEXT;")

print("\n💡 Next steps:")
print("   1. Go to Supabase SQL Editor")
print("   2. Run these commands one by one:")
print("      ALTER TABLE ndis_price_schedules ADD COLUMN source_document TEXT;")
print("      ALTER TABLE ndis_price_schedules ADD COLUMN version TEXT;")
print("      ALTER TABLE ndis_price_schedules ADD COLUMN source_json JSONB;")
print("      ALTER TABLE ndis_price_schedules ADD COLUMN created_at TIMESTAMP;")
print("      ALTER TABLE ndis_price_schedules ADD COLUMN updated_at TIMESTAMP;")
print("\n   3. Then: python load_pricing_data.py")
