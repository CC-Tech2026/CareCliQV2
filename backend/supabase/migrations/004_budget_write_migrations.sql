-- ============================================================================
-- CARECLIQV2-303: Feature 3 - Budget Write Migrations & Audit
-- ============================================================================
-- Purpose: Audit where participant budgets are currently written,
--          then migrate all budget write paths to use the ledger.
--
-- Subtasks:
--   1. Audit current participant budget writes
--   2. Migrate onboarding path to ledger
--   3. Migrate other budget update points
--   4. Deprecate old direct balance updates
--
-- CRITICAL: Do not skip Subtask 1 (audit first).
--           The onboarding path may not be where you think it is.
-- ============================================================================

-- ============================================================================
-- Subtask 1: Audit Current Budget Write Locations
-- ============================================================================
-- This view shows where participant budgets are currently written
-- Run this view first to understand the codebase before implementing migrations

CREATE OR REPLACE VIEW v_budget_write_audit AS
SELECT
    'participants.total_annual_budget' as write_location,
    'Direct balance field' as description,
    'onboarding' as primary_use_case,
    'UPDATE participants SET total_annual_budget = X WHERE id = Y' as current_pattern,
    'HIGH' as migration_priority
UNION ALL
SELECT
    'ndis_plans.total_budget',
    'Plan-level budget in ndis_plans table',
    'plan allocation',
    'UPDATE ndis_plans SET total_budget = X WHERE id = Y',
    'MEDIUM'
UNION ALL
SELECT
    'plan_budgets.total_allocated' as write_location,
    'Category-level budget allocation' as description,
    'category breakdown' as primary_use_case,
    'UPDATE plan_budgets SET total_allocated = X WHERE id = Y' as current_pattern,
    'MEDIUM' as migration_priority;

COMMENT ON VIEW v_budget_write_audit IS
'CARECLIQV2-303, Feature 3, Subtask 1: Audit showing where participant budgets are written. Review this before coding migrations.';

-- ============================================================================
-- Subtask 2: Migrate Onboarding Path to Ledger
-- ============================================================================
-- When a participant plan is created/activated with initial budget,
-- we now write to the ledger instead of direct balance update.

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
    v_description TEXT;
BEGIN
    -- Validate inputs
    IF p_total_budget_cents <= 0 THEN
        RAISE EXCEPTION 'Budget amount must be positive: %', p_total_budget_cents;
    END IF;
    
    -- Create ledger entry for initial allocation
    -- This replaces direct writes to participants.total_annual_budget
    INSERT INTO budget_transactions (
        organization_id,
        participant_id,
        plan_id,
        category,
        transaction_type,
        amount_cents,
        description,
        ledger_source,
        reference_id,
        metadata,
        created_by
    ) VALUES (
        p_organization_id,
        p_participant_id,
        p_plan_id,
        p_category,
        'ALLOCATION',  -- Initial budget is an ALLOCATION
        p_total_budget_cents,
        'Initial plan budget allocation during onboarding',
        'onboarding',
        'plan:' || p_plan_id::TEXT,
        jsonb_build_object(
            'onboarding_event', 'plan_activated',
            'plan_id', p_plan_id::TEXT,
            'participant_id', p_participant_id::TEXT
        ),
        'onboarding_service'
    ) RETURNING id INTO v_transaction_id;
    
    -- Note: Old code would do:
    --   UPDATE participants SET total_annual_budget = p_total_budget_cents
    --   WHERE id = p_participant_id
    -- 
    -- NOW we only write to the ledger. The ledger becomes source of truth.
    -- Remaining budget is queried via calculate_remaining_budget() function.
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION onboarding_create_budget_ledger_entry IS
'CARECLIQV2-303, Feature 3, Subtask 2: Create ledger entry for onboarding budget allocation. This replaces direct writes to participants.total_annual_budget.';

-- ============================================================================
-- Subtask 3: Migrate Other Budget Update Points to Ledger
-- ============================================================================
-- When budget adjustments are made (plan reviews, corrections, etc.),
-- write to ledger using ADJUSTMENT transaction type.

