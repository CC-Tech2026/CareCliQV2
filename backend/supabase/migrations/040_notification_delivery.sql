-- CARECLIQV2-259: notification delivery log (dedup for email / in-app)

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event text NOT NULL,
    reference_key text NOT NULL,
    channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
    sent_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_delivery UNIQUE (user_id, event, reference_key, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user
    ON public.notification_deliveries(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_reference
    ON public.notification_deliveries(event, reference_key);
