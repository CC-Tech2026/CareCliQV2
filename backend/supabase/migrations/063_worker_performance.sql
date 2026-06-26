-- CARECLIQV2-285/287/288/289 — Worker performance: shift history, feedback, dashboard, training

BEGIN;

-- ── 285: Shift PDF export requests ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shift_export_requests (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id         UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL,
    requested_by     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'ready', 'failed', 'expired')),
    file_path        TEXT,
    file_url         TEXT,
    error_message    TEXT,
    emailed_at       TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_export_requests_user
    ON public.shift_export_requests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_export_requests_shift
    ON public.shift_export_requests (shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_export_requests_expires
    ON public.shift_export_requests (expires_at)
    WHERE status = 'ready';

-- ── 287: Structured shift feedback ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_tags (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL,
    label            TEXT        NOT NULL,
    category         TEXT        NOT NULL CHECK (category IN ('strength', 'improvement')),
    is_active        BOOLEAN     NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_feedback_tags_org_label UNIQUE (organization_id, label, category)
);

CREATE INDEX IF NOT EXISTS idx_feedback_tags_org
    ON public.feedback_tags (organization_id, category)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.shift_feedback (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id         UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    coordinator_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL,
    strengths        TEXT        NOT NULL,
    areas_to_improve TEXT        NOT NULL,
    action_items     TEXT        NOT NULL,
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at  TIMESTAMPTZ,
    notification_sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shift_feedback_shift
    ON public.shift_feedback (shift_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_feedback_worker_unacked
    ON public.shift_feedback (worker_id)
    WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS public.shift_feedback_tags (
    feedback_id      UUID        NOT NULL REFERENCES public.shift_feedback(id) ON DELETE CASCADE,
    tag_id           UUID        NOT NULL REFERENCES public.feedback_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (feedback_id, tag_id)
);

-- Prevent clearing acknowledgement (immutable once set)
CREATE OR REPLACE FUNCTION public.prevent_shift_feedback_unack()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS NULL THEN
        RAISE EXCEPTION 'Feedback acknowledgement cannot be revoked';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shift_feedback_no_unack ON public.shift_feedback;
CREATE TRIGGER trg_shift_feedback_no_unack
    BEFORE UPDATE ON public.shift_feedback
    FOR EACH ROW EXECUTE FUNCTION public.prevent_shift_feedback_unack();

-- ── 288: Achievement badges ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.achievement_definitions (
    key              TEXT        PRIMARY KEY,
    title            TEXT        NOT NULL,
    description      TEXT        NOT NULL,
    unlock_criteria  JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.worker_achievements (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL,
    achievement_key  TEXT        NOT NULL REFERENCES public.achievement_definitions(key),
    unlocked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    context          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_worker_achievement UNIQUE (worker_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_worker_achievements_worker
    ON public.worker_achievements (worker_id, unlocked_at DESC);

CREATE TABLE IF NOT EXISTS public.worker_training_recommendations (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    coordinator_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL,
    training_module_id UUID,
    title            TEXT        NOT NULL,
    recommended_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    dismissed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_worker_training_recs_worker
    ON public.worker_training_recommendations (worker_id, recommended_at DESC)
    WHERE dismissed_at IS NULL;

INSERT INTO public.achievement_definitions (key, title, description, unlock_criteria) VALUES
    ('compliance_streak_5', '100% compliance streak (5 shifts)',
     'Completed 5 consecutive shifts with a 100% compliance score.',
     '{"type":"compliance_streak","count":5,"min_score":100}'::jsonb),
    ('all_evidence_10', 'All evidence submitted (10 shifts)',
     'Submitted evidence for every task across your last 10 completed shifts.',
     '{"type":"all_evidence","count":10}'::jsonb),
    ('zero_incidents_30', 'Zero incidents (30 days)',
     'No incident reports in the last 30 days.',
     '{"type":"zero_incidents","days":30}'::jsonb),
    ('perfect_punctuality_10', 'Perfect punctuality (10 shifts)',
     'Clocked in on time for your last 10 completed shifts.',
     '{"type":"punctuality","count":10,"grace_minutes":5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── 289: Training modules & requests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_modules (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID        NOT NULL,
    title                 TEXT        NOT NULL,
    description           TEXT,
    linked_credential_type TEXT,
    requires_certification BOOLEAN    NOT NULL DEFAULT false,
    created_by            UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    is_active             BOOLEAN     NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_modules_org
    ON public.training_modules (organization_id)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.training_resources (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id        UUID        NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
    resource_type    TEXT        NOT NULL CHECK (resource_type IN ('video', 'pdf', 'external_link')),
    title            TEXT        NOT NULL,
    storage_path     TEXT,
    external_url     TEXT,
    sort_order       INTEGER     NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_resources_module
    ON public.training_resources (module_id, sort_order);

CREATE TABLE IF NOT EXISTS public.worker_training_completions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module_id        UUID        NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL,
    completed_at     DATE        NOT NULL,
    note             TEXT,
    status           TEXT        NOT NULL DEFAULT 'awaiting_confirmation'
                     CHECK (status IN ('awaiting_confirmation', 'confirmed', 'rejected')),
    reviewed_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_worker_module_completion UNIQUE (worker_id, module_id)
);

CREATE TABLE IF NOT EXISTS public.worker_training_requests (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL,
    request_text     TEXT        NOT NULL,
    reason           TEXT        NOT NULL,
    urgent           BOOLEAN     NOT NULL DEFAULT false,
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'declined')),
    coordinator_response TEXT,
    actioned_at      TIMESTAMPTZ,
    actioned_by      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_training_requests_worker
    ON public.worker_training_requests (worker_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.credential_expiry_reminders (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id    UUID        NOT NULL REFERENCES public.credentials(id) ON DELETE CASCADE,
    days_before      INTEGER     NOT NULL CHECK (days_before IN (60, 30, 7)),
    recipient_role   TEXT        NOT NULL CHECK (recipient_role IN ('worker', 'coordinator')),
    recipient_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_credential_reminder UNIQUE (credential_id, days_before, recipient_role, recipient_id)
);

-- Storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'shift-export-files',
    'shift-export-files',
    false,
    52428800,
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'training-files',
    'training-files',
    false,
    104857600,
    ARRAY['application/pdf', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

-- RLS (service role used by backend; authenticated policies for future direct access)
ALTER TABLE public.shift_export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_feedback_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_training_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_training_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_training_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_expiry_reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shift_export_requests' AND policyname = 'shift_export_service_role') THEN
        CREATE POLICY shift_export_service_role ON public.shift_export_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shift_feedback' AND policyname = 'shift_feedback_service_role') THEN
        CREATE POLICY shift_feedback_service_role ON public.shift_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feedback_tags' AND policyname = 'feedback_tags_service_role') THEN
        CREATE POLICY feedback_tags_service_role ON public.feedback_tags FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'training_modules' AND policyname = 'training_modules_service_role') THEN
        CREATE POLICY training_modules_service_role ON public.training_modules FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
