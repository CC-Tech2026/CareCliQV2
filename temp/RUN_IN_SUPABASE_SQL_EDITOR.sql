-- ============================================================
-- Goals & Tasks — Complete Table Setup
-- Run this in Supabase SQL Editor if goals/tasks are not working
-- Safe to run multiple times (all CREATE TABLE use IF NOT EXISTS)
-- ============================================================

BEGIN;

-- ── 1. NDIS Goals (migration 044) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ndis_goals (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id   UUID        NOT NULL REFERENCES public.patients(id)      ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
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

-- ── 2. Participant Task Templates (migration 044 + 067 extensions) ────────────
CREATE TABLE IF NOT EXISTS public.participant_task_templates (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id             UUID        NOT NULL REFERENCES public.patients(id)      ON DELETE CASCADE,
    organization_id            UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
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

-- Add shift-based columns to participant_task_templates (migration 067)
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS primary_shift_type TEXT;
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS additional_shift_types TEXT[] DEFAULT '{}';
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS recurrence_type TEXT DEFAULT 'one_off';
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT;
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS recurrence_weekdays INTEGER[] DEFAULT '{}';
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS due_window_start TEXT;
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS due_window_end TEXT;
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS assigned_worker_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS linked_goal_id UUID REFERENCES public.ndis_goals(id) ON DELETE SET NULL;
ALTER TABLE public.participant_task_templates ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- ── 3. Participant Task Instances (migration 056) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.participant_tasks (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    goal_id             UUID        REFERENCES public.ndis_goals(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    created_by          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    name                TEXT        NOT NULL,
    description         TEXT,
    frequency           TEXT,
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed')),
    is_mandatory        BOOLEAN     NOT NULL DEFAULT FALSE,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. Shift-Based Task Templates (migration 068, corrected references) ───────
CREATE TABLE IF NOT EXISTS public.task_templates (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id       UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    title                TEXT        NOT NULL,
    category             TEXT        NOT NULL
                         CHECK (category IN ('personal_care','medication','domestic_assistance','community_access','transport','other')),
    priority             TEXT        NOT NULL DEFAULT 'medium'
                         CHECK (priority IN ('low','medium','high')),
    primary_shift_type   TEXT        NOT NULL
                         CHECK (primary_shift_type IN ('morning','afternoon','night','anytime')),
    additional_shift_types TEXT[]    DEFAULT ARRAY[]::text[],
    recurrence_type      TEXT        NOT NULL DEFAULT 'one_off'
                         CHECK (recurrence_type IN ('one_off','recurring')),
    recurrence_frequency TEXT
                         CHECK (recurrence_frequency IS NULL OR recurrence_frequency IN ('every_matching_shift','daily_regardless_of_shift','specific_weekdays')),
    recurrence_weekdays  INTEGER[]   DEFAULT NULL,
    due_window_start     TIME        DEFAULT NULL,
    due_window_end       TIME        DEFAULT NULL,
    assigned_worker_id   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    linked_goal_id       UUID        REFERENCES public.ndis_goals(id) ON DELETE SET NULL,
    notes                TEXT        DEFAULT NULL,
    requirement_level    TEXT        NOT NULL DEFAULT 'mandatory'
                         CHECK (requirement_level IN ('mandatory','optional')),
    evidence_required    TEXT        NOT NULL DEFAULT 'none'
                         CHECK (evidence_required IN ('none','photo','notes','photo_and_notes')),
    status               TEXT        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','paused','archived')),
    organization_id      UUID        REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    created_by           UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. Task Instances (migration 068, corrected references) ──────────────────
CREATE TABLE IF NOT EXISTS public.task_instances (
    id                           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_template_id             UUID        REFERENCES public.task_templates(id) ON DELETE SET NULL,
    shift_id                     UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    participant_id               UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    status                       TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','completed','missed','carried_over')),
    due_window_start             TIME        DEFAULT NULL,
    due_window_end               TIME        DEFAULT NULL,
    completed_by                 UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    completed_at                 TIMESTAMPTZ,
    evidence_photo_url           TEXT,
    evidence_notes               TEXT,
    completion_notes             TEXT,
    carried_over_from_instance_id UUID       REFERENCES public.task_instances(id) ON DELETE SET NULL,
    organization_id              UUID        REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ndis_goals_participant        ON public.ndis_goals (participant_id, status);
CREATE INDEX IF NOT EXISTS idx_ndis_goals_org               ON public.ndis_goals (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_task_templates_participant    ON public.participant_task_templates (participant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_participant_tasks_participant ON public.participant_tasks (participant_id, status);
CREATE INDEX IF NOT EXISTS idx_participant_tasks_goal        ON public.participant_tasks (goal_id);
CREATE INDEX IF NOT EXISTS idx_participant_tasks_org         ON public.participant_tasks (organization_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_participant_id ON public.task_templates (participant_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_status         ON public.task_templates (status);
CREATE INDEX IF NOT EXISTS idx_task_instances_shift          ON public.task_instances (shift_id);
CREATE INDEX IF NOT EXISTS idx_task_instances_participant    ON public.task_instances (participant_id, status);

COMMIT;
