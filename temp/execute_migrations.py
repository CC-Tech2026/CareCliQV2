#!/usr/bin/env python3
"""
Execute SQL migrations via Supabase REST API.
This bypasses the problematic SQL editor UI.
"""

import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://sndwllbtmguzduuazahd.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_KEY:
    # Try to extract from other env vars or use a placeholder
    print("⚠️  No SUPABASE_KEY found. This script will likely fail without credentials.")
    SUPABASE_KEY = "placeholder"

# SQL statements to execute - one at a time
statements = [
    # Simple create first
    """CREATE TABLE IF NOT EXISTS ndis_price_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  financial_year TEXT NOT NULL,
  effective_date DATE NOT NULL,
  source_document TEXT,
  version TEXT,
  source_json JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);""",

    """CREATE TABLE IF NOT EXISTS ndis_price_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT DEFAULT 'H',
  price_national DECIMAL(10, 2),
  price_remote DECIMAL(10, 2),
  price_very_remote DECIMAL(10, 2),
  effective_date DATE NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE,
  day_type TEXT,
  time_type TEXT,
  support_intensity TEXT,
  support_purpose TEXT,
  support_category_number TEXT,
  support_category_name TEXT,
  category_number TEXT,
  registration_group TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);""",

    "CREATE INDEX IF NOT EXISTS idx_ndis_price_items_org_code ON ndis_price_items(organization_id, item_code);",
    "CREATE INDEX IF NOT EXISTS idx_ndis_price_items_valid_dates ON ndis_price_items(valid_from, valid_to);",
    "CREATE INDEX IF NOT EXISTS idx_ndis_price_schedules_org_year ON ndis_price_schedules(organization_id, financial_year);",
]

print(f"Target Supabase URL: {SUPABASE_URL}")
print(f"Using API key: {SUPABASE_KEY[:20]}..." if len(SUPABASE_KEY) > 20 else f"Using API key: {SUPABASE_KEY}")
print()

for i, statement in enumerate(statements, 1):
    print(f"[{i}/{len(statements)}] Executing...")
    print(f"  SQL: {statement[:60]}...")
    
    try:
        # Try using the Supabase REST API's direct SQL execution
        # This is a workaround - Supabase doesn't have a direct SQL API, so we use the PostgREST approach
        
        # For now, just print that we would execute it
        print(f"  ✓ Would execute")
        
    except Exception as e:
        print(f"  ✗ Error: {str(e)[:100]}")

print("\n📝 Note: The Supabase REST API doesn't have direct SQL execution.")
print("   Use the SQL Editor in Supabase dashboard or use the Python Supabase client directly.")
