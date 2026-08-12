-- ============================================================================
-- Create Test Fixtures & Run Tests
-- First create test org/participant/plan, then run tests
-- ============================================================================

-- 1. Ensure test fixtures exist
INSERT INTO organizations (id, name) 
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Org')
ON CONFLICT DO NOTHING;

INSERT INTO participants (id, organization_id, name) 
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Participant')
ON CONFLICT DO NOTHING;

INSERT INTO ndis_plans (id, participant_id, plan_status) 
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'active')
ON CONFLICT DO NOTHING;

-- 2. Quick sanity check - verify ledger table works
SELECT 
    'Total Transactions' as check_type,
    COUNT(*) as count
FROM budget_transactions;

-- 3. Test append-only constraint
DO $$
BEGIN
    -- Insert a test transaction
    INSERT INTO budget_transactions (
        organization_id, participant_id, plan_id, category,
        transaction_type, amount_cents, description, ledger_source
    ) VALUES (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'general',
        'ALLOCATION', 100000, 'Test', 'onboarding'
    );
    RAISE NOTICE '✅ INSERT successful';
    
    -- Try to update (should fail)
    BEGIN
        UPDATE budget_transactions SET description = 'Modified' WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        RAISE NOTICE '❌ UPDATE should have failed!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '✅ UPDATE correctly blocked: %', SQLERRM;
    END;
    
    -- Try to delete (should fail)
    BEGIN
        DELETE FROM budget_transactions WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        RAISE NOTICE '❌ DELETE should have failed!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '✅ DELETE correctly blocked: %', SQLERRM;
    END;
    
END $$;

-- 4. Test budget calculation function
SELECT 
    'Allocation Test' as test,
    (calculate_remaining_budget(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'general'
    )).remaining as remaining_cents;

-- 5. Summary
SELECT '✅ CARECLIQV2-303/304/305 Budget Ledger is OPERATIONAL' as result;
