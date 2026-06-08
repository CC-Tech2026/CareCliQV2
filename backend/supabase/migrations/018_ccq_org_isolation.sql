-- ============================================================
-- CCQ-101 / CCQ-103 — Multi-tenant org isolation: NOT NULL, FK, indexes
-- ============================================================
-- Adds abn / plan_tier / compliance_target to organisations (CCQ-103),
-- backfills every nullable organization_id from the owner's org,
-- then adds NOT NULL + FK constraints and missing indexes (CCQ-101).
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS guards.
-- ============================================================

BEGIN;

-- ── 1. Extend organisations table (CCQ-103 required fields) ─────────────────

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS abn                TEXT,
    ADD COLUMN IF NOT EXISTS plan_tier          TEXT NOT NULL DEFAULT 'starter'
        CHECK (plan_tier IN ('starter', 'growth', 'enterprise')),
    ADD COLUMN IF NOT EXISTS compliance_target  NUMERIC(5,2) DEFAULT 85.00;

-- ── 2. Backfill organization_id across all core tables ──────────────────────
--    Strategy: use the row's owner / creator → their users.organization_id.
--    Any row still NULL after this is truly orphaned and gets the first org
--    (or left nullable if no orgs exist at all).

-- Helper: a single UUID for rows with no resolvable owner (NULL if no orgs)
DO $$
DECLARE
    _fallback_org uuid;
BEGIN
    SELECT organization_id INTO _fallback_org FROM public.organizations ORDER BY created_at LIMIT 1;

    -- patients
    UPDATE public.patients p
    SET    organization_id = COALESCE(
               (SELECT u.organization_id FROM public.users u WHERE u.id = p.owner_user_id  LIMIT 1),
               (SELECT u.organization_id FROM public.users u WHERE u.id = p.created_by     LIMIT 1),
               (SELECT u.organization_id FROM public.users u WHERE u.id = p.assigned_worker_id LIMIT 1),
               _fallback_org
           )
    WHERE  p.organization_id IS NULL;

    -- sessions
    UPDATE public.sessions s
    SET    organization_id = COALESCE(
               (SELECT u.organization_id FROM public.users u WHERE u.id = s.owner_user_id LIMIT 1),
               (SELECT u.organization_id FROM public.users u WHERE u.id = s.created_by    LIMIT 1),
               (SELECT u.organization_id FROM public.users u WHERE u.id = s.worker_id     LIMIT 1),
               (SELECT p.organization_id FROM public.patients p WHERE p.id = s.patient_id LIMIT 1),
               _fallback_org
           )
    WHERE  s.organization_id IS NULL;

    -- incidents
    UPDATE public.incidents i
    SET    organization_id = COALESCE(
               (SELECT u.organization_id FROM public.users u WHERE u.id = i.user_id    LIMIT 1),
               (SELECT u.organization_id FROM public.users u WHERE u.id = i.created_by LIMIT 1),
               (SELECT p.organization_id FROM public.patients p WHERE p.id = i.participant_id LIMIT 1),
               _fallback_org
           )
    WHERE  i.organization_id IS NULL;

    -- alerts
    UPDATE public.alerts a
    SET    organization_id = COALESCE(
               (SELECT p.organization_id FROM public.patients p WHERE p.id = a.patient_id LIMIT 1),
               _fallback_org
           )
    WHERE  a.organization_id IS NULL;

    -- ndis_plans
    UPDATE public.ndis_plans np
    SET    organization_id = COALESCE(
               (SELECT p.organization_id FROM public.patients p WHERE p.id = np.patient_id LIMIT 1),
               _fallback_org
           )
    WHERE  np.organization_id IS NULL;

    -- practitioner_allocations
    UPDATE public.practitioner_allocations pa
    SET    organization_id = COALESCE(
               (SELECT u.organization_id FROM public.users u WHERE u.id = pa.user_id  LIMIT 1),
               (SELECT p.organization_id FROM public.patients p WHERE p.id = pa.patient_id LIMIT 1),
               _fallback_org
           )
    WHERE  pa.organization_id IS NULL;

    -- audit_logs
    UPDATE public.audit_logs al
    SET    organization_id = COALESCE(
               (SELECT u.organization_id FROM public.users u WHERE u.id = al.user_id::uuid LIMIT 1),
               _fallback_org
           )
    WHERE  al.organization_id IS NULL AND al.user_id IS NOT NULL;

    -- access_logs
    UPDATE public.access_logs acl
    SET    organization_id = COALESCE(
               (SELECT u.organization_id FROM public.users u WHERE u.id = acl.user_id::uuid LIMIT 1),
               _fallback_org
           )
    WHERE  acl.organization_id IS NULL;

    RAISE NOTICE 'Backfill complete. Fallback org used: %', _fallback_org;
