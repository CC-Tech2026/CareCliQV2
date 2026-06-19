-- CARECLIQV2-260: 2FA, trusted devices, sessions, login history

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS mfa_method text,
ADD COLUMN IF NOT EXISTS mfa_totp_secret text,
ADD COLUMN IF NOT EXISTS mfa_phone text,
ADD COLUMN IF NOT EXISTS mfa_pending_secret text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_mfa_method_check'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_mfa_method_check
        CHECK (mfa_method IS NULL OR mfa_method IN ('totp', 'sms'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_mfa_recovery_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_trusted_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id text NOT NULL,
    device_name text,
    custom_name text,
    os_name text,
    user_agent text,
    trusted_until timestamptz NOT NULL,
    last_active_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_trusted_device UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_jti text NOT NULL UNIQUE,
    device_id text,
    device_name text,
    custom_name text,
    os_name text,
    user_agent text,
    ip_address text,
    city text,
    country text,
    last_active_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON public.user_sessions(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS public.user_login_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id text,
    device_name text,
    os_name text,
    ip_address text,
    city text,
    country text,
    is_suspicious boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_login_events_user_created
    ON public.user_login_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.account_security_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
