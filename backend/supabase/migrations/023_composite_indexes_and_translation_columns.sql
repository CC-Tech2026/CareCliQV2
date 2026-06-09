-- ============================================================
-- CCQ-101c — Composite indexes for org-scoped paginated queries
-- CCQ-405a — Add missing translation columns to session_messages
-- ============================================================
-- CCQ-101c: Adds (organisation_id, id) and (organisation_id, created_at)
-- composite indexes so the query planner uses them for org-scoped
-- paginated list queries instead of falling back to seq scans.
--
-- CCQ-405a: session_messages was missing original_language_input and
-- translation_provider columns that are required by the translation
-- audit trail (all other translation columns exist from migration 006).
-- ============================================================

BEGIN;

-- ── CCQ-101c: Composite indexes ───────────────────────────────────────────────

-- patients
CREATE INDEX IF NOT EXISTS idx_patients_org_id      ON public.patients(organization_id, id);
CREATE INDEX IF NOT EXISTS idx_patients_org_created  ON public.patients(organization_id, created_at DESC);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_org_id       ON public.sessions(organization_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_org_created   ON public.sessions(organization_id, created_at DESC);

-- incidents
CREATE INDEX IF NOT EXISTS idx_incidents_org_id      ON public.incidents(organization_id, id);
CREATE INDEX IF NOT EXISTS idx_incidents_org_created  ON public.incidents(organization_id, created_at DESC);

-- alerts
CREATE INDEX IF NOT EXISTS idx_alerts_org_id         ON public.alerts(organization_id, id);
CREATE INDEX IF NOT EXISTS idx_alerts_org_created     ON public.alerts(organization_id, created_at DESC);

-- ndis_plans
CREATE INDEX IF NOT EXISTS idx_ndis_plans_org_id     ON public.ndis_plans(organization_id, id);
CREATE INDEX IF NOT EXISTS idx_ndis_plans_org_created ON public.ndis_plans(organization_id, created_at DESC);

-- credentials
CREATE INDEX IF NOT EXISTS idx_credentials_org_id    ON public.credentials(organization_id, id) WHERE organization_id IS NOT NULL;

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_org_created   ON public.invoices(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;

-- report_history
CREATE INDEX IF NOT EXISTS idx_report_history_org_created ON public.report_history(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;

-- session_embeddings (created fresh in migration 022)
CREATE INDEX IF NOT EXISTS idx_session_embeddings_org_id ON public.session_embeddings(organization_id, id);

-- ── CCQ-405a: Add missing translation columns to session_messages ─────────────
-- translated_content, detected_language, translation_status, translation_metadata
-- already exist from migration 006. Adding the two that were missing:

ALTER TABLE public.session_messages
    ADD COLUMN IF NOT EXISTS original_language_input TEXT,
    ADD COLUMN IF NOT EXISTS translation_provider    TEXT;

-- Backfill: rows with a detected non-English language had a provider
UPDATE public.session_messages
SET translation_provider = 'none'
WHERE translation_provider IS NULL;

-- Constraint: translation_status must be one of the allowed values
-- (matches the constraint already on sessions and incidents)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'session_messages_translation_status_check'
    ) THEN
        ALTER TABLE public.session_messages
        ADD CONSTRAINT session_messages_translation_status_check
        CHECK (
            translation_status IN (
                'not_required', 'pending', 'translated',
                'failed', 'unsupported', 'manually_confirmed'
            )
        );
    END IF;
END $$;

-- Index for querying messages with unresolved translations (used by CCQ-405c block check)
CREATE INDEX IF NOT EXISTS idx_session_messages_translation_status
    ON public.session_messages(session_id, translation_status)
    WHERE translation_status IN ('failed', 'pending');

COMMIT;
