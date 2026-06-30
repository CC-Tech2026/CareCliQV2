-- CARECLIQV2-209 / CARECLIQV2-213 / CARECLIQV2-212 — shift visit notes, office messages, incident extensions

BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_visit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    category TEXT,
    attachment_urls TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_visit_notes_shift
    ON public.shift_visit_notes (shift_id, created_at DESC);

COMMENT ON TABLE public.shift_visit_notes IS
    'Worker visit/daily notes captured during an active shift (CARECLIQV2-209).';

CREATE TABLE IF NOT EXISTS public.shift_office_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('normal', 'urgent', 'emergency')),
    attachment_urls TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_office_messages_shift
    ON public.shift_office_messages (shift_id, created_at DESC);

COMMENT ON TABLE public.shift_office_messages IS
    'Worker to office messages during a shift (CARECLIQV2-213).';

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS escalate BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_incidents_shift_id
    ON public.incidents (shift_id)
    WHERE shift_id IS NOT NULL;

COMMIT;
