-- Resume-derived profile: when a resume is uploaded to the Applicants Board,
-- AI extracts a short bio/summary, skills, and years of experience so the
-- profile can be reused for rostering/participant matching later, not just
-- read once during onboarding. Applicants carry the extracted draft; on
-- hire (invite acceptance) it's copied onto the worker's own profile
-- columns and into worker_skills (unverified — is_certified = false until
-- a coordinator confirms them), same as the existing document handoff.

BEGIN;

ALTER TABLE public.applicants
ADD COLUMN IF NOT EXISTS resume_summary TEXT,
ADD COLUMN IF NOT EXISTS resume_skills TEXT[],
ADD COLUMN IF NOT EXISTS resume_experience_years TEXT,
ADD COLUMN IF NOT EXISTS resume_extracted_at TIMESTAMPTZ;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS profile_summary TEXT,
ADD COLUMN IF NOT EXISTS profile_experience_years TEXT;

COMMIT;
