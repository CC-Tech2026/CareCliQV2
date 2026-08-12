-- One staff-invite request per email + name + organisation (anti-spam)

BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_invite_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations (organization_id) ON DELETE CASCADE,
    requester_email TEXT NOT NULL,
    requester_full_name TEXT NOT NULL,
    requester_email_norm TEXT GENERATED ALWAYS AS (lower(btrim(requester_email))) STORED,
    requester_full_name_norm TEXT GENERATED ALWAYS AS (lower(btrim(requester_full_name))) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_invite_requests_org_email_name
    ON public.staff_invite_requests (organization_id, requester_email_norm, requester_full_name_norm);

CREATE INDEX IF NOT EXISTS idx_staff_invite_requests_org_created
    ON public.staff_invite_requests (organization_id, created_at DESC);

ALTER TABLE public.staff_invite_requests ENABLE ROW LEVEL SECURITY;

COMMIT;
