-- Resume-derived credentials summary: alongside the existing resume_summary/
-- resume_skills extraction, also pull out any credentials the candidate's
-- resume mentions (First Aid, WWCC, NDIS Worker Screening, etc.), normalized
-- against the same fixed credential-type vocabulary the real Credentials
-- system uses (see FIXED_CREDENTIAL_TYPES in backend/app/api/compliance.py).
--
-- This is a self-reported, unverified summary only — it tells a hiring
-- manager what to expect/chase, nothing more. It deliberately does NOT
-- create rows in public.credentials (that table means "a real document was
-- uploaded and reviewed") and does NOT carry over on hire the way
-- resume_skills does. The applicant/worker still has to upload the actual
-- document through the normal credentials flow for it to count.

BEGIN;

ALTER TABLE public.applicants
ADD COLUMN IF NOT EXISTS credentials_claimed JSONB;

COMMIT;
