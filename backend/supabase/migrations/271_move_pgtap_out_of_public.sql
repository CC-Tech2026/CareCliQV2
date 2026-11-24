-- ============================================================
-- Move the pgTAP test toolkit out of the public schema
-- ============================================================
-- Migration 001 installed pgTAP into public for the early budget-ledger
-- tests (003). That put 1,079 test functions and two views, tap_funky
-- and pg_all_foreign_keys, into the schema Supabase serves over its API.
-- The views list every function and foreign key in the database, and
-- the anon key in the web app could read them: structure, not data, but
-- a map for anyone probing. Migration 270 couldn't close them because
-- Supabase's own admin role owns the extension and its grants.
--
-- The extensions schema isn't served by the API, and it is on the
-- default search_path ("$user", public, extensions), so 003's test
-- functions still find plan(), ok() and the rest.
--
-- Safe to run more than once, and on a database without pgTAP.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pgtap' AND n.nspname = 'public'
    ) THEN
        CREATE SCHEMA IF NOT EXISTS extensions;
        ALTER EXTENSION pgtap SET SCHEMA extensions;
    END IF;
END
$$;
