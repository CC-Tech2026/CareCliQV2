-- 024_enforcement_tier.sql
-- Introduces three-tier severity for compliance rule failures.
--
-- enforcement_tier values:
--   block — save and approve buttons disabled until fixed
--   warn  — worker must acknowledge before save is allowed
--   info  — displayed in the panel, no friction on saving
--
-- The existing is_blocking column is preserved for backward compatibility.
-- enforcement_tier takes precedence in all new code paths.

-- ── compliance_rules ─────────────────────────────────────────────────────────

ALTER TABLE public.compliance_rules
  ADD COLUMN IF NOT EXISTS enforcement_tier text NOT NULL DEFAULT 'block'
  CHECK (enforcement_tier IN ('block', 'warn', 'info'));

UPDATE public.compliance_rules SET enforcement_tier = 'block' WHERE rule_code IN ('R1', 'R4', 'R8', 'R10');
UPDATE public.compliance_rules SET enforcement_tier = 'warn'  WHERE rule_code IN ('R2', 'R5', 'R7', 'R9');
UPDATE public.compliance_rules SET enforcement_tier = 'info'  WHERE rule_code IN ('R3', 'R6', 'R11', 'R12');

-- ── sessions ─────────────────────────────────────────────────────────────────
-- Store which warn-tier rules the worker explicitly acknowledged so coordinators
-- have a full audit trail of what was bypassed and when.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS acknowledged_warn_rules jsonb;

-- ── compliance_rule_results ──────────────────────────────────────────────────
-- Persist enforcement_tier alongside each per-rule result so coordinator
-- reports can distinguish block vs warn failures without re-joining compliance_rules.

ALTER TABLE public.compliance_rule_results
  ADD COLUMN IF NOT EXISTS enforcement_tier text;
