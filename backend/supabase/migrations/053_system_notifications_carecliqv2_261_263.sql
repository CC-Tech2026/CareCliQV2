-- CARECLIQV2-261 / 262 / 263 — System notifications platform

BEGIN;

-- Push device tokens (Expo / FCM)
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id       TEXT        NOT NULL,
    platform        TEXT        NOT NULL DEFAULT 'web'
                    CHECK (platform IN ('ios', 'android', 'web')),
    push_token      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_push_token_device UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user ON public.user_push_tokens(user_id);

-- Unified in-app notification inbox (history + banners)
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    organization_id  UUID        REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    event_type       TEXT        NOT NULL,
    title            TEXT        NOT NULL,
    body             TEXT        NOT NULL,
    severity         TEXT        NOT NULL DEFAULT 'medium',
    shift_id         UUID        REFERENCES public.shifts(id) ON DELETE SET NULL,
    conversation_id  UUID,
    action_url       TEXT,
    payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    banner_style     TEXT        CHECK (banner_style IN ('red', 'orange', 'yellow')),
    requires_ack     BOOLEAN     NOT NULL DEFAULT FALSE,
    acknowledged_at  TIMESTAMPTZ,
    read_at          TIMESTAMPTZ,
    dismissed_at     TIMESTAMPTZ,
    reference_key    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
    ON public.user_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
    ON public.user_notifications (user_id)
    WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_dedup
    ON public.user_notifications (user_id, reference_key)
    WHERE reference_key IS NOT NULL;

-- Track when worker opened shift detail (suppress 30-min reminder)
CREATE TABLE IF NOT EXISTS public.shift_view_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shift_view_worker UNIQUE (shift_id, worker_id)
);

-- Shift change acknowledgements (261)
CREATE TABLE IF NOT EXISTS public.shift_change_acknowledgements (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id         UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    notification_id  UUID        REFERENCES public.user_notifications(id) ON DELETE SET NULL,
    change_snapshot  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-shift optional reminder silence (263)
CREATE TABLE IF NOT EXISTS public.shift_reminder_settings (
    shift_id                    UUID        PRIMARY KEY REFERENCES public.shifts(id) ON DELETE CASCADE,
    worker_id                   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    silence_optional_reminders  BOOLEAN     NOT NULL DEFAULT FALSE,
    set_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations (262)
CREATE TABLE IF NOT EXISTS public.conversations (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    worker_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    coordinator_id   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    shift_id         UUID        REFERENCES public.shifts(id) ON DELETE SET NULL,
    participant_id   UUID        REFERENCES public.patients(id) ON DELETE SET NULL,
    participant_name TEXT,
    status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'read_only', 'archived')),
    last_message_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_worker
    ON public.conversations (worker_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_conversations_shift
    ON public.conversations (shift_id)
    WHERE shift_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.conversation_messages (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    body             TEXT        NOT NULL DEFAULT '',
    attachment_url   TEXT,
    message_type     TEXT        NOT NULL DEFAULT 'text'
                     CHECK (message_type IN ('text', 'image', 'action_required')),
    requires_action  BOOLEAN     NOT NULL DEFAULT FALSE,
    actioned_at      TIMESTAMPTZ,
    delivered_at     TIMESTAMPTZ,
    read_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv
    ON public.conversation_messages (conversation_id, created_at);

ALTER TABLE public.user_notifications
    ADD CONSTRAINT fk_user_notifications_conversation
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

-- Task template reminder config (263)
ALTER TABLE public.participant_task_templates
    ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS scheduled_offset_minutes INTEGER;

COMMENT ON COLUMN public.participant_task_templates.reminder_minutes IS
    'Minutes before scheduled task time to alert worker (default 5).';
COMMENT ON COLUMN public.participant_task_templates.scheduled_offset_minutes IS
    'Minutes after shift start when this task is scheduled (coordinator template).';

COMMIT;
