-- A worker can write or speak a shift note in their own language. The note's
-- content stays the English record the provider is audited on; these keep
-- the worker's own words and the language they used, so a reviewer or
-- auditor can check the translation against what was actually written.

ALTER TABLE public.shift_visit_notes
    ADD COLUMN IF NOT EXISTS original_content TEXT,
    ADD COLUMN IF NOT EXISTS original_language TEXT;

COMMENT ON COLUMN public.shift_visit_notes.original_content IS
    'The worker''s own words when the note was written in a language other than English. content holds the English translation.';
COMMENT ON COLUMN public.shift_visit_notes.original_language IS
    'Language code of original_content (for example vi, ne, zh).';
