-- task_evidence_metadata's only SELECT policy (org_members_read, 049_evidence_chain_of_custody.sql)
-- lets any org member read any evidence row directly at the database level. The Python API
-- layer already restricts a support worker to their own uploads only
-- (worker.py: GET /worker/sessions/{id}/evidence-metadata filters to uploaded_by == worker_id,
-- and GET /worker/evidence/{id}/download 403s on any evidence not uploaded_by the requester) —
-- the database policy has never backed that up, so a support worker's own Supabase client
-- session could read another worker's evidence metadata directly, bypassing the API's
-- restriction entirely.
--
-- Coordinator and MD access is unaffected: this only adds an extra condition when the
-- requesting role is support_worker, using the same cs_user_role()/cs_user_org_id() helpers
-- already relied on for role-scoped RLS (153_coordinator_live_realtime_rls.sql).

BEGIN;

DROP POLICY IF EXISTS org_members_read ON public.task_evidence_metadata;

CREATE POLICY task_evidence_metadata_org_read
    ON public.task_evidence_metadata FOR SELECT
    USING (
        organization_id = public.cs_user_org_id()
        AND (
            public.cs_user_role() IS DISTINCT FROM 'support_worker'
            OR uploaded_by = auth.uid()
        )
    );

COMMIT;
