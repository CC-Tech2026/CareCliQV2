-- ============================================================
-- Admin console: messages to providers, site banners, news opt-out
-- ============================================================
-- CareCliQ staff can now write to the providers on the platform from the
-- admin portal (backend/app/api/admin_messages.py):
--
--   platform_messages             one message: subject, body, who it went to
--   platform_message_recipients   one row per person, with delivery status,
--                                 so a failure can be seen and retried
--   platform_banners              a notice across the top of the app for a
--                                 set time (maintenance, an outage, news)
--   users.product_news_opt_out    "News and product updates" carry an
--                                 unsubscribe link (Spam Act 2003); service
--                                 notices (maintenance, billing, security)
--                                 don't, and always go out
--
-- The API reads and writes these with the service role only. No foreign
-- key to organizations (key column differs between databases; see 262).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.platform_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject         text NOT NULL,
    body            text NOT NULL,
    category        text NOT NULL DEFAULT 'service' CHECK (category IN ('service', 'news')),
    channels        text[] NOT NULL DEFAULT ARRAY['email']::text[],
    button_label    text,
    button_url      text,
    audience        jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent')),
    recipient_count integer NOT NULL DEFAULT 0,
    org_count       integer NOT NULL DEFAULT 0,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz
);

CREATE TABLE IF NOT EXISTS public.platform_message_recipients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      uuid NOT NULL REFERENCES public.platform_messages(id) ON DELETE CASCADE,
    organization_id uuid,
    user_id         uuid,
    email           text NOT NULL,
    full_name       text,
    role            text,
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'failed', 'in_app_only', 'opted_out')),
    error           text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_message_recipients_message
    ON public.platform_message_recipients (message_id, status);
CREATE INDEX IF NOT EXISTS platform_message_recipients_org
    ON public.platform_message_recipients (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_banners (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message     text NOT NULL,
    tone        text NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'warning')),
    audience    text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'directors')),
    link_label  text,
    link_url    text,
    starts_at   timestamptz NOT NULL DEFAULT now(),
    ends_at     timestamptz NOT NULL,
    created_by  uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS platform_banners_window ON public.platform_banners (ends_at, starts_at);

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS product_news_opt_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.product_news_opt_out IS
    'Unsubscribed from CareCliQ news and product update emails (admin portal messages with category news). Service notices still arrive.';

ALTER TABLE public.platform_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_banners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_messages, public.platform_message_recipients, public.platform_banners
    FROM anon, authenticated;
