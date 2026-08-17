-- Nav layout preference (topbar vs sidebar) for HubLayout, currently only
-- offered to managing directors in Settings > Branding. Stored alongside the
-- other per-device accessibility/display preferences rather than a new
-- table, since it's the same kind of thing (a personal display choice).

BEGIN;

ALTER TABLE public.user_accessibility_preferences
    ADD COLUMN IF NOT EXISTS nav_layout TEXT DEFAULT 'topbar'
        CHECK (nav_layout IN ('topbar', 'sidebar'));

COMMIT;
