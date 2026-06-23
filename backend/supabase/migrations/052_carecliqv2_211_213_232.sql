-- CARECLIQV2-211 / 213 / 232 — minimal schema additions

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS photo_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.incidents.photo_metadata IS
    'Per-photo url, description, and captured_at .';

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS end_validation JSONB;

COMMENT ON COLUMN public.sessions.end_validation IS
    'Shift-end task/evidence validation snapshot.';

ALTER TABLE public.shift_office_messages ENABLE ROW LEVEL SECURITY;

-- RLS helpers (idempotent — safe if migration 019/006 already ran)
CREATE OR REPLACE FUNCTION public.cs_user_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT organization_id
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND is_active = true
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cs_is_coordinator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members
        WHERE user_id = auth.uid()
          AND role = 'support_coordinator'
          AND is_active = true
    );
$$;

DROP POLICY IF EXISTS shift_office_messages_worker_select ON public.shift_office_messages;
CREATE POLICY shift_office_messages_worker_select ON public.shift_office_messages
    FOR SELECT
    USING (
        organization_id = public.cs_user_org_id()
        AND worker_id = auth.uid()
    );

DROP POLICY IF EXISTS shift_office_messages_worker_insert ON public.shift_office_messages;
CREATE POLICY shift_office_messages_worker_insert ON public.shift_office_messages
    FOR INSERT
    WITH CHECK (
        organization_id = public.cs_user_org_id()
        AND worker_id = auth.uid()
    );

DROP POLICY IF EXISTS shift_office_messages_coordinator_select ON public.shift_office_messages;
CREATE POLICY shift_office_messages_coordinator_select ON public.shift_office_messages
    FOR SELECT
    USING (
        organization_id = public.cs_user_org_id()
        AND public.cs_is_coordinator()
    );

COMMIT;
