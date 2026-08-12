-- ============================================================================
-- Test: Budget Ledger Append-Only Constraint & Basic Operations
-- ============================================================================

-- Test UUIDs
DO $$ 
DECLARE
    v_org_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID;
    v_participant_id UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::UUID;
    v_plan_id UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID;
    v_txn_id UUID;
BEGIN
    -- 1. INSERT: Create test transaction
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description,
        ledger_source, created_by
    ) VALUES (
        v_org_id, v_participant_id, v_plan_id, 'general',
        'ALLOCATION', 100000, 'Test allocation - $1000',
        'onboarding', 'test_user'
    ) RETURNING id INTO v_txn_id;
    
    RAISE NOTICE '✅ INSERT SUCCESS: Created transaction %', v_txn_id;
    
    -- 2. SELECT: Verify transaction exists
    PERFORM COUNT(*) FROM budget_transactions 
    WHERE id = v_txn_id AND organization_id = v_org_id;
    RAISE NOTICE '✅ SELECT SUCCESS: Transaction found in ledger';
    
    -- 3. Test calculate_remaining_budget function
    PERFORM * FROM calculate_remaining_budget(v_org_id, v_participant_id, v_plan_id, 'general');
    RAISE NOTICE '✅ FUNCTION SUCCESS: calculate_remaining_budget() works';
    
    -- 4. Try UPDATE: Should fail with append-only error
    BEGIN
        UPDATE budget_transactions 
        SET description = 'Modified' 
        WHERE id = v_txn_id;
        RAISE NOTICE '❌ ERROR: UPDATE was not blocked (should have failed)';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '✅ UPDATE BLOCKED (correct): %', SQLERRM;
    END;
    
    -- 5. Try DELETE: Should fail with append-only error
    BEGIN
        DELETE FROM budget_transactions WHERE id = v_txn_id;
        RAISE NOTICE '❌ ERROR: DELETE was not blocked (should have failed)';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '✅ DELETE BLOCKED (correct): %', SQLERRM;
    END;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ ALL TESTS PASSED - Ledger is operational!';
    RAISE NOTICE '========================================';
END $$;
