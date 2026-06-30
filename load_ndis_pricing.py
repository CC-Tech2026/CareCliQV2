#!/usr/bin/env python3
"""
Load NDIS Pricing Data

Loads the NDIS real pricing data from ndis_real_data.json into Supabase.
Supports all shifts (morning/afternoon/night) and creates pricing schedule.

Usage:
    python load_ndis_pricing.py [--org-email email@example.com] [--dry-run]
"""

import sys
import json
import asyncio
from datetime import date
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from app.services.ndis_pricing_service import load_price_schedule
from app.services.supabase_client import get_supabase_admin


async def load_pricing_data(org_email: str = "sarah@sunshine-demo.com", dry_run: bool = False):
    """Load NDIS pricing data for organization."""
    
    print("=" * 70)
    print("NDIS PRICING DATA LOADER")
    print("=" * 70)
    
    try:
        # Load pricing JSON
        pricing_file = Path("ndis_real_data.json")
        if not pricing_file.exists():
            print(f"❌ Error: {pricing_file} not found")
            return False
        
        print(f"\n📂 Loading pricing data from: {pricing_file}")
        with open(pricing_file, "r") as f:
            source_json = json.load(f)
        
        # Get organization
        admin = get_supabase_admin()
        users_resp = admin.table("users").select("*").eq("email", org_email).execute()
        
        if not users_resp.data:
            print(f"❌ Error: User {org_email} not found")
            print("\nTip: Create a test coordinator first:")
            print(f"    python -c \"from backend.app.services.supabase_client import get_supabase_admin")
            print(f"    admin = get_supabase_admin()")
            print(f"    admin.auth.admin.create_user(email='{org_email}', password='test123')\"")
            return False
        
        user = users_resp.data[0]
        org_id = user.get("organization_id")
        user_id = user.get("id")
        
        if not org_id:
            print(f"❌ Error: User {org_email} has no organization")
            return False
        
        print(f"✓ Found organization: {org_id}")
        print(f"✓ Found user: {user.get('email')}")
        
        # Preview pricing data
        metadata = source_json.get("metadata", {})
        print(f"\n📋 Pricing Schedule Metadata:")
        print(f"  • Source: {metadata.get('source')}")
        print(f"  • Financial Year: {metadata.get('financial_year')}")
        print(f"  • Effective Date: {metadata.get('effective_date')}")
        
        categories = source_json.get("support_categories", [])
        total_items = sum(len(cat.get("items", [])) for cat in categories)
        print(f"  • Categories: {len(categories)}")
        print(f"  • Price Items: {total_items}")
        
        # Show sample items by time type
        print(f"\n📊 Sample Items by Shift Type:")
        time_types_found = set()
        for category in categories:
            for item in category.get("items", [])[:3]:
                time_type = item.get("time_type", "unknown")
                if time_type not in time_types_found:
                    print(f"  • {item.get('name')}")
                    print(f"    └─ Time: {time_type} | Price: ${item.get('price_national')}/hr")
                    time_types_found.add(time_type)
        
        if dry_run:
            print(f"\n🔍 DRY RUN: Would load {total_items} pricing items")
            return True
        
        # Load pricing
        print(f"\n⏳ Loading {total_items} pricing items into Supabase...")
        
        mock_user = {
            "id": user_id,
            "email": org_email,
            "role": "support_coordinator",
            "organization_id": org_id,
        }
        
        result = await load_price_schedule(mock_user, source_json)
        
        print(f"\n✅ SUCCESS!")
        print(f"\n📈 Loading Results:")
        print(f"  • Schedule ID: {result.get('schedule_id')}")
        print(f"  • Items Loaded: {result.get('items_loaded', 0)}")
        print(f"  • Financial Year: {result.get('financial_year')}")
        
        # Verify by querying
        schedules = admin.table("ndis_price_schedules").select("*").eq(
            "organization_id", org_id
        ).order("created_at", desc=True).limit(1).execute()
        
        if schedules.data:
            schedule = schedules.data[0]
            print(f"\n🔍 Verification:")
            print(f"  • Latest Schedule: {schedule.get('financial_year')}")
            print(f"  • Created: {schedule.get('created_at')}")
            
            # Count price items
            items = admin.table("ndis_price_items").select(
                "count"
            ).eq("schedule_id", schedule.get("id")).execute()
            
            print(f"  • Price Items in DB: {items.count if hasattr(items, 'count') else 'N/A'}")
        
        print(f"\n✅ Pricing data loaded successfully!")
        print(f"\nNext steps:")
        print(f"  1. Create a participant with NDIS plan")
        print(f"  2. Create goals with support_category matching pricing codes")
        print(f"  3. Create tasks with shift_type (morning/afternoon/night)")
        print(f"  4. Complete tasks with evidence")
        print(f"  5. Generate invoices from completed tasks")
        
        return True
    
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Load NDIS pricing data")
    parser.add_argument(
        "--org-email",
        default="sarah@sunshine-demo.com",
        help="Organization coordinator email (default: sarah@sunshine-demo.com)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without loading"
    )
    
    args = parser.parse_args()
    
    success = asyncio.run(load_pricing_data(
        org_email=args.org_email,
        dry_run=args.dry_run
    ))
    
    sys.exit(0 if success else 1)
