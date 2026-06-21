-- CARECLIQV2-235: Shift Assignment & Scheduling v2
-- Adds worker availability, skills, participant required skills, in-app notifications

BEGIN;

-- ── Worker availability settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.worker_availability (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    available_days      INTEGER[]   NOT NULL DEFAULT ARRAY[1,2,3,4,5], -- 1=Mon … 7=Sun
    day_start_time      TIME        NOT NULL DEFAULT '08:00',
    day_end_time        TIME        NOT NULL DEFAULT '18:00',
    max_hours_per_week  INTEGER     NOT NULL DEFAULT 40,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_worker_availability UNIQUE (user_id)
);

-- ── Worker blackout dates (vacation, training, unavailability) ────────────────
CREATE TABLE IF NOT EXISTS public.worker_blackout_dates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    start_date      DATE        NOT NULL,
    end_date        DATE        NOT NULL,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_blackout_dates CHECK (end_date >= start_date)
);

-- ── Worker certified skills ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.worker_skills (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    skill           TEXT        NOT NULL,
    is_certified    BOOLEAN     NOT NULL DEFAULT TRUE,
    certified_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_worker_skill UNIQUE (user_id, skill)
);

-- ── Participant required skills ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.participant_required_skills (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id  UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    skill           TEXT        NOT NULL,
    is_mandatory    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_participant_required_skill UNIQUE (participant_id, skill)
);

-- ── In-app notifications for workers ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.worker_notifications (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    type            TEXT        NOT NULL CHECK (type IN (
                        'shift_assigned','shift_unassigned','shift_reassigned','shift_rescheduled'
                    )),
    shift_id        UUID        REFERENCES public.shifts(id) ON DELETE SET NULL,
    title           TEXT        NOT NULL,
    body            TEXT        NOT NULL,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Add "unassigned" and "reassigned" shift statuses ─────────────────────────
-- Extend status check to include unassigned
DO $$
BEGIN
    -- Drop and re-add the constraint with new values only if it exists
    ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
    ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check
        CHECK (status IN ('unassigned','scheduled','in_progress','clocked_in','completed','cancelled'));
EXCEPTION WHEN others THEN NULL;
END;
$$;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_worker_notifications_user
    ON public.worker_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_skills_user
    ON public.worker_skills (user_id);

CREATE INDEX IF NOT EXISTS idx_participant_required_skills_participant
    ON public.participant_required_skills (participant_id);

CREATE INDEX IF NOT EXISTS idx_worker_blackout_dates_user
    ON public.worker_blackout_dates (user_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_shifts_worker_time
    ON public.shifts (worker_id, scheduled_start, scheduled_end)
    WHERE worker_id IS NOT NULL;

COMMIT;
