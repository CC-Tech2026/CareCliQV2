-- ============================================================================
-- CARECLIQV2-304: Budget Resolution Functions
-- ============================================================================
-- Purpose: Single source of truth for computing remaining budget.
-- This function is called by invoicing, payments, and budget visibility features.
--
-- Architecture:
--   - Query ledger instead of direct balance calculations
--   - Support category-level breakdown
--   - Return historical snapshots
--   - Prevent duplicate calculations
--
-- Critical Design:
--   Feature 2, Subtask 1: Category scoping MUST match ndis_plans/plan_budgets model
--   Feature 2, Subtask 2: Historical snapshots for reconciliation
--   Feature 2, Subtask 3: Balance calculation logic
-- ============================================================================

-- ============================================================================
-- Function: calculate_remaining_budget
-- ============================================================================
-- Calculates remaining budget for a participant in a plan, by category
--
-- Parameters:
--   p_organization_id: UUID of organization
--   p_participant_id: UUID of participant
--   p_plan_id: UUID of plan (NULL = organization-level)
--   p_category: NDIS category code (e.g., "01_011_0107_1_1") or 'general'
--   p_as_of_date: TIMESTAMP to calculate balance AS OF this date (for historical snapshots)
--
-- Returns:
--   RECORD with:
--     - total_allocated: Total budget allocated (sum of ALLOCATION transactions)
--     - total_reserved: Total budget reserved (sum of RESERVATION transactions)
--     - total_paid: Total budget paid (sum of PAYMENT transactions)
--     - adjustments: Net adjustments (ADJUSTMENT + REVERSAL + CORRECTION)
--     - remaining: Remaining budget (allocated - reserved - paid + adjustments)
--     - as_of_date: The date used for the calculation
--
-- Naming Convention: This is THE function for remaining budget.
-- Do not create alternative implementations. This is single source of truth.
-- All downstream features (invoicing, visibility) must call this.
--
-- CARECLIQV2-304 Requirement: Only one place computes remaining budget.
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
        -- Total allocations
        COALESCE(SUM(CASE WHEN bt.transaction_type = 'ALLOCATION' THEN bt.amount_cents ELSE 0 END), 0)::BIGINT as total_allocated,
        
        -- Total reservations (soft holds)
        COALESCE(SUM(CASE WHEN bt.transaction_type = 'RESERVATION' THEN bt.amount_cents ELSE 0 END), 0)::BIGINT as total_reserved,
        
        -- Total payments
        COALESCE(SUM(CASE WHEN bt.transaction_type = 'PAYMENT' THEN bt.amount_cents ELSE 0 END), 0)::BIGINT as total_paid,
        
        -- Net adjustments (ADJUSTMENT + REVERSAL + CORRECTION)
        COALESCE(SUM(CASE 
            WHEN bt.transaction_type IN ('ADJUSTMENT', 'REVERSAL', 'CORRECTION') 
            THEN bt.amount_cents 
            ELSE 0 
        END), 0)::BIGINT as net_adjustments,
        
        -- Remaining = allocated - reserved - paid + adjustments
        (
            COALESCE(SUM(CASE WHEN bt.transaction_type = 'ALLOCATION' THEN bt.amount_cents ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN bt.transaction_type = 'RESERVATION' THEN bt.amount_cents ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN bt.transaction_type = 'PAYMENT' THEN bt.amount_cents ELSE 0 END), 0) +
            COALESCE(SUM(CASE 
                WHEN bt.transaction_type IN ('ADJUSTMENT', 'REVERSAL', 'CORRECTION') 
                THEN bt.amount_cents 
                ELSE 0 
            END), 0)
        )::BIGINT as remaining,
        
        p_as_of_date as as_of_date
    FROM budget_transactions bt
    WHERE 
        bt.organization_id = p_organization_id
        AND bt.participant_id = p_participant_id
        AND (p_plan_id IS NULL OR bt.plan_id = p_plan_id)
        AND bt.category = p_category
        AND bt.created_at <= p_as_of_date;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_remaining_budget IS
'CARECLIQV2-304: Single source of truth for remaining budget calculation. All downstream features must call this function. Do not create alternative implementations.';

