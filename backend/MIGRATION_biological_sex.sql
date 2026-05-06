-- Migration: Add biological_sex column to patients table
-- Run this once in your Supabase SQL editor:
-- https://supabase.com/dashboard/project/sndwllbtmguzduuazahd/sql/new

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS biological_sex TEXT DEFAULT 'unspecified';

-- Verify:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'patients' AND column_name = 'biological_sex';
