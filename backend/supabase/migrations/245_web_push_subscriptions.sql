-- Browser push: let user_push_tokens hold Web Push subscriptions alongside
-- the mobile app's Expo/FCM tokens. push_token holds the browser's
-- PushSubscription JSON; device_id is a hash of its endpoint.
-- Until this runs, turning on browser notifications reports "not available"
-- and everything else keeps working.

BEGIN;

ALTER TABLE public.user_push_tokens
    DROP CONSTRAINT IF EXISTS user_push_tokens_token_type_check;

ALTER TABLE public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_token_type_check
    CHECK (token_type IN ('expo', 'fcm', 'webpush'));

-- Releasing a shared browser from the previous user looks rows up by device.
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_device
    ON public.user_push_tokens (device_id);

COMMIT;
