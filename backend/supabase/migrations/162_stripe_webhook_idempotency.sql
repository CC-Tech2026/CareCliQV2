-- 162_stripe_webhook_idempotency.sql
-- Stripe retries webhook deliveries on failure/timeout - without a dedup
-- check, a retried event gets processed twice by handle_webhook_event()
-- (stripe_service.py). Standard Stripe-recommended pattern: record each
-- event id before dispatching it, and skip anything already recorded.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stripe_webhook_events IS
    'One row per processed Stripe webhook event id - a retried delivery of an already-recorded event is a no-op.';

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'stripe_webhook_events'
          AND policyname = 'stripe_webhook_events_service_all'
    ) THEN
        CREATE POLICY stripe_webhook_events_service_all
            ON public.stripe_webhook_events FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Tracks the last time a founding-MD signup invite was re-sent (distinct
-- from created_at, which only reflects the original send) - resend_signup_invite
-- (stripe_service.py) rate-limits repeated resends off this, not created_at,
-- so a resend more than RESEND_INVITE_COOLDOWN_MINUTES after the invite was
-- created doesn't reset the cooldown to zero.
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS last_resent_at TIMESTAMPTZ;

COMMIT;
