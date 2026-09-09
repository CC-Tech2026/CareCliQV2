-- Lets a bug report carry up to a few photos/videos of what the reporter
-- saw, on top of the text description. Stored via the same pluggable
-- object storage already used for shift evidence (object_storage.py) — no
-- new bucket/provider config needed. Array of {storage_path, mime_type,
-- file_size_bytes}; storage_path (not a URL) is kept here so a fresh
-- signed URL can be generated whenever the Master Portal reads this row,
-- rather than storing a URL that expires after a few days.

BEGIN;

ALTER TABLE public.bug_reports
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
