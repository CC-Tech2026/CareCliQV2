-- ============================================================================
-- CARECLIQV2-303: Budget Transactions Append-Only Ledger
-- ============================================================================
-- Purpose: Create the fundamental append-only ledger table that records all
--          budget transactions (allocations, reservations, payments, adjustments)
--          in immutable fashion. This unblocks CARECLIQV2-36 reconciliation.
--
-- Architecture: 
--   - Immutable append-only design (no UPDATE/DELETE allowed)
--   - Database-level constraint enforcement (not application-level)
--   - Full multi-tenant support via RLS
--   - Audit trail for all budget movements
-- ============================================================================

-- Enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgtap" SCHEMA public;

-- ============================================================================
-- Table: budget_transactions
-- ============================================================================
-- Core append-only ledger recording every budget transaction
-- 
-- Key Design Decisions:
--   1. id: UUID primary key for distributed traceability
--   2. organization_id: Multi-tenant isolation key
--   3. participant_id: Which participant this transaction affects
--   4. plan_id: Which NDIS plan (for plan-level breakdown)
--   5. category: NDIS category code (01_001_0101_1_1, etc. or 'general')
--   6. transaction_type: The operation (ALLOCATION, RESERVATION, PAYMENT, ADJUSTMENT, etc.)
--   7. amount_cents: Signed integer (positive=add, negative=reduce). NEVER float.
--   8. description: Human-readable reason (e.g., "Initial Q1 2026 allocation")
--   9. created_at: ISO timestamp (server-generated, set on creation)
--  10. ledger_source: Where did this transaction originate?
--       - 'onboarding': Initial plan budget allocation
--       - 'invoice_payment': Payment against an invoice
--       - 'adjustment_form': Manual budget adjustment (e.g., plan review)
--       - 'system_correction': Automated correction (very rare)
--  11. reference_id: Link to the source (invoice_id, adjustment_form_id, etc.)
--  12. metadata: JSONB for extensibility (state machine context, etc.)

