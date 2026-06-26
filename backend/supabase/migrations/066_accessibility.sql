-- CARECLIQV2-290 — Accessibility preferences & language

BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_language_check'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_preferred_language_check
        CHECK (preferred_language IN ('en', 'vi', 'ar', 'zh-Hans'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_accessibility_preferences (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id        TEXT        NOT NULL,
    font_size        TEXT        NOT NULL DEFAULT 'default'
                     CHECK (font_size IN ('small', 'default', 'large', 'xl')),
    theme_mode       TEXT        NOT NULL DEFAULT 'system'
                     CHECK (theme_mode IN ('system', 'light', 'dark')),
    high_contrast    BOOLEAN     NOT NULL DEFAULT false,
    dyslexia_font    BOOLEAN     NOT NULL DEFAULT false,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_accessibility_device UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_accessibility_prefs_user
    ON public.user_accessibility_preferences (user_id);

ALTER TABLE public.user_accessibility_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_accessibility_preferences' AND policyname = 'user_accessibility_service_role') THEN
        CREATE POLICY user_accessibility_service_role ON public.user_accessibility_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMIT;
