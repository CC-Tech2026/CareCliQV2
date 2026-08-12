# Fix Summary: Unassigned Shift Creation (500 Error)

## Problem Identified
The `/api/coordinator/shifts/unassigned` endpoint was returning 500 errors due to database schema constraints:

1. **NOT NULL Constraint**: The `shifts` table requires `worker_id` to be NOT NULL
2. **Missing Status**: The `shifts_status_check` constraint doesn't include 'unassigned' as a valid status
   - Current allowed statuses: 'scheduled', 'completed'  
   - Missing statuses: 'unassigned', 'in_progress', 'clocked_in', 'cancelled'

## Root Cause
Migration 043_shift_scheduling_v2.sql has NOT been applied to the database. This migration adds the missing statuses to the constraint.

## Workaround Implemented
Modified the `create_unassigned_shift` endpoint in `backend/app/api/coordinator.py`:

1. **Worker ID**: Uses placeholder value `00000000-0000-0000-0000-000000000000` to satisfy NOT NULL constraint
2. **Status**: Temporarily uses 'scheduled' instead of 'unassigned'
3. **Marker**: Response includes `is_unassigned: true` flag so UI can recognize it as unassigned

## Changes Made
- File: `backend/app/api/coordinator.py` (lines 2177-2234)
- Added placeholder worker_id for unassigned shifts
- Changed status from 'unassigned' to 'scheduled' temporarily
- Added `is_unassigned` marker in response

## Testing
The endpoint now works and can create shifts with:
- Placeholder worker_id (represents "unassigned")
- 'scheduled' status (temporary)
- UI recognizes as unassigned through marker field

## Required Manual Action
To complete the fix, apply migration 043 through Supabase SQL Editor:

1. Go to https://app.supabase.com
2. Select your project
3. Open SQL Editor
4. Click "New Query"
5. Paste this SQL:

```sql
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check
    CHECK (status IN ('unassigned','scheduled','in_progress','clocked_in','completed','cancelled'));
```

6. Click "Run"

After applying migration 043:
- The endpoint code can be updated to use 'unassigned' status instead of 'scheduled'
- No placeholder worker_id will be needed if you make worker_id nullable

## Files Affected
- `backend/app/api/coordinator.py`: Updated create_unassigned_shift endpoint
- `backend/supabase/migrations/077_make_worker_id_nullable.sql`: Created but not applied (optional enhancement)

## Status
✅ Endpoint fixed and working
⏳ Requires manual migration 043 application for full proper implementation
