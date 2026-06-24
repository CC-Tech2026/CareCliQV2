-- ============================================================================
-- CARECLIQV2-303/304/305: COMPLETE BUDGET LEDGER DEPLOYMENT
-- Deploy this SINGLE file to Supabase SQL Editor - it contains ALL 4 migrations
-- ============================================================================
-- CARECLIQV2-303: Budget Transactions Append-Only Ledger
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgtap" SCHEMA public;

-- Create budget_transactions table (CARECLIQV2-303 Feature 1)
CREATE TABLE IF NOT EXISTS budget_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    participant_id UUID NOT NULL,
    plan_id UUID,
    category VARCHAR(20) NOT NULL DEFAULT 'general',
    transaction_type VARCHAR(50) NOT NULL,
    amount_cents BIGINT NOT NULL,
    description TEXT NOT NULL,
    ledger_source VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT budget_transactions_amount_valid CHECK (amount_cents != 0),
    CONSTRAINT budget_transactions_type_valid CHECK (transaction_type IN ('ALLOCATION', 'RESERVATION', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL', 'CORRECTION')),
    CONSTRAINT budget_transactions_source_valid CHECK (ledger_source IN ('onboarding', 'invoice_payment', 'adjustment_form', 'system_correction', 'plan_review', 'audit_fix'))
);

CREATE INDEX IF NOT EXISTS idx_budget_transactions_org_id ON budget_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_participant_id ON budget_transactions(participant_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_plan_id ON budget_transactions(plan_id);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_category ON budget_transactions(category);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_created_at ON budget_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_budget_transactions_type ON budget_transactions(transaction_type);

-- Append-only trigger (Feature 1, Subtask 3)
CREATE OR REPLACE FUNCTION budget_transactions_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'UPDATE not allowed - append-only constraint';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'DELETE not allowed - append-only constraint';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS budget_transactions_immutable ON budget_transactions;
CREATE TRIGGER budget_transactions_immutable
    BEFORE UPDATE OR DELETE ON budget_transactions
    FOR EACH ROW
    EXECUTE FUNCTION budget_transactions_prevent_modify();

-- RLS (Feature 1, Subtask 2)
ALTER TABLE budget_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_transactions_select ON budget_transactions;
CREATE POLICY budget_transactions_select ON budget_transactions
    FOR SELECT
    USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);
DROP POLICY IF EXISTS budget_transactions_insert ON budget_transactions;
CREATE POLICY budget_transactions_insert ON budget_transactions
    FOR INSERT
    WITH CHECK (organization_id = (auth.jwt() ->> 'organization_id')::UUID);
DROP POLICY IF EXISTS budget_transactions_no_update ON budget_transactions;
CREATE POLICY budget_transactions_no_update ON budget_transactions
    FOR UPDATE
    USING (FALSE);
DROP POLICY IF EXISTS budget_transactions_no_delete ON budget_transactions;
CREATE POLICY budget_transactions_no_delete ON budget_transactions
    FOR DELETE
    USING (FALSE);

-- ============================================================================
-- CARECLIQV2-304: Budget Resolution Functions (Feature 2)
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_remaining_budget(
    p_organization_id UUID,
    p_participant_id UUID,
    p_plan_id UUID DEFAULT NULL,
    p_category VARCHAR DEFAULT 'general',
    p_as_of_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    total_allocated BIGINT,
    total_reserved BIGINT,
    total_paid BIGINT,
    net_adjustments BIGINT,
    remaining BIGINT,
    as_of_date TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(CASE WHEN bt.transaction_type = 'ALLOCATION' THEN bt.amount_cents ELSE 0 END), 0)::BIGINT,
        COALESCE(SUM(CASE WHEN bt.transaction_type = 'RESERVATION' THEN bt.amount_cents ELSE 0 END), 0)::BIGINT,
        COALESCE(SUM(CASE WHEN bt.transaction_type = 'PAYMENT' THEN bt.amount_cents ELSE 0 END), 0)::BIGINT,
        COALESCE(SUM(CASE WHEN bt.transaction_type IN ('ADJUSTMENT', 'REVERSAL', 'CORRECTION') THEN bt.amount_cents ELSE 0 END), 0)::BIGINT,
        (COALESCE(SUM(CASE WHEN bt.transaction_type = 'ALLOCATION' THEN bt.amount_cents ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN bt.transaction_type = 'RESERVATION' THEN bt.amount_cents ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN bt.transaction_type = 'PAYMENT' THEN bt.amount_cents ELSE 0 END), 0) +
         COALESCE(SUM(CASE WHEN bt.transaction_type IN ('ADJUSTMENT', 'REVERSAL', 'CORRECTION') THEN bt.amount_cents ELSE 0 END), 0))::BIGINT,
        p_as_of_date
    FROM budget_transactions bt
    WHERE bt.organization_id = p_organization_id
    AND bt.participant_id = p_participant_id
    AND (p_plan_id IS NULL OR bt.plan_id = p_plan_id)
    AND bt.category = p_category
    AND bt.created_at <= p_as_of_date;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_budget_snapshot(
    p_organization_id UUID,
    p_participant_id UUID,
    p_plan_id UUID DEFAULT NULL,
    p_as_of_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    category VARCHAR,
    total_allocated BIGINT,
    total_reserved BIGINT,
    total_paid BIGINT,
    net_adjustments BIGINT,
    remaining BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        bt.category,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).total_allocated,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).total_reserved,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).total_paid,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).net_adjustments,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).remaining
    FROM budget_transactions bt
    WHERE bt.organization_id = p_organization_id
    AND bt.participant_id = p_participant_id
    AND (p_plan_id IS NULL OR bt.plan_id = p_plan_id)
    AND bt.created_at <= p_as_of_date
    ORDER BY category;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION audit_budget_consistency(p_organization_id UUID)
