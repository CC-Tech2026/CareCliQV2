#!/usr/bin/env python3
"""
Clean up test data and reload fresh.
"""

import sys
sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

admin = get_supabase_admin()
org_id = "a1111111-1111-1111-1111-111111111111"

print("🧹 Cleaning up test data...")

# Delete items first (foreign key constraint)
admin.table("ndis_price_items").delete().eq("organization_id", org_id).execute()
print("✅ Deleted ndis_price_items")

# Delete schedules
admin.table("ndis_price_schedules").delete().eq("organization_id", org_id).execute()
print("✅ Deleted ndis_price_schedules")

print("\n✨ Database cleaned, ready to load fresh data!")
