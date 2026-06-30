-- CARECLIQV2-303/304/305
-- Participant task instances with status tracking

BEGIN;

-- ── Participant task instances (individual task records with status) ──────────
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

-- ── Shift-task associations (which tasks are worked on in which shifts) ──────
CREATE TABLE IF NOT EXISTS public.shift_tasks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    task_id         UUID        NOT NULL REFERENCES public.participant_tasks(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_participant_tasks_participant ON public.participant_tasks (participant_id, status);
CREATE INDEX IF NOT EXISTS idx_participant_tasks_goal ON public.participant_tasks (goal_id);
CREATE INDEX IF NOT EXISTS idx_participant_tasks_org ON public.participant_tasks (organization_id);
CREATE INDEX IF NOT EXISTS idx_shift_tasks_shift ON public.shift_tasks (shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_tasks_task ON public.shift_tasks (task_id);

COMMIT;
