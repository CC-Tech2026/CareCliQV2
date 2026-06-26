-- CARECLIQV2-283 — Worker schedule requests (time-off, preferred shift, shift swap)

BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_schedule_requests (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    request_type        TEXT        NOT NULL
        CHECK (request_type IN ('time_off', 'preferred_shift', 'shift_swap')),
    status              TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'declined')),
    worker_notes        TEXT,
    coordinator_notes   TEXT,
    resolved_at         TIMESTAMPTZ,
    resolved_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.worker_time_off_request_details (
    request_id   UUID PRIMARY KEY REFERENCES public.worker_schedule_requests(id) ON DELETE CASCADE,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    reason_code  TEXT NOT NULL
        CHECK (reason_code IN ('annual_leave', 'personal_leave', 'medical', 'family_emergency', 'other')),
    CONSTRAINT chk_time_off_dates CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.worker_preferred_shift_request_details (
    request_id      UUID PRIMARY KEY REFERENCES public.worker_schedule_requests(id) ON DELETE CASCADE,
    participant_id  UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    preferred_days  INTEGER[] NOT NULL
);

CREATE TABLE IF NOT EXISTS public.worker_shift_swap_request_details (
    request_id UUID PRIMARY KEY REFERENCES public.worker_schedule_requests(id) ON DELETE CASCADE,
    shift_id   UUID NOT NULL REFERENCES public.shifts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_requests_org_status
    ON public.worker_schedule_requests (organization_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_schedule_requests_user_type
    ON public.worker_schedule_requests (user_id, request_type, created_at);

CREATE INDEX IF NOT EXISTS idx_time_off_details_dates
    ON public.worker_time_off_request_details (start_date, end_date);

-- Extend worker_notifications types for request status changes
DO $$
BEGIN
    ALTER TABLE public.worker_notifications DROP CONSTRAINT IF EXISTS worker_notifications_type_check;
    ALTER TABLE public.worker_notifications ADD CONSTRAINT worker_notifications_type_check
        CHECK (type IN (
            'shift_assigned', 'shift_unassigned', 'shift_reassigned', 'shift_rescheduled',
            'schedule_request_approved', 'schedule_request_declined',
            'availability_update_requested', 'scheduled_beyond_preference',
            'emergency_availability'
        ));
EXCEPTION WHEN others THEN NULL;
END;
$$;

COMMIT;
