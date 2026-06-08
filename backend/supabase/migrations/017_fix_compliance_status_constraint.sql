-- Migration 017: Fix sessions_compliance_status_check constraint
--
-- The existing constraint was created without 'non_compliant' in its allowed
-- value list, causing save-with-ai to fail whenever the compliance engine
-- assigns a non-compliant result.  Drop and recreate it with the full set of
-- valid values used by the compliance engine.

ALTER TABLE sessions
    DROP CONSTRAINT IF EXISTS sessions_compliance_status_check;

ALTER TABLE sessions
    ADD CONSTRAINT sessions_compliance_status_check
    CHECK (compliance_status IN ('draft', 'pending', 'compliant', 'at_risk', 'non_compliant'));
