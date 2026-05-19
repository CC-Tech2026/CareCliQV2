-- check RLS coverage
SELECT tablename
FROM pg_tables
WHERE schemaname='public'
AND rowsecurity = true;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

SELECT *
FROM pg_policies
WHERE schemaname = 'public';

SELECT table_name
FROM information_schema.columns
WHERE column_name = 'organization_id';