-- ============================================================
-- CareScribe billing/subscription and independent invoicing
-- ============================================================

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL UNIQUE,
    plan_name text NOT NULL DEFAULT 'starter',
    status text NOT NULL DEFAULT 'trialing',
    billing_email text,
    seats integer NOT NULL DEFAULT 1,
    price_cents integer NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'AUD',
    renewal_date date,
    payment_provider text NOT NULL DEFAULT 'manual',
    external_customer_id text,
    external_subscription_id text,
    notes text,
    updated_by uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT billing_subscriptions_plan_check
      CHECK (plan_name IN ('starter', 'team', 'pro', 'enterprise')),
    CONSTRAINT billing_subscriptions_status_check
      CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'manual_review')),
    CONSTRAINT billing_subscriptions_seats_check
      CHECK (seats >= 1),
    CONSTRAINT billing_subscriptions_price_check
      CHECK (price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_organization_id
    ON public.billing_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status
    ON public.billing_subscriptions(status);

CREATE TABLE IF NOT EXISTS public.invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    issued_by uuid NOT NULL,
    participant_id uuid,
    session_id uuid,
    invoice_number text NOT NULL UNIQUE,
    recipient_name text NOT NULL,
    recipient_email text,
    line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
    subtotal_cents integer NOT NULL DEFAULT 0,
    tax_cents integer NOT NULL DEFAULT 0,
    total_cents integer NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'AUD',
    status text NOT NULL DEFAULT 'draft',
    due_date date,
    issued_at timestamptz,
    paid_at timestamptz,
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT invoices_status_check
      CHECK (status IN ('draft', 'issued', 'paid', 'void', 'overdue')),
    CONSTRAINT invoices_amounts_check
      CHECK (subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0),
    CONSTRAINT invoices_line_items_array_check
      CHECK (jsonb_typeof(line_items) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_invoices_organization_id ON public.invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issued_by ON public.invoices(issued_by);
CREATE INDEX IF NOT EXISTS idx_invoices_participant_id ON public.invoices(participant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_session_id ON public.invoices(session_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON public.invoices(created_at DESC);

ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'billing_subscriptions'
          AND policyname = 'billing_subscriptions_service_all'
    ) THEN
        CREATE POLICY billing_subscriptions_service_all
        ON public.billing_subscriptions
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'invoices'
          AND policyname = 'invoices_service_all'
    ) THEN
        CREATE POLICY invoices_service_all
        ON public.invoices
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

