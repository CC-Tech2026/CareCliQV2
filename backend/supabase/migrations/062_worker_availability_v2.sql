-- CARECLIQV2-284 — Worker availability slot grid + preferences
-- Self-contained: creates worker_availability / worker_blackout_dates if 043 was not applied.

BEGIN;

-- Prerequisite tables from 043_shift_scheduling_v2.sql (idempotent)
CREATE TABLE IF NOT EXISTS public.worker_availability (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    available_days      INTEGER[]   NOT NULL DEFAULT ARRAY[1,2,3,4,5],
    day_start_time      TIME        NOT NULL DEFAULT '08:00',
    day_end_time        TIME        NOT NULL DEFAULT '18:00',
    max_hours_per_week  INTEGER     NOT NULL DEFAULT 40,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_worker_availability UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.worker_blackout_dates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    start_date      DATE        NOT NULL,
    end_date        DATE        NOT NULL,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_blackout_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_worker_blackout_dates_user
    ON public.worker_blackout_dates (user_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS public.worker_weekly_availability_slots (
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    day_of_week     SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    time_slot       TEXT        NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'evening')),
    status          TEXT        NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'unavailable', 'preferred')),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day_of_week, time_slot)
);

CREATE TABLE IF NOT EXISTS public.worker_availability_preferences (
    user_id                      UUID        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id              UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    max_shifts_per_week          SMALLINT    NOT NULL DEFAULT 5
        CHECK (max_shifts_per_week BETWEEN 1 AND 7),
    emergency_override_date      DATE,
    emergency_override_expires_at TIMESTAMPTZ,
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS preference_override_reason TEXT;

ALTER TABLE public.worker_blackout_dates
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'worker';

UPDATE public.worker_blackout_dates
    SET source = 'worker'
    WHERE source IS NULL;

COMMENT ON COLUMN public.shifts.preference_override_reason IS
    'Coordinator reason when scheduling beyond worker max_shifts_per_week (CARECLIQV2-284).';

CREATE INDEX IF NOT EXISTS idx_worker_availability_slots_user
    ON public.worker_weekly_availability_slots (user_id);

-- Backfill slot grid from legacy worker_availability when present
INSERT INTO public.worker_weekly_availability_slots (user_id, organization_id, day_of_week, time_slot, status)
SELECT
    wa.user_id,
    wa.organization_id,
    d.day_of_week,
    s.time_slot,
    CASE WHEN d.day_of_week = ANY(wa.available_days) THEN 'available' ELSE 'unavailable' END
FROM public.worker_availability wa
CROSS JOIN (SELECT generate_series(1, 7) AS day_of_week) d
CROSS JOIN (
    VALUES ('morning'), ('afternoon'), ('evening')
) AS s(time_slot)
ON CONFLICT (user_id, day_of_week, time_slot) DO NOTHING;

INSERT INTO public.worker_availability_preferences (user_id, organization_id, max_shifts_per_week, updated_at)
SELECT
    wa.user_id,
    wa.organization_id,
    LEAST(7, GREATEST(1, COALESCE(wa.max_hours_per_week, 40) / 8))::SMALLINT,
    COALESCE(wa.updated_at, now())
FROM public.worker_availability wa
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