END $$;

-- ── 3. NOT NULL constraints (safe: rows are backfilled above) ────────────────

ALTER TABLE public.patients               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.sessions               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.incidents              ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.alerts                 ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.ndis_plans             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.practitioner_allocations ALTER COLUMN organization_id SET NOT NULL;

-- audit_logs / access_logs: some system rows may legitimately have no org — keep nullable.

-- ── 4. Foreign key constraints (ON DELETE RESTRICT = CCQ-101 requirement) ───

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_patients_organization_id'
    ) THEN
        ALTER TABLE public.patients
        ADD CONSTRAINT fk_patients_organization_id
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_organization_id'
    ) THEN
        ALTER TABLE public.sessions
        ADD CONSTRAINT fk_sessions_organization_id
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_incidents_organization_id'
    ) THEN
        ALTER TABLE public.incidents
        ADD CONSTRAINT fk_incidents_organization_id
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_alerts_organization_id'
    ) THEN
        ALTER TABLE public.alerts
        ADD CONSTRAINT fk_alerts_organization_id
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ndis_plans_organization_id'
    ) THEN
        ALTER TABLE public.ndis_plans
        ADD CONSTRAINT fk_ndis_plans_organization_id
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_practitioner_allocations_org'
    ) THEN
        ALTER TABLE public.practitioner_allocations
        ADD CONSTRAINT fk_practitioner_allocations_org
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

-- users.organization_id FK
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_organization_id'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT fk_users_organization_id
        FOREIGN KEY (organization_id) REFERENCES public.organizations(organization_id) ON DELETE RESTRICT;
    END IF;
END $$;

-- ── 5. Indexes on organization_id for all listed tables ──────────────────────

CREATE INDEX IF NOT EXISTS idx_users_organization_id            ON public.users(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_organization_id        ON public.incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_alerts_organization_id           ON public.alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_ndis_plans_organization_id       ON public.ndis_plans(organization_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocs_org_id       ON public.practitioner_allocations(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id                ON public.audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_org_id               ON public.access_logs(organization_id);

-- Tables added by patch files (idempotent)
CREATE INDEX IF NOT EXISTS idx_credentials_organization_id      ON public.credentials(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_organization_id         ON public.invoices(organization_id)    WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_history_organization_id   ON public.report_history(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_toolkit_items_organization_id    ON public.toolkit_items(organization_id)   WHERE organization_id IS NOT NULL;

-- ── 6. Verify: count of remaining NULLs in critical tables ──────────────────
DO $$
DECLARE _null_count bigint;
BEGIN
    SELECT COUNT(*) INTO _null_count FROM public.patients    WHERE organization_id IS NULL;
    IF _null_count > 0 THEN RAISE WARNING 'patients still has % rows with NULL organization_id', _null_count; END IF;

    SELECT COUNT(*) INTO _null_count FROM public.sessions    WHERE organization_id IS NULL;
    IF _null_count > 0 THEN RAISE WARNING 'sessions still has % rows with NULL organization_id', _null_count; END IF;

    SELECT COUNT(*) INTO _null_count FROM public.incidents   WHERE organization_id IS NULL;
    IF _null_count > 0 THEN RAISE WARNING 'incidents still has % rows with NULL organization_id', _null_count; END IF;
END $$;

COMMIT;
