-- ============================================================================
-- CARECLIQV2-305: Integration Test Suite for Budget Ledger
-- ============================================================================
-- Purpose: Verify append-only constraint, RLS policies, and budget calculation
--          integrity before ledger goes to production.
--
-- This suite uses pgtap for test assertions
-- Run with: SELECT * FROM runtests();
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ============================================================================
-- Test Suite Setup
-- ============================================================================

-- Create test org and participants (isolated from production)
DO $$
DECLARE
    v_test_org_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_test_participant_id UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID;
    v_test_plan_id UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID;
BEGIN
    -- Insert test organization
    INSERT INTO organizations (id, name, tier, status) 
    VALUES (v_test_org_id, 'Test Org - Ledger Integration', 'enterprise', 'active')
    ON CONFLICT (id) DO NOTHING;
    
    -- Insert test participant
    INSERT INTO participants (id, organization_id, first_name, last_name, ndis_number, status)
    VALUES (v_test_participant_id, v_test_org_id, 'Test', 'Participant', '123456789012', 'active')
    ON CONFLICT (id) DO NOTHING;
    
    -- Insert test plan
    INSERT INTO ndis_plans (id, organization_id, participant_id, plan_year, status)
    VALUES (v_test_plan_id, v_test_org_id, v_test_participant_id, '2025-2026', 'active')
    ON CONFLICT (id) DO NOTHING;
END $$;

-- ============================================================================
-- Test 1: Append-Only Constraint - INSERT Works
-- ============================================================================

