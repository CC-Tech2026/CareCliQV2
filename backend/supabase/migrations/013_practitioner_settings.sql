-- ============================================================
-- Practitioner settings — per-user profile/preferences store
-- ============================================================

CREATE TABLE IF NOT EXISTS public.practitioner_settings (
    user_id     uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    name        text,
    credentials text,
    signature   text,
    avatar_id   text,
    provider    jsonb DEFAULT '{}'::jsonb,
    session_defaults jsonb DEFAULT '{}'::jsonb,
    compliance  jsonb DEFAULT '{}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Users may only read/write their own row
ALTER TABLE public.practitioner_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.practitioner_settings
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