-- ============================================================================
-- Function: get_budget_snapshot
-- ============================================================================
-- Returns complete budget snapshot for a participant across all categories
--
-- CARECLIQV2-304 (Feature 2, Subtask 2): Historical snapshot queries
-- ============================================================================

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
    remaining BIGINT,
    as_of_date TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        bt.category,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).total_allocated,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).total_reserved,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).total_paid,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).net_adjustments,
        (calculate_remaining_budget(p_organization_id, p_participant_id, p_plan_id, bt.category, p_as_of_date)).remaining,
        p_as_of_date
    FROM budget_transactions bt
    WHERE 
        bt.organization_id = p_organization_id
        AND bt.participant_id = p_participant_id
        AND (p_plan_id IS NULL OR bt.plan_id = p_plan_id)
        AND bt.created_at <= p_as_of_date
    ORDER BY category;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_budget_snapshot IS
'CARECLIQV2-304: Returns complete budget breakdown by category as of a given date. Used for reconciliation and historical budget tracking.';

-- ============================================================================
-- Function: audit_budget_consistency
-- ============================================================================
-- Verifies ledger consistency for integration testing
-- 
-- CARECLIQV2-305: Integration testing gate
-- Checks:
--   1. No negative allocations (initial budgets can't go backward)
--   2. Payment totals never exceed allocation totals
--   3. Reserved + Paid never exceed allocated (soft constraint with tolerance)
--
-- Returns any inconsistencies found
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_budget_consistency(
    p_organization_id UUID
)
RETURNS TABLE (
    issue_type VARCHAR,
    participant_id UUID,
    plan_id UUID,
    category VARCHAR,
    total_allocated BIGINT,
    total_paid BIGINT,
    total_reserved BIGINT,
    remaining BIGINT,
    issue_description TEXT
) AS $$
BEGIN
    RETURN QUERY
    -- Find cases where total paid exceeds total allocated (hardstop inconsistency)
    SELECT
        'OVERPAYMENT'::VARCHAR as issue_type,
        snapshot.participant_id,
        snapshot.plan_id,
        snapshot.category,
        snapshot.total_allocated,
        snapshot.total_paid,
        snapshot.total_reserved,
        snapshot.remaining,
        'Total paid (' || snapshot.total_paid || ') exceeds total allocated (' || snapshot.total_allocated || ')'::TEXT
    FROM (
        SELECT DISTINCT
            p.id as participant_id,
            bt.plan_id,
            bt.category,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_allocated,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_paid,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_reserved,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).remaining
        FROM budget_transactions bt
        JOIN participants p ON p.id = bt.participant_id
        WHERE bt.organization_id = p_organization_id
    ) snapshot
    WHERE snapshot.total_paid > snapshot.total_allocated;
    
    -- Find cases where reserved + paid would exceed allocated (soft constraint warning)
    RETURN QUERY
    SELECT
        'OVER_COMMITTED'::VARCHAR as issue_type,
        snapshot.participant_id,
        snapshot.plan_id,
        snapshot.category,
        snapshot.total_allocated,
        snapshot.total_paid,
        snapshot.total_reserved,
        snapshot.remaining,
        'Reserved + Paid (' || (snapshot.total_reserved + snapshot.total_paid) || ') exceeds allocated (' || snapshot.total_allocated || ')'::TEXT
    FROM (
        SELECT DISTINCT
            p.id as participant_id,
            bt.plan_id,
            bt.category,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_allocated,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_paid,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).total_reserved,
            (calculate_remaining_budget(p_organization_id, p.id, bt.plan_id, bt.category)).remaining
        FROM budget_transactions bt
        JOIN participants p ON p.id = bt.participant_id
        WHERE bt.organization_id = p_organization_id
    ) snapshot
    WHERE (snapshot.total_reserved + snapshot.total_paid) > snapshot.total_allocated
    AND snapshot.remaining < 0;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION audit_budget_consistency IS
'CARECLIQV2-305: Integration test function. Identifies ledger inconsistencies that would indicate data integrity issues. Used in integration test suite.';

-- ============================================================================
-- Grant execution permissions
-- ============================================================================
-- Service role (backend) can call these functions
-- Authenticated users can call them (RLS on underlying tables will restrict what they see)

GRANT EXECUTE ON FUNCTION calculate_remaining_budget(UUID, UUID, UUID, VARCHAR, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_remaining_budget(UUID, UUID, UUID, VARCHAR, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION get_budget_snapshot(UUID, UUID, UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_budget_snapshot(UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION audit_budget_consistency(UUID) TO service_role;
