-- Migration 073: Add price item mapping, evidence verification, and invoice tracking to tasks
-- Enables full NDIS invoicing workflow with price lookup, evidence tracking, and recurring automation

BEGIN;

-- ── Add price item code columns to tasks ───────────────────────────────────────────
-- Note: price_item_code references ndis_price_items(item_code) but without FK constraint
-- to avoid issues with composite unique constraints. Validation is done in application logic.
ALTER TABLE public.participant_tasks
  ADD COLUMN IF NOT EXISTS price_item_code TEXT,
  ADD COLUMN IF NOT EXISTS effective_hourly_rate NUMERIC(10, 2);

-- ── Create invoices table for billing (before task_completions to avoid FK issues) ─
CREATE TABLE IF NOT EXISTS public.invoices (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    participant_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    plan_id             UUID        REFERENCES public.ndis_plans(id) ON DELETE SET NULL,
    invoice_number      TEXT        NOT NULL UNIQUE,
    invoice_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    period_start        DATE        NOT NULL,
    period_end          DATE        NOT NULL,
    total_amount        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'finalized', 'sent', 'paid', 'overdue', 'cancelled')),
    created_by          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    sent_date           TIMESTAMPTZ,
    paid_date           TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Add session/task completion tracking for evidence verification ────────────────
CREATE TABLE IF NOT EXISTS public.task_completions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID        NOT NULL REFERENCES public.participant_tasks(id) ON DELETE CASCADE,
    shift_id            UUID        REFERENCES public.shifts(id) ON DELETE SET NULL,
    participant_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    completed_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    completion_date     DATE        NOT NULL,
    completion_time     TIME,
    duration_minutes    INTEGER,
    evidence_type       TEXT        CHECK (evidence_type IN ('none', 'photo', 'notes', 'photo_and_notes')),
    evidence_photo_url  TEXT,
    evidence_notes      TEXT,
    evidence_verified   BOOLEAN     DEFAULT FALSE,
    verified_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at         TIMESTAMPTZ,
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'submitted', 'verified', 'rejected')),
    price_item_code     TEXT,
    billed_amount       NUMERIC(10, 2),
    invoice_id          UUID        REFERENCES public.invoices(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          UUID        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    price_item_code     TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    support_category    TEXT,
    quantity            NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price          NUMERIC(10, 2) NOT NULL,
    total_price         NUMERIC(12, 2) NOT NULL,
    day_type            TEXT,
    time_type           TEXT,
    support_intensity   TEXT,
    task_ids            UUID[],
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Enhance recurring task tracking ────────────────────────────────────────────────
ALTER TABLE public.participant_tasks
  ADD COLUMN IF NOT EXISTS recurrence_start_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_end_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_instances_created INTEGER DEFAULT 0;

-- ── Create task instances for recurring tasks ──────────────────────────────────────
-- Drop view if it exists (from previous migration)
DROP VIEW IF EXISTS public.task_instances CASCADE;

CREATE TABLE IF NOT EXISTS public.task_instances (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_template_id    UUID        NOT NULL REFERENCES public.participant_tasks(id) ON DELETE CASCADE,
    participant_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    scheduled_date      DATE        NOT NULL,
    scheduled_time      TIME,
    shift_type          TEXT        NOT NULL CHECK (shift_type IN ('morning', 'afternoon', 'night', 'anytime')),
    assigned_worker_id  UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled')),
    completion_id       UUID        REFERENCES public.task_completions(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes for performance ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_task_completions_task 
  ON public.task_completions (task_id, completion_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_completions_participant 
  ON public.task_completions (participant_id, completion_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_completions_status 
  ON public.task_completions (status, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_completions_invoice 
  ON public.task_completions (invoice_id);

CREATE INDEX IF NOT EXISTS idx_task_instances_scheduled 
  ON public.task_instances (scheduled_date, shift_type);
CREATE INDEX IF NOT EXISTS idx_task_instances_participant 
  ON public.task_instances (participant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_task_instances_status 
  ON public.task_instances (status, scheduled_date);

-- ── Comments for documentation ────────────────────────────────────────────────────
COMMENT ON TABLE public.task_completions IS 
  'Tracks individual task completions with evidence and billing integration for NDIS compliance and invoicing';
COMMENT ON TABLE public.invoices IS 
  'NDIS provider invoices grouped by participant, period, and support category with full audit trail';
COMMENT ON TABLE public.invoice_line_items IS 
  'Detailed line items per invoice, grouped by price item code (NDIS funding line) for accuracy';
COMMENT ON TABLE public.task_instances IS 
  'Individual instances of recurring tasks, automatically created based on frequency pattern and assigned to shifts';

COMMENT ON COLUMN public.task_completions.evidence_verified IS 
  'NDIS compliance: Whether supervisor verified evidence (photo/notes) matches policy requirements';
COMMENT ON COLUMN public.task_completions.status IS 
  'Workflow: pending → submitted → verified → (billed or rejected)';
COMMENT ON COLUMN public.invoices.status IS 
  'Lifecycle: draft → finalized → sent → paid (or overdue/cancelled)';
COMMENT ON COLUMN public.task_instances.shift_type IS 
  'Links to pricing rates: morning/afternoon/night have different hourly rates per NDIS schedule';

COMMIT;
