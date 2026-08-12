#!/usr/bin/env python3
"""
Load NDIS pricing data from ndis_real_data.json into the database.
"""

import json
import sys
import os
from datetime import datetime
from uuid import uuid4

sys.path.insert(0, 'backend')

from app.services.supabase_client import get_supabase_admin

print("📥 Loading NDIS pricing data...")

# Read the data file
with open('ndis_real_data.json', 'r') as f:
    data = json.load(f)

admin = get_supabase_admin()
org_id = "a1111111-1111-1111-1111-111111111111"

try:
    # Extract schedule metadata
    metadata = data.get("metadata", {})
    financial_year = metadata.get("financial_year", "2025-26")
    effective_date = metadata.get("effective_date", "2025-11-24")
    
    # Flatten nested items from support_categories
    items = []
    for category in data.get("support_categories", []):
        for item in category.get("items", []):
            # Add category info to each item
            item["support_category_number"] = category.get("category_number", "")
            item["support_category_name"] = category.get("category_name", "")
            items.append(item)
    
    print(f"   Financial Year: {financial_year}")
    print(f"   Effective Date: {effective_date}")
    print(f"   Items to load: {len(items)}")
    
    # Create schedule record
    schedule_payload = {
        "organization_id": org_id,
        "financial_year": financial_year,
        "effective_date": effective_date,
        "source_document": "NDIS Support Catalogue",
        "version": "2025-26",
        "source_json": data,  # Store full JSON
    }
    
    print("\n✍️  Inserting schedule...")
    schedule_result = admin.table("ndis_price_schedules").insert(schedule_payload).execute()
    
    if not schedule_result.data:
        print("❌ Failed to create schedule")
        sys.exit(1)
    
    schedule_id = schedule_result.data[0]["id"]
    print(f"✅ Schedule created: {schedule_id}")
    
    # Prepare items for insertion
    items_to_insert = []
    for item in items:
        # Parse prices (convert to cents)
        try:
            price_national = float(item.get("price_national", 0)) * 100
        except (ValueError, TypeError):
            price_national = 0
        
        try:
            price_remote = float(item.get("price_remote", 0)) * 100 if item.get("price_remote") else None
        except (ValueError, TypeError):
            price_remote = None
            
        try:
            price_very_remote = float(item.get("price_very_remote", 0)) * 100 if item.get("price_very_remote") else None
        except (ValueError, TypeError):
            price_very_remote = None
        
        item_payload = {
            "organization_id": org_id,
            "schedule_id": schedule_id,
            "item_code": item.get("item_code", ""),
            "name": item.get("name", ""),
            "description": item.get("description", ""),
            "unit": item.get("unit", "H"),
            "price_national": int(price_national) if price_national else 0,
            "price_remote": int(price_remote) if price_remote else None,
            "price_very_remote": int(price_very_remote) if price_very_remote else None,
            "effective_date": effective_date,
            "valid_from": effective_date,  # Use effective_date as valid_from
            "valid_to": None,  # Ongoing
        }
        items_to_insert.append(item_payload)
    
    print(f"\n📦 Inserting {len(items_to_insert)} items...")
    
    if len(items_to_insert) == 0:
        print("❌ No items to insert")
        sys.exit(1)
    
    items_result = admin.table("ndis_price_items").insert(items_to_insert).execute()
    
    if not items_result.data:
        print("❌ Failed to insert items")
        sys.exit(1)
    
    print(f"✅ Inserted {len(items_result.data)} items")
    
    # Verify
    schedules = admin.table("ndis_price_schedules").select("id").eq("organization_id", org_id).execute()
    items_check = admin.table("ndis_price_items").select("id").eq("organization_id", org_id).execute()
    
    print(f"\n📊 Verification:")
    print(f"   Schedules in DB: {len(schedules.data)}")
    print(f"   Items in DB: {len(items_check.data)}")
    
    print(f"\n✅ Data loading complete!")
    
except Exception as e:
    print(f"❌ Error: {str(e)[:200]}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
