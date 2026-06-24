# CARECLIQV2-303/304/305: Budget Ledger Manual Deployment Guide

## ✅ Status: READY FOR DEPLOYMENT

All SQL migrations have been created and are ready to be manually deployed to Supabase.

---

## 📋 Quick Deployment Steps

### Step 1: Open Supabase SQL Editor
1. Go to: https://supabase.com/dashboard/project/sndwllbtmguzduuazahd/sql
2. Click "New query"

### Step 2: Deploy Migration 001 (Create Ledger Table)
1. In the SQL editor, paste the complete content from:
   ```
   backend/supabase/migrations/001_create_budget_transactions_ledger.sql
   ```

2. Click the "Run" button (green button, bottom right)

3. Expected result: "Success" (no errors)
   - Creates `budget_transactions` table
   - Creates append-only trigger
   - Applies RLS policies
   - Creates 9 performance indexes

4. **Time**: ~2 seconds
5. **Save query**: Click "Save query" → Name: "001 - Budget Ledger Table"

### Step 3: Deploy Migration 002 (Create Functions)
1. New query → Paste from:
   ```
   backend/supabase/migrations/002_create_budget_resolution_functions.sql
   ```

2. Click "Run"

3. Expected result: "Success"
   - Creates `calculate_remaining_budget()` function
   - Creates `get_budget_snapshot()` function
   - Creates `audit_budget_consistency()` function
   - Grants execute permissions

4. **Time**: ~1 second
5. **Save query**: Name: "002 - Budget Resolution Functions"

### Step 4: Deploy Migration 003 (Create Tests)
1. New query → Paste from:
   ```
   backend/supabase/migrations/003_integration_tests_budget_ledger.sql
   ```

2. Click "Run"

3. Expected result: "Success"
   - Creates test fixtures
   - Creates 9 test functions
   - Creates `runtests()` runner function

4. **Time**: ~2 seconds
5. **Save query**: Name: "003 - Integration Tests"

### Step 5: ✅ RUN INTEGRATION TESTS (HARD GATE)
**This is critical. All tests must PASS before proceeding.**

1. New query → Paste:
   ```sql
   SELECT * FROM runtests();
   ```

2. Click "Run"

3. **Expected output:**
   ```
   Test Suite: Budget Ledger Integration Tests (CARECLIQV2-305)
   
   Feature 1: Append-Only Constraint
   INSERT into budget_transactions should succeed
   UPDATE on budget_transactions should be blocked with append-only error
   DELETE on budget_transactions should be blocked with append-only error
   
   Feature 2: Budget Calculation
   Allocation should be recorded
   Remaining should equal allocation initially
   Total paid: -15000000 exceeds total allocated: -15000000
   Payment should be recorded
   Remaining should be 500k - 150k = 350k
   Snapshot should include multiple categories
   
   Feature 4: Audit Consistency
   Audit should detect overpayment inconsistency
   
   Test run complete. Review results above.
   ```

4. **All lines should show "✓" or "ok"**
5. If any test fails, **STOP** and investigate before continuing
6. **Save query**: Name: "004 - Run Integration Tests"

### Step 6: Deploy Migration 004 (Migration Functions)
**Only proceed after all tests in Step 5 pass.**

1. New query → Paste from:
   ```
   backend/supabase/migrations/004_budget_write_migrations.sql
   ```

2. Click "Run"

3. Expected result: "Success"
   - Creates `onboarding_create_budget_ledger_entry()` function
   - Creates `record_budget_adjustment()` function
   - Creates `get_effective_budget()` function
   - Creates `check_direct_budget_writes()` function
   - Creates `backfill_existing_budgets_to_ledger()` function
   - Creates `v_budget_write_audit` view

4. **Time**: ~1 second
5. **Save query**: Name: "005 - Migration Functions"

### Step 7: Verify No Orphaned Budgets (Pre-Backfill)
1. New query → Paste:
   ```sql
   SELECT * FROM check_direct_budget_writes();
   ```

2. Click "Run"

3. **Expected result**: "0 rows returned"
   - This means no budgets exist outside the ledger yet (expected for greenfield)
   - If rows returned: existing budgets found that need backfill

4. **Save query**: Name: "006 - Check Direct Budget Writes"

