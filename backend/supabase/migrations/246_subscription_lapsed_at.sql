-- When an organisation's CareCliQ subscription lapsed.
--
-- Set by the Stripe webhook when the subscription turns past_due, unpaid,
-- canceled or similar, and cleared when it's active again. Records become
-- read-only seven days after this (services/subscription_access.py). Without
-- this column the trial end date is used instead.

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS subscription_lapsed_at TIMESTAMPTZ;
