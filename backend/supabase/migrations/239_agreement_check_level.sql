-- How strictly an organisation holds shifts to the service agreement.
--
--   warn   - verification shows anything outside the agreement, no reason
--            needed (while existing participants' agreements are entered)
--   reason - a reason is needed to bill anything outside it (the default,
--            and how it worked before this setting)
--   strict - also, no shift can be rostered on a day no signed agreement
--            with supports covers
--
-- Set by the managing director in Settings. Safe to re-run.

BEGIN;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS agreement_check_level TEXT NOT NULL DEFAULT 'reason';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_agreement_check_level_valid'
    ) THEN
        ALTER TABLE public.organizations
            ADD CONSTRAINT organizations_agreement_check_level_valid
            CHECK (agreement_check_level IN ('warn', 'reason', 'strict'));
    END IF;
END $$;

COMMENT ON COLUMN public.organizations.agreement_check_level IS
    'warn | reason | strict: how shifts outside the service agreement are handled. See migration 239.';

COMMIT;
