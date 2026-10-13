-- Participant report files.
--
-- Generating a participant report (therapy progress, functional capacity and
-- the other report types) uploads the PDF to a "report-files" bucket that no
-- migration ever created, so generation failed with "Report PDF storage is
-- not configured" and no report was ever kept. This creates the bucket as
-- private: reports are participant health information, so they're served
-- only through the API to a signed-in user (the Vault's Participant Reports
-- folder, or GET /api/reports/history/{id}/file), never by a public link.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('report-files', 'report-files', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false;

COMMIT;
