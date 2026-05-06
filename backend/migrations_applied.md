# Applied Migrations

This file records out-of-band schema migrations run directly in the Supabase SQL editor
(i.e., changes that could not be applied automatically from the Replit container due to
network constraints — the Supabase DB is IPv6-only and the pooler tenant lookup fails
from Replit's IPv4-only egress).

---

## 2026-05-06 — sessions.body_markers

**Environment:** Production Supabase project `sndwllbtmguzduuazahd`

**SQL applied:**
```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='sessions' AND column_name='body_markers'
  ) THEN
    ALTER TABLE sessions ADD COLUMN body_markers JSONB DEFAULT '[]';
  END IF;
END $$;
```

**Verification:**
- `GET /rest/v1/sessions?select=id,body_markers&limit=1` → HTTP 200, `body_markers` field present
- Three sessions checked via Supabase client — all return `body_markers: []` (default)
- `backend/app/services/session_service.py` already handles `body_markers` in
  `_prepare_session_payload` (line 88) and `_normalize` (line 289)
- `backend/app/schemas/session.py` already has `body_markers: Optional[List[Dict]]`

**Why manual:** Replit container cannot reach Supabase DB directly (IPv6-only direct
host, pooler returns ENOTFOUND for this project across all regions). Supabase Management
API requires a personal access token (service role key is rejected).

**Source of truth:** `backend/supabase_setup.sql` lines 113–115

---

## 2026-05-06 — patients.biological_sex

**Environment:** Production Supabase project `sndwllbtmguzduuazahd`

**SQL:** `ALTER TABLE patients ADD COLUMN biological_sex TEXT DEFAULT 'unspecified';`
(Applied in a prior task — recorded here for completeness.)

**Source of truth:** `backend/supabase_setup.sql` lines 124–126
