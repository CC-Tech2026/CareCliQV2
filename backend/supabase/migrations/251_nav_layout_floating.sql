-- Two more menu layouts for the managing director portal:
--   "floating": the menu as its own rounded row under the header (how
--               "topbar" used to look; "topbar" now puts the menu inside the
--               header bar itself);
--   "docked":   the sidebar attached to the left edge, full height, rather
--               than the floating card "sidebar" gives.
-- Widen the CHECK from 134_nav_bottombar_and_color.sql to allow them.
-- Running this again changes nothing.

BEGIN;

ALTER TABLE public.user_accessibility_preferences
    DROP CONSTRAINT IF EXISTS user_accessibility_preferences_nav_layout_check;

ALTER TABLE public.user_accessibility_preferences
    ADD CONSTRAINT user_accessibility_preferences_nav_layout_check
        CHECK (nav_layout IN ('topbar', 'floating', 'sidebar', 'docked', 'bottombar'));

COMMIT;