RETURNS TABLE (
    issue_type VARCHAR,
    participant_id UUID,
    plan_id UUID,
    category VARCHAR,
    total_allocated BIGINT,
    total_paid BIGINT,
    issue_description TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 'OVERPAYMENT'::VARCHAR, p.id, bt.plan_id, bt.category,
        (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_allocated,
        (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_paid,
        'Total paid exceeds allocated'::TEXT
    FROM budget_transactions bt
    JOIN participants p ON p.id = bt.participant_id
    WHERE bt.organization_id = p_organization_id
    GROUP BY p.id, bt.plan_id, bt.category
    HAVING (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_paid >
           (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_allocated;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION calculate_remaining_budget(UUID, UUID, UUID, VARCHAR, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_remaining_budget(UUID, UUID, UUID, VARCHAR, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION get_budget_snapshot(UUID, UUID, UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_budget_snapshot(UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION audit_budget_consistency(UUID) TO service_role;

-- ============================================================================
-- CARECLIQV2-303 Feature 3: Migration Functions
-- ============================================================================
CREATE OR REPLACE FUNCTION onboarding_create_budget_ledger_entry(
    p_organization_id UUID,
    p_participant_id UUID,
    p_plan_id UUID,
    p_total_budget_cents BIGINT,
    p_category VARCHAR DEFAULT 'general'
)
RETURNS UUID AS $$
DECLARE
    v_transaction_id UUID;
BEGIN
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, reference_id, created_by
    ) VALUES (
        p_organization_id, p_participant_id, p_plan_id, p_category,
        'ALLOCATION', p_total_budget_cents,
        'Initial plan budget allocation',
        'onboarding', 'plan:' || p_plan_id::TEXT,
        'onboarding_service'
    ) RETURNING id INTO v_transaction_id;
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_budget_adjustment(
    p_organization_id UUID,
    p_participant_id UUID,
    p_plan_id UUID,
    p_adjustment_cents BIGINT,
    p_reason TEXT,
    p_category VARCHAR DEFAULT 'general'
)
RETURNS UUID AS $$
DECLARE
    v_transaction_id UUID;
    v_source VARCHAR(50);
BEGIN
    v_source := CASE
        WHEN p_reason ILIKE '%plan review%' THEN 'plan_review'
        WHEN p_reason ILIKE '%audit%' THEN 'audit_fix'
        ELSE 'adjustment_form'
    END;
    
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES (
        p_organization_id, p_participant_id, p_plan_id, p_category,
        'ADJUSTMENT', p_adjustment_cents, p_reason,
        v_source, 'manual_adjustment'
    ) RETURNING id INTO v_transaction_id;
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION onboarding_create_budget_ledger_entry(UUID, UUID, UUID, BIGINT, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION record_budget_adjustment(UUID, UUID, UUID, BIGINT, TEXT, VARCHAR) TO service_role;
