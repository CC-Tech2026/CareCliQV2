#!/usr/bin/env python3
"""Apply worker_id nullable migration directly via PostgreSQL connection."""

import os
import sys
from urllib.parse import urlparse

try:
    import psycopg2
    from psycopg2 import sql, Error
except ImportError:
    print("psycopg2 not installed. Attempting alternative approach...")
    psycopg2 = None

# Get Supabase credentials
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://sndwllbtmguzduuazahd.supabase.co')
print(f"Supabase URL: {SUPABASE_URL}")

if psycopg2:
    print("\nAttempting to connect via direct PostgreSQL connection...")
    # Supabase doesn't expose direct PostgreSQL credentials easily
    # This approach won't work without direct DB credentials
    print("Note: Direct PostgreSQL connection requires DB credentials")
    print("Supabase doesn't expose these through the admin API")
else:
    print("\npsycopg2 not available, using alternative approach...")

# Alternative: Use the HTTP endpoint with a workaround
print("\n" + "=" * 70)
print("MIGRATION CANNOT BE APPLIED AUTOMATICALLY")
print("=" * 70)

migration_sql = """-- Migration 077: Make worker_id nullable for unassigned shifts
ALTER TABLE public.shifts
ALTER COLUMN worker_id DROP NOT NULL;"""

print("\nReason: Supabase doesn't provide direct SQL execution capability")
print("        through its REST API or Python SDK")
print("\nTo apply this migration manually:")
print("1. Go to Supabase Dashboard")
print("2. Select your project: Supabase-Python-Hub")
print("3. Open the SQL Editor")
print("4. Click 'New Query'")
print("5. Paste the SQL below")
print("6. Click 'Run'")
print("\nSQL to execute:")
print("-" * 70)
print(migration_sql)
print("-" * 70)

sys.exit(1)