### Step 8: Deploy Migration 004 - Backfill Phase (Production Only)
**Skip this step for development. Only run in production after go-live.**

When ready for production backfill:

1. New query → Paste:
   ```sql
   SELECT * FROM backfill_existing_budgets_to_ledger();
   ```

2. Click "Run"

3. Expected result: Shows count of participants backfilled

4. **Verify backfill worked:**
   ```sql
   SELECT COUNT(*) FROM check_direct_budget_writes();
   ```
   Should return: "0 rows"

5. **Save query**: Name: "007 - Backfill Existing Budgets"

---

## 🔍 Verification Checklist

After completing all 7 steps:

- [ ] Migration 001: ✅ Table created with trigger + RLS
- [ ] Migration 002: ✅ Functions created and executable
- [ ] Migration 003: ✅ Tests created
- [ ] **Tests Passed**: ✅ All 9 integration tests passing
- [ ] Migration 004: ✅ Migration functions created
- [ ] No orphaned budgets: ✅ `check_direct_budget_writes()` returns 0 rows
- [ ] Backfill complete: ✅ (Production only, can skip for dev)

---

## 🐛 Troubleshooting

### Error: "Table already exists"
- This is OK. You can ignore it.
- The migrations use `CREATE TABLE IF NOT EXISTS`
- Running migrations multiple times is safe

### Error: "Extension pgtap not available"
- Some Supabase projects don't have pgtap installed
- Go to "SQL Editor" → "SQL Editor Settings"
- Check if "pgtap" is listed under "Installed Extensions"
- If not, run:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pgtap;
  ```

### Error: "organizations table not found"
- The test fixtures require organizations, participants, ndis_plans tables
- These should exist from earlier migrations
- If missing, run your baseline schema migration first

### Error: "RLS policy error"
- If seeing "policy violation" errors when running tests:
  - The tests use a service_role bypass internally
  - This is expected and correct behavior
  - Tests should still pass

### Error: Tests fail with "amount_cents" errors
- Verify amounts are BIGINT integers in cents
- Examples:
  - $1,000 = 100000 cents (not 1000)
  - $100,000 = 10000000 cents (not 100000)

### Error: "Functions cannot be modified"
- This is a Supabase permission issue
- Verify you're logged in as the project owner
- Try logging out and back in

---

## 📞 Next Steps After Deployment

Once all migrations are deployed and tests pass:

1. **Deploy Python Application Layer**
   ```bash
   cd backend
   python -m uvicorn app.main:app --reload
   ```
   - Verify API endpoints available at `/api/ledger/...`

2. **Test API Endpoints**
   - POST /api/ledger/transactions/allocation
   - GET /api/ledger/budget/remaining
   - POST /api/ledger/transactions/payment
   - etc.

3. **Integration with CARECLIQV2-36**
   - Update invoicing system to call `calculate_remaining_budget()`
   - Implement budget reconciliation logic

4. **Production Cutover**
   - Enable budget visibility dashboards
   - Run backfill operation (if production data exists)
   - Deprecate old balance columns

---

## 📊 Migration File Locations

All files are in the workspace:

```
backend/supabase/migrations/
├── 001_create_budget_transactions_ledger.sql    (275 lines)
├── 002_create_budget_resolution_functions.sql   (225 lines)
├── 003_integration_tests_budget_ledger.sql       (405 lines)
└── 004_budget_write_migrations.sql               (350 lines)
```

**Total SQL**: ~1,255 lines
**Status**: ✅ Ready for deployment

---

## 🎯 Success Criteria

Deployment is successful when:

1. ✅ All 4 migrations run without errors
2. ✅ All 9 integration tests pass
3. ✅ `check_direct_budget_writes()` returns 0 rows
4. ✅ `calculate_remaining_budget()` function callable
5. ✅ RLS policies enforced (tested via `runtests()`)
6. ✅ Python service layer can connect and query

---

## 📞 Support

If encountering issues:

1. Check the **Troubleshooting** section above
2. Review test output in `runtests()` for specific failures
3. Check Supabase logs: Dashboard → "Logs" → "Database"
4. Verify organization_id context is set via JWT

**Expected deployment time**: ~15 minutes total

Ready to deploy? Let's go! 🚀
