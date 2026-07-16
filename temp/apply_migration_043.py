#!/usr/bin/env python3
"""
Generate instructions to apply the missing migration for 'unassigned' status.
The migration 043_shift_scheduling_v2.sql needs to be applied to allow 'unassigned' status.
"""

import os

sql_to_apply = """
-- Migration 043: Add 'unassigned' and other statuses to shift status constraint
-- This needs to be applied to the Supabase database

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;

ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check
    CHECK (status IN ('unassigned','scheduled','in_progress','clocked_in','completed','cancelled'));

-- Commit complete
"""

print("=" * 80)
print("MISSING MIGRATION - 'unassigned' status not in shifts constraint")
print("=" * 80)

print("\nCurrent Status:")
print("  - 'unassigned' shifts cannot be created")
print("  - Only 'scheduled' and 'completed' statuses are currently allowed")
print("  - Migration 043_shift_scheduling_v2.sql has NOT been applied")

print("\nTo fix this, apply the following SQL via Supabase Dashboard:")
print("=" * 80)
print(sql_to_apply)
print("=" * 80)

print("\nSteps:")
print("1. Go to https://app.supabase.com")
print("2. Select your project")
print("3. Go to SQL Editor")
print("4. Click 'New Query'")
print("5. Paste the SQL above")
print("6. Click 'Run'")
print("\nAfter applying, the 'unassigned' shift status will be available")
print("=" * 80)

# Also check if we can find and read the actual migration file
try:
    with open('backend/supabase/migrations/043_shift_scheduling_v2.sql', 'r') as f:
        migration_content = f.read()
        if 'unassigned' in migration_content:
            print("\n✓ Migration file 043_shift_scheduling_v2.sql exists and contains 'unassigned'")
        else:
            print("\n✗ Migration file exists but doesn't contain 'unassigned'")
except FileNotFoundError:
    print("\n✗ Migration file 043_shift_scheduling_v2.sql not found")
