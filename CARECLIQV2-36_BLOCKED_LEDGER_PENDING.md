# CARECLIQV2-36 — BLOCKED: Awaiting Financial State Machine Ledger Implementation

**Status:** 🛑 **BLOCKED** — Cannot proceed with implementation until the ledger exists

**Date Blocked:** 2026-06-24

**Blocking Issue:** The Financial State Machine budget ledger (`budget_transactions` table + resolution function) has been designed but is **not yet implemented** in the codebase.

---

## Current Problem (Why This Ticket Exists)

CARECLIQV2-36 ships with two bugs:

1. **Wrong source of truth:** `funding_service.py`'s `build_budget_alignment_context()` calculates remaining budget from `ndis_plans`/`plan_budgets` directly instead of using a ledger transaction resolution function. This creates a second, independent calculation of "remaining budget" that will drift whenever ledger transactions happen outside this service's knowledge.

2. **Hard fail re-introduces the block:** `check_budget_alignment()` returns `budget_exceeded` as `status="fail"` which *appears* to block approval, contradicting the confirmed product decision (soft guidance, not hard block).

---

## Phase 1 Investigation Findings

### What `build_budget_alignment_context()` Does Today

**File:** `backend/app/services/funding_service.py:139-185`

**Queries:**
```python
plan = await get_plan_for_participant(participant_id)  # From ndis_plans
budget_context = {
    "has_plan": True,
    "allocated": allocated,       # From plan_budgets.allocated_amount
    "used": used,                 # From plan_budgets.used_amount ← PROBLEM
    "remaining": allocated - used, # Direct calculation
    "session_cost": ...,
    "percent_remaining": ...
}
```

**The `used_amount` field comes from:**
- Direct Supabase query: `ndis_plans.select("*, plan_budgets(*)")`
- No transaction ledger involved
- No single source of truth

### Budget Rule Classification — Confirmed NOT Currently Blocking

**File:** `backend/app/services/compliance_engine.py:1002-1052`

**`budget_exceeded` rule:**
- `status: "fail"` ✓
- `enforcement_tier: "warn"` ← NOT "block"
- `is_blocking: False` in defaults

**In session approval (sessions.py:412-440):**
```python
block_failures = [r for r in _failing if _effective_tier(r) == "block"]
# budget_exceeded has tier="warn", NOT "block"
# So it does NOT end up in block_failures

warn_failures = [r for r in _failing if _effective_tier(r) == "warn"]
# budget_exceeded IS here — requires acknowledgement to proceed

if unacked_warn_failures:
    raise HTTPException(422, "COMPLIANCE_WARN_UNACKNOWLEDGED")
```

**Finding:** Workers CAN acknowledge budget_exceeded and proceed. It's not a true hard block today, but it's still misclassified as "fail" when it should be advisory.

---

## Blast Radius — All Budget Calculation Code Paths

**Every place in the codebase that shows budget to a user queries `plan_budgets` directly:**

| Component | File | Query Path | Impact |
|-----------|------|-----------|--------|
| Compliance engine | `backend/app/services/funding_service.py:139` | `build_budget_alignment_context()` queries `plan_budgets.used_amount` | Will drift from ledger |
| Coordinator budget tab | `backend/app/services/funding_service.py:466` | `get_budget_summary()` queries `plan_budgets` | Will show stale figures |
| Web participant page | `artifacts/frontend/src/pages/patients.tsx:681` | Calls `/api/participants/{id}/budget-summary` → `get_budget_summary()` | Will show stale figures |
| Mobile participant page | `artifacts/mobile/app/participant/[id].tsx:205` | Calls same endpoint | Will show stale figures |

**All three UI surfaces will display stale budget figures once the ledger goes live and `plan_budgets.used_amount` is no longer the source of truth.**

---

## The Ledger — What's Missing

**Designed but not implemented:**
- `budget_transactions` table (with transaction types: ACTUAL, CREDIT, REVERSAL, etc.)
- Ledger resolution function: `remaining_budget = initial_plan_budget − sum(ACTUAL) + sum(CREDIT/REVERSAL)`
- Migration files to create ledger infrastructure

**Confirmed NOT in codebase:**
- ❌ No `budget_transactions` table
- ❌ No ledger migration files
- ❌ No ledger resolution function
- ❌ No Financial State Machine design document in repo

---

## Reconciliation Plan — For When Ledger Is Ready

Once the ledger infrastructure is built, this ticket will require:

### Phase 2A: Data Source Migration

**Change 1: `build_budget_alignment_context()` — Use Ledger**

Replace:
```python
allocated = float(cat_budget.get("allocated_amount") or 0)
used = float(cat_budget.get("used_amount") or 0)
remaining = round(allocated - used, 2)
```

With:
```python
# Fetch initial allocated from plan_budgets (source of truth for allocation)
allocated = float(cat_budget.get("allocated_amount") or 0)

# But fetch REMAINING from ledger resolution function
remaining = await resolve_remaining_budget_from_ledger(
    participant_id=participant_id,
    category=category,
    as_of_date=date.today()
)
# Ledger handles: initial − sum(ACTUAL) + sum(CREDIT/REVERSAL)
```

**Rationale:** `allocated_amount` is still the source of truth (what was in the plan). But `used_amount` is now computed from the ledger, not stored directly on `plan_budgets`.

