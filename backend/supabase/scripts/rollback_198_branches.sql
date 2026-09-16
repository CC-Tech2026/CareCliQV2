-- ============================================================
-- ROLLBACK for migrations/198_branches.sql
--
-- Contingency only — NOT part of the migration sequence. Run this in the
-- Supabase SQL editor if 198 has been applied and needs to be undone.
--
-- 198 is purely additive (new table, new functions/triggers, one new
-- column on organization_members and patients, backfilled to the org's
-- head office). Nothing that existed before 198 is modified or removed
-- by it, so this script only drops what 198 created. The only data lost
-- is each row's branch assignment — which, until a second branch is
-- created and people are moved into it, is "Head Office" for everyone
-- and therefore reconstructible by re-running 198.
--
-- Order matters:
--   1. triggers first — otherwise the BEFORE INSERT defaulting trigger
--      would keep calling ensure_head_office() after the table is gone
--   2. then the branch_id columns — this also drops their FKs, indexes,
--      NOT NULL, and the column-level quill_agent grant
--   3. then the table — must come after the columns, because the
--      ON DELETE RESTRICT FKs would otherwise block the DROP
--   4. then the functions
--
-- Safe to re-run: everything uses IF EXISTS.
-- ============================================================

BEGIN;

-- 1. Triggers on the tables that reference branches
DROP TRIGGER IF EXISTS trg_organization_members_default_branch ON public.organization_members;
DROP TRIGGER IF EXISTS trg_organization_members_branch_org     ON public.organization_members;
DROP TRIGGER IF EXISTS trg_patients_default_branch             ON public.patients;
DROP TRIGGER IF EXISTS trg_patients_branch_org                 ON public.patients;
DROP TRIGGER IF EXISTS trg_organizations_create_head_office    ON public.organizations;
DROP TRIGGER IF EXISTS trg_branches_sync_timezone              ON public.branches;

-- 2. The branch_id columns (drops FK, index, NOT NULL, column grants)
DROP INDEX IF EXISTS public.idx_organization_members_branch_id;
DROP INDEX IF EXISTS public.idx_patients_branch_id;
ALTER TABLE public.organization_members DROP COLUMN IF EXISTS branch_id;
ALTER TABLE public.patients             DROP COLUMN IF EXISTS branch_id;

-- 3. The table (policies, indexes, and table grants go with it)
DROP TABLE IF EXISTS public.branches;

-- 4. Functions
DROP FUNCTION IF EXISTS public.branch_matches_organization();
DROP FUNCTION IF EXISTS public.default_branch_to_head_office();
DROP FUNCTION IF EXISTS public.organizations_create_head_office();
DROP FUNCTION IF EXISTS public.ensure_head_office(uuid);
DROP FUNCTION IF EXISTS public.branches_sync_timezone();
DROP FUNCTION IF EXISTS public.timezone_for_state(text);

COMMIT;

-- Verify (should all return 0 / false):
--   SELECT count(*) FROM pg_tables   WHERE tablename = 'branches';
--   SELECT count(*) FROM pg_proc     WHERE proname IN ('timezone_for_state','ensure_head_office','branches_sync_timezone','default_branch_to_head_office','branch_matches_organization','organizations_create_head_office');
--   SELECT count(*) FROM information_schema.columns WHERE column_name = 'branch_id' AND table_name IN ('organization_members','patients');
--   SELECT count(*) FROM pg_trigger  WHERE tgname LIKE 'trg_%branch%' OR tgname = 'trg_organizations_create_head_office';
