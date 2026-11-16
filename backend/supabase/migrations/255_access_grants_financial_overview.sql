-- Delegated access: a director can give a coordinator temporary access to
-- the organisation's finances (the Financial page with revenue, costs, wages,
-- net profit and runway, and the revenue report on Invoices). Adds
-- 'financial_overview' to the capability catalog CHECK from 199.
--
-- Idempotent: drops and re-adds the constraint with the full list, so running
-- it again (by hand in the SQL editor, then by auto-migrate) is harmless.
BEGIN;

ALTER TABLE public.access_grants
    DROP CONSTRAINT IF EXISTS access_grants_capability_check;

ALTER TABLE public.access_grants
    ADD CONSTRAINT access_grants_capability_check CHECK (capability IN (
        'governance_vault',
        'onboarding_program_design',
        'executive_dashboard',
        'delete_staff_account',
        'reassign_coordinator',
        'lock_training_module',
        'hire_paperwork',
        'applicant_offer_reject',
        'staff_invitations',
        'org_branding',
        'platform_billing',
        'financial_overview'
    ));

COMMIT;
