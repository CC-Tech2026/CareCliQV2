-- ============================================================
-- CareScribe audit/access-log alignment
-- ============================================================

ALTER TABLE public.access_logs
ADD COLUMN IF NOT EXISTS participant_id uuid,
ADD COLUMN IF NOT EXISTS session_id uuid,
ADD COLUMN IF NOT EXISTS purpose text,
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_access_logs_participant_id ON public.access_logs(participant_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_session_id ON public.access_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON public.access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON public.access_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.security_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid,
    accessor_id uuid,
    participant_id uuid,
    event_type text NOT NULL,
    description text NOT NULL,
    severity text DEFAULT 'medium',
    ip_address text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_organization_id ON public.security_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_security_events_accessor_id ON public.security_events(accessor_id);
CREATE INDEX IF NOT EXISTS idx_security_events_participant_id ON public.security_events(participant_id);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON public.security_events(created_at DESC);

