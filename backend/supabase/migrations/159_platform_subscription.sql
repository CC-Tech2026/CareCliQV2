-- CareCliQ's own Stripe subscription billing for provider organizations
-- (distinct from backend/app/api/billing.py, which is NDIS participant funding).

BEGIN;

ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_plan_tier_check;

UPDATE public.organizations SET plan_tier = 'micro' WHERE plan_tier = 'starter';
UPDATE public.organizations SET plan_tier = 'small' WHERE plan_tier = 'growth';
UPDATE public.organizations SET plan_tier = 'medium' WHERE plan_tier = 'enterprise';

ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_plan_tier_check
    CHECK (plan_tier IN ('micro', 'small', 'medium'));

ALTER TABLE public.organizations
    ALTER COLUMN plan_tier SET DEFAULT 'micro';

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS subscription_status TEXT,
    ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_customer
    ON public.organizations (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

-- A Stripe-signup org is created by the webhook the instant payment is
-- confirmed, before any user account exists yet (the founding Managing
-- Director only gets created once they open the welcome email and set a
-- password via the existing invitations/accept-invite flow) - so
-- owner_user_id can't be known yet at insert time. accept_invite backfills
-- it once that managing_director invite is accepted. The normal
-- (non-Stripe) org-creation path in auth.py already sets owner_user_id
-- immediately and is unaffected by this becoming nullable.
ALTER TABLE public.organizations
    ALTER COLUMN owner_user_id DROP NOT NULL;

ALTER TABLE public.invitations
    DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations
    ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('support_coordinator', 'support_worker', 'allied_health', 'managing_director'));

COMMIT;