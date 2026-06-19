-- CARECLIQV2-259: worker profile & account management

ALTER TABLE public.organization_members
ADD COLUMN IF NOT EXISTS employee_id text;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS preferred_contact_method text,
ADD COLUMN IF NOT EXISTS pending_email text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_contact_method_check'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_preferred_contact_method_check
        CHECK (
            preferred_contact_method IS NULL
            OR preferred_contact_method IN ('phone_call', 'sms', 'in_app_message')
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id text NOT NULL,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_notification_device UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user
    ON public.user_notification_preferences(user_id);