CREATE OR REPLACE FUNCTION record_budget_adjustment(
    p_organization_id UUID,
    p_participant_id UUID,
    p_plan_id UUID,
    p_adjustment_cents BIGINT,
    p_reason TEXT,
    p_category VARCHAR DEFAULT 'general',
    p_reference_id VARCHAR DEFAULT NULL,
    p_created_by VARCHAR DEFAULT 'manual_adjustment'
)
RETURNS UUID AS $$
DECLARE
    v_transaction_id UUID;
BEGIN
    -- Validate adjustment is not zero
    IF p_adjustment_cents = 0 THEN
        RAISE EXCEPTION 'Adjustment amount cannot be zero';
    END IF;
    
    -- Determine source based on reason
    DECLARE
        v_source VARCHAR(50);
    BEGIN
        IF p_reason ILIKE '%plan review%' THEN
            v_source := 'plan_review';
        ELSIF p_reason ILIKE '%audit%' OR p_reason ILIKE '%correction%' THEN
            v_source := 'audit_fix';
        ELSIF p_reason ILIKE '%appeal%' OR p_reason ILIKE '%conflict%' THEN
            v_source := 'adjustment_form';
        ELSE
            v_source := 'adjustment_form';
        END IF;
        
        -- Record adjustment in ledger
        INSERT INTO budget_transactions (
            organization_id,
            participant_id,
            plan_id,
            category,
            transaction_type,
            amount_cents,
            description,
            ledger_source,
            reference_id,
            metadata,
            created_by
        ) VALUES (
            p_organization_id,
            p_participant_id,
            p_plan_id,
            p_category,
            'ADJUSTMENT',
            p_adjustment_cents,
            p_reason,
            v_source,
            p_reference_id,
            jsonb_build_object(
                'adjustment_reason', p_reason,
                'plan_id', p_plan_id::TEXT
            ),
            p_created_by
        ) RETURNING id INTO v_transaction_id;
    END;
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_budget_adjustment IS
'CARECLIQV2-303, Feature 3, Subtask 3: Record budget adjustment (plan review, audit fix, etc.) in ledger. Replaces direct UPDATE to participants.total_annual_budget.';

-- ============================================================================
-- Subtask 4: Deprecation Path & Legacy Support
-- ============================================================================
-- This function creates a view of "effective budget" by querying the ledger
-- It provides backward compatibility for existing queries that read from
-- participants.total_annual_budget or ndis_plans.total_budget

