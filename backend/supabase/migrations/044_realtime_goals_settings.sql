-- CARECLIQV2-236/237/240/241
-- Real-time monitoring, NDIS goals management, task templates, notification prefs

BEGIN;

-- ── Coordinator-scoped shift messages (236) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shift_messages (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    sender_id       UUID        NOT NULL REFERENCES public.users(id),
    recipient_id    UUID        NOT NULL REFERENCES public.users(id),
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    message         TEXT        NOT NULL,
    message_type    TEXT        NOT NULL DEFAULT 'text'
                    CHECK (message_type IN ('text','request_photo','task_suggestion','flag_issue','emergency')),
    is_read         BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── NDIS Goals — richer coordinator-managed model (237/240) ──────────────────
CREATE TABLE IF NOT EXISTS public.ndis_goals (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id   UUID        NOT NULL REFERENCES public.patients(id)      ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by       UUID        REFERENCES public.users(id)                  ON DELETE SET NULL,
    name             TEXT        NOT NULL,
    goal_area        TEXT        NOT NULL DEFAULT 'daily_living'
                     CHECK (goal_area IN ('daily_living','community','health','social','employment','other')),
    description      TEXT,
    target_date      DATE,
    success_criteria TEXT,
    related_task_ids UUID[],
    status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','archived')),
    archived_at      TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Participant task templates (237/240) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.participant_task_templates (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id             UUID        NOT NULL REFERENCES public.patients(id)      ON DELETE CASCADE,
    organization_id            UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by                 UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    name                       TEXT        NOT NULL,
    description                TEXT,
    linked_goal_ids            UUID[]      DEFAULT '{}',
    evidence_required          TEXT        NOT NULL DEFAULT 'optional'
                               CHECK (evidence_required IN ('photo','voice','text','photo+voice','optional')),
    is_mandatory               BOOLEAN     NOT NULL DEFAULT FALSE,
    estimated_duration_minutes INTEGER,
    is_custom                  BOOLEAN     NOT NULL DEFAULT TRUE,
    is_active                  BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order                 INTEGER     NOT NULL DEFAULT 0,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Extend shifts with monitoring context (236) ───────────────────────────────
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS emergency_flagged     BOOLEAN     DEFAULT FALSE;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS emergency_flagged_at  TIMESTAMPTZ;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS emergency_note        TEXT;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shift_messages_shift     ON public.shift_messages (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_messages_recipient ON public.shift_messages (recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_ndis_goals_participant   ON public.ndis_goals (participant_id, status);
CREATE INDEX IF NOT EXISTS idx_ndis_goals_org           ON public.ndis_goals (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_task_templates_participant ON public.participant_task_templates (participant_id, is_active);

COMMIT;
