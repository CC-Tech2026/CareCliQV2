-- Tenant isolation audit (2026-08-21): these tables were created with an
-- organization_id (or an owning FK back to an org-scoped row) but never had RLS
-- enabled anywhere in the migration history — verified by cross-referencing every
-- CREATE TABLE against every ENABLE/FORCE ROW LEVEL SECURITY statement across the
-- full migrations tree. None of them are queried directly by the frontend (direct
-- Supabase-client access is limited to the four tables fixed in
-- 139_fix_realtime_rls_enable.sql), so the correct, lowest-risk fix is the same
-- deny-by-default pattern already used for ~60 other tables in this codebase
-- (e.g. shift_export_requests in 063_worker_performance.sql): enable RLS, add a
-- single service_role-only policy. This blocks all direct anon/authenticated
-- access without needing bespoke org-scoped join policies for tables nothing
-- queries directly — the backend's own access continues unaffected, since it
-- always uses the service_role client, which bypasses RLS regardless of policy
-- content.
--
-- public.users and public.organizations are included here for the same reason:
-- despite being the platform's core identity tables, no policy was ever defined
-- for either of them, making them a full cross-tenant directory leak to any
-- direct PostgREST client bearing the anon key + a valid user JWT.

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'users', 'organizations',
        'account_security_tokens', 'invoice_line_items', 'notification_deliveries',
        'participant_required_skills', 'participant_task_templates', 'participant_tasks',
        'security_events', 'shift_change_acknowledgements', 'shift_messages',
        'shift_reminder_settings', 'shift_tasks', 'shift_view_events', 'shift_visit_notes',
        'task_completions', 'user_login_events', 'user_mfa_recovery_codes',
        'user_notification_preferences', 'user_push_tokens', 'user_sessions',
        'user_trusted_devices', 'worker_availability', 'worker_availability_preferences',
        'worker_blackout_dates', 'worker_calendar_feed_tokens', 'worker_notifications',
        'worker_preferred_shift_request_details', 'worker_schedule_requests',
        'worker_shift_swap_request_details', 'worker_skills', 'worker_time_off_request_details',
        'worker_weekly_availability_slots'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t
                  AND policyname = t || '_service_role_all'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
                    t || '_service_role_all', t
                );
            END IF;
        END IF;
    END LOOP;
END $$;

-- task_instances: 068_task_management_system.sql enabled RLS with policies that
-- reference a table called "participants" — which has never existed in this schema
-- (the real participant table is "patients") — so those policies would error at
-- evaluation time rather than filter anything. 073_task_pricing_evidence_invoicing.sql
-- later dropped and recreated task_instances with a different schema and never
-- re-enabled RLS at all. Handle both possible live states: drop the broken policies
-- by name if they still exist (harmless no-op if they don't), then ensure RLS is on
-- with the same deny-by-default policy as above.
DROP POLICY IF EXISTS task_instances_select ON public.task_instances;
DROP POLICY IF EXISTS task_instances_insert ON public.task_instances;
DROP POLICY IF EXISTS task_instances_update ON public.task_instances;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'task_instances') THEN
        ALTER TABLE public.task_instances ENABLE ROW LEVEL SECURITY;
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'task_instances'
              AND policyname = 'task_instances_service_role_all'
        ) THEN
            CREATE POLICY task_instances_service_role_all ON public.task_instances
            FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
    END IF;
END $$;
