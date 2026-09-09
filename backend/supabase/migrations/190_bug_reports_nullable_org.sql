-- Loosens bug_reports.organization_id to nullable so a Super Admin can file
-- a report as "Internal" (about CareCliQ itself, not on behalf of any
-- provider) from the Master Portal's Report Bug panel
-- (artifacts/frontend/src/components/admin/ReportBugPanel.tsx) — see
-- backend/app/api/admin.py's POST /admin/bug-reports and
-- bug_report_service.create_bug_report for how a null organization_id is
-- handled end-to-end. Every staff-submitted report (via POST /bug-reports,
-- always scoped to the reporter's own org) still always carries a real
-- organization_id — only the admin-only creation path can ever leave it null.

BEGIN;

ALTER TABLE public.bug_reports
    ALTER COLUMN organization_id DROP NOT NULL;

COMMENT ON COLUMN public.bug_reports.organization_id IS
    'Null means an "Internal" report filed by a Super Admin — not on behalf of any provider. Every staff-submitted report always has one.';

COMMIT;
