-- Worker-Participant Matching Enhancement, Phase 2 (Ranking).
--
-- A coordinator can name a tag_categories row anything ("Interests",
-- "Hobbies", "Things they enjoy" ...) - the scoring service (Section 5 of
-- the design spec) needs to know which category actually FUNCTIONS as
-- "interests" vs "lived experience" for scoring purposes, and matching on
-- the free-text `name` would be fragile (breaks on rename, translation, or
-- a differently-worded category). matching_role is an explicit, coordinator-
-- chosen classification instead - NULL means "descriptive only, does not
-- feed the ranking score" (the default for any category, so existing
-- Phase 1 categories are unaffected until a coordinator opts one in).

ALTER TABLE public.tag_categories
    ADD COLUMN IF NOT EXISTS matching_role text
    CHECK (matching_role IN ('interests', 'lived_experience') OR matching_role IS NULL);
