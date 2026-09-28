-- Service agreements: the signed document is the actual source of record for
-- plan management type, negotiated (override) rates, and the price-adjustment/
-- GST clauses — several things CareCliQ currently tracks as separate flags
-- with no link back to what was actually signed. See markdown/
-- NDIS_CLAIM_TYPES_BACKLOG.md item 1 for why this was previously logged as
-- dormant (still true for NF2F/travel/cancellation claim generation — this
-- migration doesn't change that) and the design doc this schema implements.
--
-- Scope of this migration: schema only. Nothing yet writes to these tables —
-- not onboarding, not billing_period_service, not the ndis_price_items
-- override path. Wiring those up is later work, deliberately not bundled
-- here: the override-rate wiring in particular reaches into
-- ndis_price_items.is_override/edited_by, which is under active work in
-- this same repo as of 2026-09-25 (migrations 210/213) — sequencing that
-- against this schema is a separate decision, not assumed by adding the
-- tables.
--
-- plan_management_type here uses the same canonical values as
-- patients.plan_management_type / billing_periods.locked_plan_management_type
-- (backend/app/models/billing_period.py's VALID_PLAN_MANAGEMENT_TYPES) rather
-- than the design doc's snake_case spelling, so a future read doesn't need a
-- second normalisation step on top of normalize_plan_management_type().
--
-- Confirmed live (2026-09-25): ndis_plans.plan_management_type exists as a
-- column but is NULL on every current row — dead, not the live source of
-- truth. patients.plan_management_type is what billing_period_service
-- actually reads today; this table is meant to eventually replace that read,
-- not ndis_plans'.

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_agreements (
    id                                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    participant_id                      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

    -- Declared in the agreement itself, not a separately-set flag — see
    -- backend/app/models/billing_period.py for the canonical value set.
    plan_management_type                TEXT        NOT NULL
                                        CHECK (plan_management_type IN ('NDIA-managed', 'plan-managed', 'self-managed')),
    plan_manager_name                   TEXT,
    plan_manager_email                  TEXT,

    -- The agreement's own service period — distinct from ndis_plans.plan_start/plan_end.
    start_date                          DATE        NOT NULL,
    end_date                            DATE,
    CONSTRAINT service_agreements_valid_dates CHECK (end_date IS NULL OR end_date >= start_date),

    -- Whether THIS signed agreement carries the "prices adjust with NDIS
    -- price guide changes" clause. Not every template has it — reflects what
    -- was actually signed, never assumed true by default.
    includes_price_adjustment_clause    BOOLEAN     NOT NULL DEFAULT false,

    -- Free text / reference grounding the GST-free claim for this
    -- participant (e.g. quoting the agreement's own GST clause tying it to
    -- the NDIS Plan's statement of supports). Deliberately not a boolean —
    -- the point is to capture the stated basis, not decide GST treatment.
    gst_treatment_basis                 TEXT,

    cancellation_notice_hours           INTEGER,
    cancellation_fee_percentage         NUMERIC(5, 2),

    status                              TEXT        NOT NULL DEFAULT 'draft'
                                        CHECK (status IN ('draft', 'pending_signature', 'active', 'expired', 'ended')),
    signed_by                           TEXT,
    signed_date                         DATE,

    -- Reference to the actual uploaded/generated PDF this record describes.
    -- Intentionally not FK'd to a documents table yet — none exists live;
    -- wire this up when the actual upload/generation flow is built rather
    -- than guessing at that table's shape now.
    source_document_id                  UUID,

    created_by                          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per support line in the agreement's Schedule of Supports.
CREATE TABLE IF NOT EXISTS public.service_agreement_supports (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    service_agreement_id        UUID        NOT NULL REFERENCES public.service_agreements(id) ON DELETE CASCADE,

    -- No FK, matching ndis_price_items' own item_code convention (see
    -- 073_task_pricing_evidence_invoicing.sql's comment): item_code isn't
    -- unique on its own across schedules/orgs, so validation is
    -- application-side, not a DB constraint.
    support_item_code           TEXT        NOT NULL,

    -- If set, this is what should create/update the corresponding
    -- ndis_price_items row with is_override = true for this org and item —
    -- a real negotiated rate tied to a real signed document. Not wired up by
    -- this migration; see the file header.
    negotiated_rate              NUMERIC(10, 2),

    frequency                    TEXT        CHECK (frequency IN ('weekly', 'fortnightly', 'monthly', 'as_scheduled')),
    total_hours_allocated        NUMERIC(8, 2),
    total_funding                NUMERIC(12, 2),

    -- Only relevant once Provider Travel billing exists (still dormant, see
    -- file header) — captured now because it's on the document regardless.
    travel_rate_per_hour         NUMERIC(10, 2),
    travel_minutes_cap           INTEGER,

    location                     TEXT        CHECK (location IN ('home', 'school', 'preschool', 'clinic', 'other')),

    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_agreements_participant
    ON public.service_agreements (participant_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_service_agreements_org
    ON public.service_agreements (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_service_agreement_supports_agreement
    ON public.service_agreement_supports (service_agreement_id);
CREATE INDEX IF NOT EXISTS idx_service_agreement_supports_item_code
    ON public.service_agreement_supports (support_item_code);

ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_agreement_supports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view service agreements for their org" ON public.service_agreements
    FOR SELECT USING (
        organization_id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
    );

CREATE POLICY "Coordinators can manage service agreements" ON public.service_agreements
    FOR ALL USING (
        organization_id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE user_id = auth.uid()
              AND organization_id = service_agreements.organization_id
              AND role = 'support_coordinator'
        )
    );

CREATE POLICY "Users can view service agreement supports for their org" ON public.service_agreement_supports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.service_agreements sa
            WHERE sa.id = service_agreement_supports.service_agreement_id
              AND sa.organization_id = (SELECT organization_id FROM public.users WHERE id = auth.uid())
        )
    );

CREATE POLICY "Coordinators can manage service agreement supports" ON public.service_agreement_supports
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.service_agreements sa
            JOIN public.organization_members om ON om.organization_id = sa.organization_id
            WHERE sa.id = service_agreement_supports.service_agreement_id
              AND om.user_id = auth.uid()
              AND om.role = 'support_coordinator'
        )
    );

COMMENT ON TABLE public.service_agreements IS
    'One row per signed NDIS service agreement — the source of record for plan management type, negotiated rates, and price-adjustment/GST clauses for a participant. Schema-only as of 2026-09-25; nothing writes to this yet.';
COMMENT ON TABLE public.service_agreement_supports IS
    'One row per support line in a service agreement''s Schedule of Supports. negotiated_rate is the mechanism meant to eventually populate ndis_price_items.is_override, not wired up yet.';

COMMIT;
