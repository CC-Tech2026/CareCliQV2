-- Links bug_reports and improvement_feedback rows to the Jira issue
-- auto-created for them (see backend/app/services/jira_service.py). Nullable
-- — Jira is optional/best-effort, a row with no linked issue just means
-- Jira wasn't configured or the create call failed at submission time.

BEGIN;

ALTER TABLE public.bug_reports
    ADD COLUMN IF NOT EXISTS jira_issue_key TEXT;

ALTER TABLE public.improvement_feedback
    ADD COLUMN IF NOT EXISTS jira_issue_key TEXT;

COMMIT;
