-- Severity for a bug report — low/medium/urgent, chosen by the reporter
-- at submission. Maps to Jira's Priority field on the linked ticket
-- (see backend/app/services/jira_service.py): low -> Low,
-- medium -> Medium, urgent -> Highest (this Jira site's actual priority
-- scheme is Highest/High/Medium/Low/Lowest — confirmed via
-- GET /rest/api/3/priority rather than assumed).

BEGIN;

ALTER TABLE public.bug_reports
    ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low', 'medium', 'urgent'));

CREATE INDEX IF NOT EXISTS idx_bug_reports_severity
    ON public.bug_reports (severity, created_at DESC);

COMMIT;
