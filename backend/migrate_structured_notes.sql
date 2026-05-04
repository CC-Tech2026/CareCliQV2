-- Migration: Add structured case note columns to sessions table
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/sndwllbtmguzduuazahd/sql/new

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS activities_performed TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS outcomes TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS participant_response TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS progress_toward_goals TEXT;

-- Add indexes for efficient search/filtering on these fields
CREATE INDEX IF NOT EXISTS idx_sessions_activities_performed ON sessions USING gin(to_tsvector('english', coalesce(activities_performed, '')));
CREATE INDEX IF NOT EXISTS idx_sessions_outcomes ON sessions USING gin(to_tsvector('english', coalesce(outcomes, '')));

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sessions' 
  AND column_name IN ('activities_performed', 'outcomes', 'participant_response', 'progress_toward_goals');