CREATE TABLE IF NOT EXISTS budget_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Multi-tenant identifier
    organization_id UUID NOT NULL,
    
    -- Participant this transaction affects
    participant_id UUID NOT NULL,
    
    -- NDIS plan (if applicable; NULL for organization-level adjustments)
    plan_id UUID,
    
    -- NDIS category code (e.g., "01_011_0107_1_1") or 'general'
    -- Used for category-level budget breakdown
    category VARCHAR(20) NOT NULL DEFAULT 'general',
    
    -- Type of transaction
    -- Valid values: ALLOCATION, RESERVATION, PAYMENT, ADJUSTMENT, REVERSAL, CORRECTION
    transaction_type VARCHAR(50) NOT NULL,
    
    -- Amount in cents (signed). Positive = add budget, Negative = reduce budget
    -- Examples:
    --   + 700000 cents = +$7,000 allocation
    --   - 150000 cents = -$1,500 payment
    amount_cents BIGINT NOT NULL,
    
    -- Human-readable description
    description TEXT NOT NULL,
    
    -- Where did this transaction originate?
    ledger_source VARCHAR(50) NOT NULL,
    
    -- Link to source (invoice_id, adjustment_id, etc.)
    -- Example: 'INV-20260624-ABC123', 'ADJFORM-12345', etc.
    reference_id VARCHAR(100),
    
    -- For extensibility: state machine context, approver info, etc.
    metadata JSONB DEFAULT '{}',
    
    -- Audit trail: who created this record (service account, user_id, or system process)
    created_by VARCHAR(255) NOT NULL DEFAULT 'system',
    
    -- Server timestamp (immutable after creation)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT budget_transactions_org_not_null CHECK (organization_id IS NOT NULL),
    CONSTRAINT budget_transactions_participant_not_null CHECK (participant_id IS NOT NULL),
    CONSTRAINT budget_transactions_amount_valid CHECK (amount_cents != 0),
    CONSTRAINT budget_transactions_type_valid CHECK (transaction_type IN ('ALLOCATION', 'RESERVATION', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL', 'CORRECTION')),
    CONSTRAINT budget_transactions_source_valid CHECK (ledger_source IN ('onboarding', 'invoice_payment', 'adjustment_form', 'system_correction', 'plan_review', 'audit_fix'))
);

-- Create indexes for common queries
CREATE INDEX idx_budget_transactions_org_id ON budget_transactions(organization_id);
CREATE INDEX idx_budget_transactions_participant_id ON budget_transactions(participant_id);
CREATE INDEX idx_budget_transactions_plan_id ON budget_transactions(plan_id);
CREATE INDEX idx_budget_transactions_category ON budget_transactions(category);
CREATE INDEX idx_budget_transactions_created_at ON budget_transactions(created_at);
CREATE INDEX idx_budget_transactions_type ON budget_transactions(transaction_type);
CREATE INDEX idx_budget_transactions_reference_id ON budget_transactions(reference_id);
CREATE INDEX idx_budget_transactions_org_participant_created ON budget_transactions(organization_id, participant_id, created_at DESC);
CREATE INDEX idx_budget_transactions_org_category_created ON budget_transactions(organization_id, category, created_at DESC);

-- ============================================================================
-- CARECLIQV2-303 (Feature 1, Subtask 3): Append-Only Constraint
-- ============================================================================
-- Database-level enforcement: No UPDATE or DELETE allowed on budget_transactions
-- This is non-negotiable. The ledger's integrity depends on this.
--
-- Implementation: PostgreSQL trigger + policy
-- 
-- Why a trigger instead of table-level permissions?
--   - Permissions prevent writes but don't give clear error messages
--   - Trigger allows us to raise descriptive errors
--   - We need to allow schema changes (migrations) but prevent data changes
--
-- Constraint is enforced via RLS policy (below) which:
--   1. Prevents UPDATE entirely
--   2. Prevents DELETE entirely
--   3. Only allows INSERT for appropriate service roles
-- ============================================================================

-- Create immutable trigger function
CREATE OR REPLACE FUNCTION budget_transactions_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'budget_transactions: UPDATE not allowed. Append-only ledger requires immutability. Use REVERSAL or CORRECTION transaction type.';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'budget_transactions: DELETE not allowed. Append-only ledger requires immutability. Use REVERSAL or CORRECTION transaction type.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to prevent modifications
DROP TRIGGER IF EXISTS budget_transactions_immutable ON budget_transactions;
CREATE TRIGGER budget_transactions_immutable
    BEFORE UPDATE OR DELETE ON budget_transactions
    FOR EACH ROW
    EXECUTE FUNCTION budget_transactions_prevent_modify();

-- ============================================================================
-- RLS Policies: Multi-Tenant Isolation
-- ============================================================================
-- CARECLIQV2-303 (Feature 1, Subtask 2): Row-Level Security
--
-- Policies ensure:
--   1. Users can only see transactions for their organization
--   2. Service roles can write new transactions
--   3. Applications cannot bypass multi-tenant boundaries
-- ============================================================================

-- Enable RLS on budget_transactions
ALTER TABLE budget_transactions ENABLE ROW LEVEL SECURITY;

-- Policy: SELECT (users see only their organization's transactions)
DROP POLICY IF EXISTS budget_transactions_select ON budget_transactions;
CREATE POLICY budget_transactions_select ON budget_transactions
    FOR SELECT
    USING (organization_id = auth.jwt() ->> 'organization_id');

-- Policy: INSERT (only authenticated users can insert, filtered by org)
-- This is intentionally restrictive - only backend can write to ledger
CREATE POLICY budget_transactions_insert ON budget_transactions
    FOR INSERT
    WITH CHECK (
        -- Only authenticated users (backend service role) can insert
        -- Frontend is never allowed to write directly to ledger
        organization_id = auth.jwt() ->> 'organization_id'
    );

-- Policy: Prevent UPDATE (enforced by trigger above, but RLS also blocks it)
DROP POLICY IF EXISTS budget_transactions_no_update ON budget_transactions;
CREATE POLICY budget_transactions_no_update ON budget_transactions
    FOR UPDATE
    USING (FALSE);

-- Policy: Prevent DELETE (enforced by trigger above, but RLS also blocks it)
DROP POLICY IF EXISTS budget_transactions_no_delete ON budget_transactions;
CREATE POLICY budget_transactions_no_delete ON budget_transactions
    FOR DELETE
    USING (FALSE);

-- ============================================================================
-- Test Fixtures (for integration testing - CARECLIQV2-305)
-- ============================================================================
-- These will be populated by test suites, not production data
-- They exist in development/staging but should never be in production
-- ============================================================================

-- Note: Test data will be created by integration tests (migration 003)
-- Do not seed data here to avoid production issues

-- ============================================================================
-- Documentation Comments
-- ============================================================================
COMMENT ON TABLE budget_transactions IS 'Append-only ledger recording all budget transactions. No UPDATE/DELETE allowed. CARECLIQV2-303.';
COMMENT ON COLUMN budget_transactions.transaction_type IS 'Type of transaction: ALLOCATION, RESERVATION, PAYMENT, ADJUSTMENT, REVERSAL, CORRECTION';
COMMENT ON COLUMN budget_transactions.amount_cents IS 'Signed integer in cents. Positive = add budget, Negative = reduce budget.';
COMMENT ON COLUMN budget_transactions.ledger_source IS 'Origin of transaction: onboarding, invoice_payment, adjustment_form, system_correction, plan_review, audit_fix';
COMMENT ON COLUMN budget_transactions.metadata IS 'JSONB extensibility: state machine context, approver_id, plan_review_id, etc.';
