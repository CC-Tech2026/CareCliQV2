-- Audit logs are append-only — enforced by the database, not just the app.
--
-- audit_service.py never updates or deletes audit_logs rows, and
-- evidence_access_audit_log has RLS policies that deny UPDATE/DELETE. But
-- the backend connects as the service role, which bypasses RLS, and
-- audit_logs had no protection at all — so "the logs can't be altered"
-- was a convention, not a guarantee an auditor could rely on.
--
-- These triggers reject UPDATE, DELETE and TRUNCATE for every role,
-- including service_role (triggers are not bypassed the way RLS is). Only
-- a table owner deliberately running ALTER TABLE ... DISABLE TRIGGER could
-- change a row, and that is itself a visible DDL action. Same approach as
-- budget_transactions_prevent_modify (001_create_budget_transactions_ledger).
--
-- Safe to apply: no foreign key cascades (ON DELETE CASCADE / SET NULL)
-- point at either table, and application code only INSERTs and SELECTs.
-- The one historical UPDATE (018_ccq_org_isolation's organisation backfill)
-- runs before this migration by filename order.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_log_prevent_modify()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '%: % not allowed. Audit records are append-only.', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER audit_logs_immutable
    BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_log_prevent_modify();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON public.audit_logs;
CREATE TRIGGER audit_logs_no_truncate
    BEFORE TRUNCATE ON public.audit_logs
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.audit_log_prevent_modify();

DROP TRIGGER IF EXISTS evidence_access_audit_log_immutable ON public.evidence_access_audit_log;
CREATE TRIGGER evidence_access_audit_log_immutable
    BEFORE UPDATE OR DELETE ON public.evidence_access_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_log_prevent_modify();

DROP TRIGGER IF EXISTS evidence_access_audit_log_no_truncate ON public.evidence_access_audit_log;
CREATE TRIGGER evidence_access_audit_log_no_truncate
    BEFORE TRUNCATE ON public.evidence_access_audit_log
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.audit_log_prevent_modify();

COMMENT ON FUNCTION public.audit_log_prevent_modify() IS
    'Rejects UPDATE/DELETE/TRUNCATE on audit tables, including for service_role. See 221_audit_log_immutability.sql.';

COMMIT;