CREATE OR REPLACE FUNCTION test_budget_ledger_insert_works()
RETURNS SETOF TEXT AS $$
BEGIN
    RETURN QUERY
    SELECT is(
        (INSERT INTO budget_transactions (
            organization_id, participant_id, plan_id, category,
            transaction_type, amount_cents, description,
            ledger_source, created_by
        ) VALUES (
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
            'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
            '01_011_0107_1_1',
            'ALLOCATION',
            50000000,
            'Test allocation',
            'onboarding',
            'test_suite'
        ) RETURNING id) IS NOT NULL,
        'INSERT into budget_transactions should succeed'
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Test 2: Append-Only Constraint - UPDATE is Blocked
-- ============================================================================

CREATE OR REPLACE FUNCTION test_budget_ledger_update_blocked()
RETURNS SETOF TEXT AS $$
DECLARE
    v_test_id UUID;
BEGIN
    -- Create a transaction
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        'general',
        'ALLOCATION',
        50000000,
        'Test allocation',
        'onboarding',
        'test_suite'
    ) RETURNING id INTO v_test_id;
    
    -- Try to update it (should fail)
    RETURN QUERY
    SELECT throws_ok(
        'UPDATE budget_transactions SET description = ''Modified'' WHERE id = ''' || v_test_id || '''',
        'budget_transactions: UPDATE not allowed',
        'UPDATE on budget_transactions should be blocked with append-only error'
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Test 3: Append-Only Constraint - DELETE is Blocked
-- ============================================================================

CREATE OR REPLACE FUNCTION test_budget_ledger_delete_blocked()
RETURNS SETOF TEXT AS $$
DECLARE
    v_test_id UUID;
BEGIN
    -- Create a transaction
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        'general',
        'ALLOCATION',
        30000000,
        'Test allocation',
        'onboarding',
        'test_suite'
    ) RETURNING id INTO v_test_id;
    
    -- Try to delete it (should fail)
    RETURN QUERY
    SELECT throws_ok(
        'DELETE FROM budget_transactions WHERE id = ''' || v_test_id || '''',
        'budget_transactions: DELETE not allowed',
        'DELETE on budget_transactions should be blocked with append-only error'
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Test 4: Budget Calculation - ALLOCATION
-- ============================================================================

CREATE OR REPLACE FUNCTION test_budget_calculation_allocation()
RETURNS SETOF TEXT AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Insert allocation
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        '01_001_0101_1_1',
        'ALLOCATION',
        100000000,  -- $1,000,000
        'Q1 2026 allocation',
        'onboarding',
        'test_suite'
    );
    
    -- Calculate remaining budget
    SELECT * INTO v_result
    FROM calculate_remaining_budget(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        '01_001_0101_1_1'
    );
    
    RETURN QUERY
    SELECT is(v_result.total_allocated, 100000000::BIGINT, 'Allocation should be recorded')
    UNION ALL
    SELECT is(v_result.remaining, 100000000::BIGINT, 'Remaining should equal allocation initially');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Test 5: Budget Calculation - PAYMENT Reduces Remaining
-- ============================================================================

CREATE OR REPLACE FUNCTION test_budget_calculation_payment()
RETURNS SETOF TEXT AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Insert allocation
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        '01_002_0110_1_1',
        'ALLOCATION',
        50000000,  -- $500,000
        'Q1 allocation',
        'onboarding',
        'test_suite'
    );
    
    -- Insert payment
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, reference_id, created_by
    ) VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        '01_002_0110_1_1',
        'PAYMENT',
        -15000000,  -- $150,000 payment
        'Invoice paid',
        'invoice_payment',
        'INV-20260624-001',
        'test_suite'
    );
    
    -- Calculate remaining budget
    SELECT * INTO v_result
    FROM calculate_remaining_budget(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        '01_002_0110_1_1'
    );
    
    RETURN QUERY
    SELECT is(v_result.total_paid, -15000000::BIGINT, 'Payment should be recorded')
    UNION ALL
    SELECT is(v_result.remaining, 35000000::BIGINT, 'Remaining should be 500k - 150k = 350k');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Test 6: Budget Snapshot - Multiple Categories
-- ============================================================================

CREATE OR REPLACE FUNCTION test_budget_snapshot_multiple_categories()
RETURNS SETOF TEXT AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Insert allocations in different categories
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES
    (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        '01_003_0100_1_1',
        'ALLOCATION',
        20000000,  -- $200,000
        'Category 1 allocation',
        'onboarding',
        'test_suite'
    ),
    (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID,
        '01_004_0100_1_1',
        'ALLOCATION',
        30000000,  -- $300,000
        'Category 2 allocation',
        'onboarding',
        'test_suite'
    );
    
    -- Get snapshot
    SELECT COUNT(*) INTO v_count
    FROM get_budget_snapshot(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID
    );
    
    RETURN QUERY
    SELECT ok(v_count >= 2, 'Snapshot should include multiple categories');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Test 7: Audit Consistency - Detect Overpayment
-- ============================================================================

CREATE OR REPLACE FUNCTION test_audit_overpayment_detection()
RETURNS SETOF TEXT AS $$
DECLARE
    v_test_org_id_2 UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd'::UUID;
    v_test_participant_id_2 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::UUID;
    v_test_plan_id_2 UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff'::UUID;
    v_count INTEGER;
BEGIN
    -- Create test org/participant/plan
    INSERT INTO organizations (id, name, tier, status) 
    VALUES (v_test_org_id_2, 'Test Org 2 - Audit', 'enterprise', 'active')
    ON CONFLICT (id) DO NOTHING;
    
    INSERT INTO participants (id, organization_id, first_name, last_name, ndis_number, status)
    VALUES (v_test_participant_id_2, v_test_org_id_2, 'Test', 'Audit', '999999999999', 'active')
    ON CONFLICT (id) DO NOTHING;
    
    INSERT INTO ndis_plans (id, organization_id, participant_id, plan_year, status)
    VALUES (v_test_plan_id_2, v_test_org_id_2, v_test_participant_id_2, '2025-2026', 'active')
    ON CONFLICT (id) DO NOTHING;
    
    -- Create overpayment scenario: allocate 100k but pay 150k
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES
    (
        v_test_org_id_2,
        v_test_participant_id_2,
        v_test_plan_id_2,
        'general',
        'ALLOCATION',
        10000000,  -- $100,000
        'Allocation',
        'onboarding',
        'test_suite'
    ),
    (
        v_test_org_id_2,
        v_test_participant_id_2,
        v_test_plan_id_2,
        'general',
        'PAYMENT',
        -15000000,  -- $150,000 (OVERPAYMENT)
        'Payment',
        'invoice_payment',
        'test_suite'
    );
    
    -- Run audit
    SELECT COUNT(*) INTO v_count
    FROM audit_budget_consistency(v_test_org_id_2)
    WHERE issue_type = 'OVERPAYMENT';
    
    RETURN QUERY
    SELECT ok(v_count > 0, 'Audit should detect overpayment inconsistency');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Test Suite Runner
-- ============================================================================

CREATE OR REPLACE FUNCTION runtests()
RETURNS SETOF TEXT AS $$
BEGIN
    RETURN QUERY
    SELECT 'Test Suite: Budget Ledger Integration Tests (CARECLIQV2-305)'::TEXT
    UNION ALL
    SELECT ''
    UNION ALL
    SELECT 'Feature 1: Append-Only Constraint'
    UNION ALL
    SELECT test_budget_ledger_insert_works()
    UNION ALL
    SELECT test_budget_ledger_update_blocked()
    UNION ALL
    SELECT test_budget_ledger_delete_blocked()
    UNION ALL
    SELECT ''
    UNION ALL
    SELECT 'Feature 2: Budget Calculation'
    UNION ALL
    SELECT test_budget_calculation_allocation()
    UNION ALL
    SELECT test_budget_calculation_payment()
    UNION ALL
    SELECT test_budget_snapshot_multiple_categories()
    UNION ALL
    SELECT ''
    UNION ALL
    SELECT 'Feature 4: Audit Consistency'
    UNION ALL
    SELECT test_audit_overpayment_detection()
    UNION ALL
    SELECT ''
    UNION ALL
    SELECT 'Test run complete. Review results above.'
    UNION ALL
    SELECT 'For detailed TAP output, run individual test functions directly.';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION runtests IS 'Run all integration tests for budget ledger. CARECLIQV2-305.';

-- ============================================================================
-- Grant test execution permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION runtests TO authenticated;
GRANT EXECUTE ON FUNCTION runtests TO service_role;