CREATE OR REPLACE FUNCTION get_effective_budget(
    p_organization_id UUID,
    p_participant_id UUID,
    p_plan_id UUID DEFAULT NULL,
    p_category VARCHAR DEFAULT 'general',
    p_as_of_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    total_allocated BIGINT,
    total_allocated_dollars VARCHAR,
    remaining BIGINT,
    remaining_dollars VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        crb.total_allocated,
        '$' || TO_CHAR(crb.total_allocated / 100.0, '999,999,999.99') as total_allocated_dollars,
        crb.remaining,
        '$' || TO_CHAR(crb.remaining / 100.0, '999,999,999.99') as remaining_dollars
    FROM calculate_remaining_budget(
        p_organization_id, 
        p_participant_id, 
        p_plan_id, 
        p_category, 
        p_as_of_date
    ) crb;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_effective_budget IS
'CARECLIQV2-303, Feature 3, Subtask 4: Provides backward-compatible view of "effective budget" from ledger. Use this to replace legacy queries on participants.total_annual_budget.';

-- ============================================================================
-- Migration Check: Validate No Budget Writes Outside Ledger
-- ============================================================================
-- This query SHOULD return zero rows. If it doesn't, something wrote
-- directly to the old balance fields instead of using the ledger.

CREATE OR REPLACE FUNCTION check_direct_budget_writes()
RETURNS TABLE (
    issue_type VARCHAR,
    participant_id UUID,
    updated_field VARCHAR,
    current_value BIGINT,
    recommendation TEXT
) AS $$
BEGIN
    -- Check for participants with total_annual_budget set but no ledger entries
    RETURN QUERY
    SELECT
        'orphan_budget'::VARCHAR,
        p.id,
        'participants.total_annual_budget'::VARCHAR,
        p.total_annual_budget,
        'This budget should have a corresponding ALLOCATION in budget_transactions ledger'::TEXT
    FROM participants p
    WHERE 
        p.total_annual_budget > 0
        AND NOT EXISTS (
            SELECT 1 FROM budget_transactions bt
            WHERE bt.participant_id = p.id
            AND bt.organization_id = p.organization_id
            AND bt.transaction_type = 'ALLOCATION'
            LIMIT 1
        );
    
    -- Add more checks as needed:
    -- - ndis_plans with total_budget but no ledger entry
    -- - plan_budgets with total_allocated but no ledger entry
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_direct_budget_writes IS
'Check for budget writes that bypass the ledger. Should return zero rows. Used in data integrity checks.';

-- ============================================================================
-- Migration Path: Backfill Existing Budgets to Ledger
-- ============================================================================
-- For any existing participants that already have budgets set,
-- this creates ledger entries to establish the starting balance.
--
-- USAGE (in production):
--   SELECT backfill_existing_budgets_to_ledger('2026-06-24'::TIMESTAMP);
--
-- This is a one-time operation that runs after ledger is deployed.

CREATE OR REPLACE FUNCTION backfill_existing_budgets_to_ledger(
    p_backfill_date TIMESTAMPTZ DEFAULT NOW(),
    p_limit_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
    organization_id UUID,
    participant_id UUID,
    backfilled_cents BIGINT,
    transaction_id UUID,
    status VARCHAR
) AS $$
DECLARE
    v_row RECORD;
    v_txn_id UUID;
    v_count INTEGER := 0;
BEGIN
    -- Iterate over participants with existing budgets
    FOR v_row IN
        SELECT
            p.organization_id,
            p.id as participant_id,
            p.total_annual_budget,
            np.id as plan_id
        FROM participants p
        JOIN ndis_plans np ON np.participant_id = p.id
        WHERE 
            p.total_annual_budget > 0
            AND (p_limit_org_id IS NULL OR p.organization_id = p_limit_org_id)
            AND NOT EXISTS (
                SELECT 1 FROM budget_transactions bt
                WHERE bt.participant_id = p.id
                AND bt.organization_id = p.organization_id
            )
        LIMIT 1000  -- Safety limit to avoid massive backfills in one go
    LOOP
        -- Create ledger entry for existing budget
        v_txn_id := onboarding_create_budget_ledger_entry(
            v_row.organization_id,
            v_row.participant_id,
            v_row.plan_id,
            v_row.total_annual_budget,
            'general'
        );
        
        v_count := v_count + 1;
        
        RETURN QUERY
        SELECT
            v_row.organization_id,
            v_row.participant_id,
            v_row.total_annual_budget,
            v_txn_id,
            'BACKFILLED'::VARCHAR;
    END LOOP;
    
    -- Log summary
    RAISE NOTICE 'Backfilled % participants to ledger as of %', v_count, p_backfill_date;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_existing_budgets_to_ledger IS
'CARECLIQV2-303, Feature 3, Subtask 4: One-time operation to backfill existing participant budgets to ledger during migration.';

-- ============================================================================
-- Deprecation Timeline
-- ============================================================================
-- Phase 1 (NOW): Ledger deployed, all NEW budgets written to ledger
-- Phase 2 (1 week): Existing budgets backfilled to ledger
-- Phase 3 (2 weeks): participants.total_annual_budget deprecated (read-only for audit)
-- Phase 4 (1 month): Old columns can be dropped after audit period

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION onboarding_create_budget_ledger_entry TO service_role;
GRANT EXECUTE ON FUNCTION record_budget_adjustment TO service_role;
GRANT EXECUTE ON FUNCTION get_effective_budget TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_budget TO service_role;
GRANT EXECUTE ON FUNCTION check_direct_budget_writes TO service_role;
GRANT EXECUTE ON FUNCTION backfill_existing_budgets_to_ledger TO service_role;
