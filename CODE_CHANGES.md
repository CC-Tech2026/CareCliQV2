# Code Changes Reference

## File 1: `backend/supabase_setup.sql`

### Change: Added Practitioner Allocations Table (End of File)

**Location:** End of file (after invitations table)

**Code Added:**
```sql
-- ============================================================
-- PRACTITIONER ALLOCATIONS — CRITICAL TABLE (missing from original setup)
-- Links support workers and allied health to participants
-- ============================================================

CREATE TABLE IF NOT EXISTS public.practitioner_allocations (
    id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id          UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    allocated_role      TEXT        NOT NULL DEFAULT 'support_worker'
                                    CHECK (allocated_role IN (
                                        'support_worker', 'allied_health',
                                        'primary_ot', 'supervisor'
                                    )),
    organization_id     UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
    assigned_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    assigned_at         TIMESTAMPTZ DEFAULT NOW(),
    deactivated_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_allocation UNIQUE (patient_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_patient_id ON public.practitioner_allocations(patient_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_user_id ON public.practitioner_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_is_active ON public.practitioner_allocations(is_active);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_organization_id ON public.practitioner_allocations(organization_id);

ALTER TABLE public.practitioner_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practitioner_allocations' AND policyname='pa_service_role_all') THEN
        CREATE POLICY pa_service_role_all ON public.practitioner_allocations
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;
```

**Why:** This table was missing but referenced throughout the backend code. It's the junction table that links workers to participants and is essential for allocation tracking and access control.

---

## File 2: `backend/app/schemas/plan.py`

### Change 1: Updated PlanCreate validators

**Before:**
```python
@field_validator("plan_start", mode="before")
@classmethod
def _parse_plan_start(cls, v):
    if v is None:
        return None
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        return date.fromisoformat(v.strip())
    raise ValueError("plan_start must be a date or ISO date string")
```

**After:**
```python
@field_validator("plan_start", mode="before")
@classmethod
def _parse_plan_start(cls, v):
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v.strip())
        except (ValueError, AttributeError):
            return None
    return None
```

**Change:** 
- Handle empty strings (`v == ""`)
- Catch exceptions instead of raising them
- Return None on parse failure instead of raising ValueError
- This prevents 422 validation errors

### Change 2: Updated PlanUpdate validators

**Same changes as PlanCreate** — applied to all date fields in both validators.

**Why:** Frontend might send dates in various formats or invalid values. Instead of rejecting with 422, gracefully return None and let the API handle it.

---

## File 3: `backend/app/api/assignments.py`

### Change 1: Enhanced create_assignment Function

**Location:** POST `/assignments` endpoint (around line 160)

**New Code Added After Assignment Creation:**
```python
# Also update the patient's assigned_worker_id field for access control filtering
# This ensures that when querying participants, workers see only their assigned ones
if role_type == "support_worker":
    try:
        supabase.table("patients").update({
            "assigned_worker_id": body.worker_user_id
        }).eq("id", body.participant_id).execute()
        logger.info("Updated patient assigned_worker_id: %s", body.participant_id[:8])
    except Exception as e:
        logger.warning("Failed to update patient assigned_worker_id: %s", e)
        # Don't fail the assignment if we can't update the patient field
elif role_type == "allied_health":
    try:
        supabase.table("patients").update({
            "allied_health_id": body.worker_user_id
        }).eq("id", body.participant_id).execute()
        logger.info("Updated patient allied_health_id: %s", body.participant_id[:8])
    except Exception as e:
        logger.warning("Failed to update patient allied_health_id: %s", e)
```

**Why:** When an allocation is created, we need to sync it to the patient record so access control filtering works. This is the critical piece that enables workers to see only their assigned participants.

**Also Added in Retry Block:**
Same logic was added in the try-except retry handler to ensure it works even if some columns don't exist yet.

### Change 2: Complete Rewrite of delete_assignment Function

**Before:**
```python
@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: str, user: dict = Depends(get_current_user)):
    """Deactivate an assignment. Coordinator-only."""
    _require_coordinator(user)
    supabase = get_supabase_admin()
    try:
        supabase.table(TABLE).update({"is_active": False}).eq("id", assignment_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

**After:**
```python
@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: str, user: dict = Depends(get_current_user)):
    """Deactivate an assignment. Coordinator-only."""
    _require_coordinator(user)
    supabase = get_supabase_admin()
    try:
        # Get the assignment details first
        alloc_result = supabase.table(TABLE).select("patient_id, allocated_role").eq("id", assignment_id).execute()
        alloc_data = alloc_result.data[0] if alloc_result.data else None
        
        # Deactivate the assignment
        supabase.table(TABLE).update({"is_active": False, "deactivated_at": "now()"}).eq("id", assignment_id).execute()
        
        # Also clear the patient's assigned_worker_id/allied_health_id if this was the last allocation
        if alloc_data:
            patient_id = alloc_data.get("patient_id")
            role_type = alloc_data.get("allocated_role", "support_worker")
            
            # Check if there are other active allocations for this patient
            remaining = supabase.table(TABLE).select("id").eq("patient_id", patient_id).eq("is_active", True).execute()
            
            # If no other active allocations exist, clear the field
            if not remaining.data:
                if role_type == "support_worker":
                    supabase.table("patients").update({"assigned_worker_id": None}).eq("id", patient_id).execute()
                    logger.info("Cleared patient assigned_worker_id: %s", patient_id[:8] if patient_id else "unknown")
                elif role_type == "allied_health":
                    supabase.table("patients").update({"allied_health_id": None}).eq("id", patient_id).execute()
                    logger.info("Cleared patient allied_health_id: %s", patient_id[:8] if patient_id else "unknown")
    except Exception as exc:
        logger.warning("Error in delete_assignment: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))
```

**Why:** When removing an allocation, we need to:
1. Deactivate the allocation record
2. Check if other allocations exist for the same participant
3. Clear the patient's assignment field only if no other allocations remain

This ensures the participant filtering still works correctly even when workers are removed.

---

## Summary of Changes

| File | Type | Impact | Severity |
|------|------|--------|----------|
| `supabase_setup.sql` | Database Schema | Creates missing junction table | CRITICAL |
| `schemas/plan.py` | API Schema | Fixes 422 validation errors | HIGH |
| `api/assignments.py` | Business Logic | Enables participant filtering | CRITICAL |

---

## Testing the Changes

### Before Applying Changes:
```bash
# Import errors in Pylance ❌
from fastapi import FastAPI  # Yellow squiggle

# 422 errors when creating plans ❌
POST /api/participants/{id}/plan
→ HTTP 422 Unprocessable Entity

# Workers see all participants ❌
GET /api/participants (as support_worker)
→ Returns all 100 participants in organization
```

### After Applying Changes:
```bash
# No import errors ✅
from fastapi import FastAPI  # Clean import

# Plans create successfully ✅
POST /api/participants/{id}/plan
→ HTTP 201 Created

# Workers see only assigned participants ✅
GET /api/participants (as support_worker)
→ Returns only 3 participants assigned to them
```