**Change 2: `get_budget_summary()` — Use Ledger**

Replace all instances of `used = float(budget.get("used_amount") or 0)` with ledger-resolved calls.

**Change 3: Frontend — No UI changes needed**

Once the backend returns ledger-resolved figures, frontend displays will automatically show correct figures. No changes to `patients.tsx` or mobile participant page needed (assuming same API contract).

---

### Phase 2B: Outcome Reclassification

**Rename the rule outcome** (breaking change but necessary):

From: `budget_exceeded` (status="fail", imples blocking)  
To: `budget_overage_advisory` (status="advisory" or new status type)

**Why:** "fail" → implies non-compliance. But budget overage is *not* a compliance failure — it's a visibility signal. The participant *should* be able to proceed; the coordinator should see the warning.

**Behavior change:**

| Scenario | Today | After Reconciliation |
|----------|-------|----------------------|
| Session cost > remaining budget | Rule: `budget_exceeded` (status="fail", tier="warn") → blocks session until acknowledged | Rule: `budget_overage_advisory` (status="advisory") → visible, not blocking, no acknowledgement required |
| 10%+ budget remaining | No rule triggered | No rule triggered |
| ≤10% budget remaining | Rule: `budget_warning` (status="warning", tier="info") → visible, not blocking | Rule: `budget_low_advisory` (status="advisory") → visible, not blocking |

**Rationale:** Per confirmed product decision — no hard blocks, soft guidance with visibility.

---

### Phase 2C: Test Case Updates

**Test cases that will change expected behavior:**

| Test Case | Current Expectation | New Expectation | Reason |
|-----------|-------------------|-----------------|--------|
| TC-36-02 "Budget Exceeded" | `status="fail"`, blocks until ack'd | `status="advisory"`, never blocks | Reclassification: budget overage is not a failure |
| TC-36-03 "Budget Warning" | `status="warning"`, advisory | `status="advisory"`, advisory | Consistent terminology (both advisory, not fail) |
| TC-36-01, TC-36-04–TC-36-09 | All pass as-is | All pass as-is | No logic change for non-budget rules |

**New test case to add:**
- `test_budget_exceeded_session_can_be_approved()` — Explicitly asserts that a budget-exceeding session CAN be approved without blocking (inverse of old TC-36-02)

---

### Phase 3 Implementation Checklist (Future)

- [ ] 1. Confirm ledger migration deployed and `budget_transactions` table exists
- [ ] 2. Implement ledger resolution function (or RPC if using PostgreSQL)
- [ ] 3. Update `build_budget_alignment_context()` to call ledger instead of `plan_budgets`
- [ ] 4. Update `get_budget_summary()` to call ledger
- [ ] 5. Rename `budget_exceeded` → `budget_overage_advisory` in `compliance_engine.py`
- [ ] 6. Update `_RULE_DEFAULTS` dict to reflect new outcome types
- [ ] 7. Update `compliance_rules_catalog.py` if it exists
- [ ] 8. Update UI: Compliance Centre "NDIS Plan Budget Advisories" section (labels only, no design change needed)
- [ ] 9. Update frontend `BudgetRuleAlert` type in `coordinatorService.ts` if needed
- [ ] 10. Update test cases: TC-36-02, TC-36-03, add new approval test
- [ ] 11. Re-run full test suite for this ticket — confirm no regression on TC-36-01, TC-36-04–TC-36-09
- [ ] 12. Verify `/dev/progress-test` panel still works with new advisory outcomes (should work unchanged since it just displays rules)

---

## Unblocking Criteria

This ticket can proceed to Phase 3 implementation when:

✅ `budget_transactions` table is deployed  
✅ Ledger resolution function is implemented and tested  
✅ Product confirms the outcome reclassification (fail → advisory)  
✅ Existing tests still pass with ledger data source

---

## Links to Current Implementation

- [funding_service.py:139-185](../../backend/app/services/funding_service.py#L139-L185) — `build_budget_alignment_context()`
- [funding_service.py:466-535](../../backend/app/services/funding_service.py#L466-L535) — `get_budget_summary()`
- [compliance_engine.py:1002-1052](../../backend/app/services/compliance_engine.py#L1002-L1052) — `check_budget_alignment()`
- [sessions.py:412-440](../../backend/app/api/sessions.py#L412-L440) — Session approval flow
- [backend/tests/test_budget_alignment.py](../../backend/tests/test_budget_alignment.py) — Test cases TC-36-01–TC-36-09

---

## Notes for Future Implementation

**Do NOT:**
- Modify demo participant (James Chen) or `/dev/progress-test` panel structure beyond what's needed
- Hard-code ledger resolution — use a clean function call so it can be swapped for another implementation
- Change the API contract for `/api/participants/{id}/budget-summary` — keep same response structure so frontend doesn't need changes

**Do:**
- Make the ledger resolution function a dependency injectable into `funding_service` (for testability)
- Write a test mock for the ledger so budget tests can still run without a full ledger DB
- Document what transaction types the ledger supports (ACTUAL, CREDIT, REVERSAL, etc.)

---

**Blocked by:** Financial State Machine ledger implementation  
**Ticket:** CARECLIQV2-36  
**Related:** CARECLIQV2-35 (duration consistency), CARECLIQV2-78 (draft note approvals)
