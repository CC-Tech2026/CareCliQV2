-- 1. 133_nav_layout_preference.sql's CHECK constraint only allowed
--    ('topbar', 'sidebar') — widen it to include 'bottombar' now that
--    HubLayout supports a third nav mode.
-- 2. Add nav_color: a user-adjustable background color for the nav
--    (topbar/sidebar/bottombar), stored as an exact 6-digit hex code per
--    the Color Consistency Directive (no named colors, no system themes).
--    NULL means "use the default token" — most users won't set this.

BEGIN;

ALTER TABLE public.user_accessibility_preferences
    DROP CONSTRAINT IF EXISTS user_accessibility_preferences_nav_layout_check;

ALTER TABLE public.user_accessibility_preferences
    ADD CONSTRAINT user_accessibility_preferences_nav_layout_check
        CHECK (nav_layout IN ('topbar', 'sidebar', 'bottombar'));

ALTER TABLE public.user_accessibility_preferences
    ADD COLUMN IF NOT EXISTS nav_color TEXT;

ALTER TABLE public.user_accessibility_preferences
    ADD CONSTRAINT user_accessibility_preferences_nav_color_check
        CHECK (nav_color IS NULL OR nav_color ~ '^#[0-9A-Fa-f]{6}$');

COMMIT;
