-- Renames the `patients` table to `participants` — the app, API, and every
-- product surface have always called this concept "participant" (NDIS
-- terminology); the table name was the one place still saying "patient".
--
-- Foreign keys, indexes, RLS policies, and triggers referencing this table
-- all follow the rename automatically in Postgres — nothing else needs to
-- change at the database level. Every application-code caller that did
-- .table("patients") or embedded it in a PostgREST relationship select
-- (e.g. "*, patients(full_name)") has been updated in the same change that
-- ships this migration; both must land together.
--
-- Deliberately NOT part of this pass: the `patient_id` foreign-key column
-- used on ~10 other tables (shifts, sessions, incidents, medications, etc.)
-- stays as-is for now — that's a separate, larger, cross-stack change
-- (some of those columns are read directly by frontend code).

BEGIN;

ALTER TABLE public.patients RENAME TO participants;

COMMIT;
