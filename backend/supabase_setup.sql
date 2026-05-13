-- AI Clinical Companion for NDIS Providers
-- Run this SQL in your Supabase SQL editor (https://supabase.com/dashboard/project/_/sql/new)
-- This script is safe to run multiple times (uses IF NOT EXISTS / DO blocks)

-- Add missing columns to existing 'patients' table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='date_of_birth') THEN
        ALTER TABLE patients ADD COLUMN date_of_birth DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='email') THEN
        ALTER TABLE patients ADD COLUMN email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='phone') THEN
        ALTER TABLE patients ADD COLUMN phone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='address') THEN
        ALTER TABLE patients ADD COLUMN address TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='plan_status') THEN
        ALTER TABLE patients ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'active';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='plan_start_date') THEN
        ALTER TABLE patients ADD COLUMN plan_start_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='plan_end_date') THEN
        ALTER TABLE patients ADD COLUMN plan_end_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='total_budget') THEN
        ALTER TABLE patients ADD COLUMN total_budget NUMERIC(12, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='used_budget') THEN
        ALTER TABLE patients ADD COLUMN used_budget NUMERIC(12, 2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='primary_disability') THEN
        ALTER TABLE patients ADD COLUMN primary_disability TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='goals') THEN
        ALTER TABLE patients ADD COLUMN goals JSONB DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='updated_at') THEN
        ALTER TABLE patients ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Add missing columns to existing 'sessions' table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='transcription') THEN
        ALTER TABLE sessions ADD COLUMN transcription TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='ai_summary') THEN
        ALTER TABLE sessions ADD COLUMN ai_summary TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='ai_insights') THEN
        ALTER TABLE sessions ADD COLUMN ai_insights JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='compliance_score') THEN
        ALTER TABLE sessions ADD COLUMN compliance_score NUMERIC(5, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='compliance_notes') THEN
        ALTER TABLE sessions ADD COLUMN compliance_notes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='tags') THEN
        ALTER TABLE sessions ADD COLUMN tags JSONB DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='goals_addressed') THEN
        ALTER TABLE sessions ADD COLUMN goals_addressed JSONB DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='photo_urls') THEN
        ALTER TABLE sessions ADD COLUMN photo_urls JSONB DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='audio_url') THEN
        ALTER TABLE sessions ADD COLUMN audio_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='status') THEN
        ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='updated_at') THEN
        ALTER TABLE sessions ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Add claim readiness + cost tracking columns to sessions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='compliance_status') THEN
        ALTER TABLE sessions ADD COLUMN compliance_status TEXT DEFAULT 'draft';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='cost') THEN
        ALTER TABLE sessions ADD COLUMN cost NUMERIC(10, 2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='support_category') THEN
        ALTER TABLE sessions ADD COLUMN support_category TEXT;
    END IF;
END $$;

-- Add structured case note fields as separate searchable columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='activities_performed') THEN
        ALTER TABLE sessions ADD COLUMN activities_performed TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='outcomes') THEN
        ALTER TABLE sessions ADD COLUMN outcomes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='participant_response') THEN
        ALTER TABLE sessions ADD COLUMN participant_response TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='progress_toward_goals') THEN
        ALTER TABLE sessions ADD COLUMN progress_toward_goals TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='body_markers') THEN
        ALTER TABLE sessions ADD COLUMN body_markers JSONB DEFAULT '[]';
    END IF;
END $$;

-- ============================================================
-- RESTRICTIVE PRACTICE DETECTION + COMPLIANCE PIPELINE COLUMNS
-- (Sprint 0 — Task #56)
-- Run this section in Supabase SQL editor if it has not been applied yet.
-- All statements are idempotent.
-- ============================================================

-- Add RP detection and compliance tracking columns to sessions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='restrictive_practice_detected') THEN
        ALTER TABLE sessions ADD COLUMN restrictive_practice_detected BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='restrictive_practice_types') THEN
        ALTER TABLE sessions ADD COLUMN restrictive_practice_types JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='compliance_flags') THEN
        ALTER TABLE sessions ADD COLUMN compliance_flags JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='compliance_checked_at') THEN
        ALTER TABLE sessions ADD COLUMN compliance_checked_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='input_language') THEN
        ALTER TABLE sessions ADD COLUMN input_language TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='voice_input') THEN
        ALTER TABLE sessions ADD COLUMN voice_input TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='incident_language_detected') THEN
        ALTER TABLE sessions ADD COLUMN incident_language_detected BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Per-session compliance rule results table (upsert target: session_id + rule_id)
CREATE TABLE IF NOT EXISTS public.compliance_rule_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    rule_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    severity TEXT,
    checked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_id, rule_id)
);

-- Restrictive practice flags table (upsert target: session_id + phrase)
CREATE TABLE IF NOT EXISTS public.restrictive_practice_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    phrase TEXT NOT NULL,
    context TEXT,
    severity TEXT,
    suggestion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_id, phrase)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_compliance_rule_results_session_id ON compliance_rule_results(session_id);
CREATE INDEX IF NOT EXISTS idx_rp_flags_session_id ON restrictive_practice_flags(session_id);

-- Enable RLS
ALTER TABLE compliance_rule_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE restrictive_practice_flags ENABLE ROW LEVEL SECURITY;

-- Service role policies
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'compliance_rule_results' AND policyname = 'service_role_all_compliance_rule_results') THEN
        CREATE POLICY "service_role_all_compliance_rule_results" ON compliance_rule_results FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'restrictive_practice_flags' AND policyname = 'service_role_all_rp_flags') THEN
        CREATE POLICY "service_role_all_rp_flags" ON restrictive_practice_flags FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Add ndis_plan_id and biological_sex to patients
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='ndis_plan_id') THEN
        ALTER TABLE patients ADD COLUMN ndis_plan_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='biological_sex') THEN
        ALTER TABLE patients ADD COLUMN biological_sex TEXT DEFAULT 'unspecified';
    END IF;
END $$;

-- Create ALERTS table (new table)
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create AUDIT LOGS table (new table)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_date ON sessions(session_date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_alerts_patient_id ON alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patients_plan_status ON patients(plan_status);

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger if not already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_patients_updated_at') THEN
        CREATE TRIGGER update_patients_updated_at
            BEFORE UPDATE ON patients
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_sessions_updated_at') THEN
        CREATE TRIGGER update_sessions_updated_at
            BEFORE UPDATE ON sessions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role policies for new tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'service_role_all_alerts') THEN
        CREATE POLICY "service_role_all_alerts" ON alerts FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'service_role_all_audit_logs') THEN
        CREATE POLICY "service_role_all_audit_logs" ON audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'anon_read_alerts') THEN
        CREATE POLICY "anon_read_alerts" ON alerts FOR SELECT TO anon USING (true);
    END IF;
END $$;

-- Update existing seed data to add missing fields
UPDATE patients SET
    plan_status = 'active',
    total_budget = 45000.00,
    used_budget = 18200.00,
    primary_disability = 'Physical Disability',
    goals = '[{"id":"legacy_a1b2c3d4","title":"Improve mobility","status":"active"},{"id":"legacy_b2c3d4e5","title":"Reduce pain","status":"active"},{"id":"legacy_c3d4e5f6","title":"Increase independence","status":"active"}]',
    plan_start_date = '2024-07-01',
    plan_end_date = '2025-06-30'
WHERE ndis_number = '430012345' AND plan_status IS NULL;

-- ============================================================
-- NDIS FUNDING TRACKER TABLES
-- ============================================================

-- NDIS Plans table
CREATE TABLE IF NOT EXISTS public.ndis_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    plan_number TEXT,
    plan_start DATE NOT NULL,
    plan_end DATE NOT NULL,
    total_funding NUMERIC(12, 2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Budget allocation by support category
CREATE TABLE IF NOT EXISTS public.plan_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.ndis_plans(id) ON DELETE CASCADE,
    category TEXT NOT NULL,   -- 'core', 'capacity_building', 'capital'
    allocated_amount NUMERIC(12, 2) DEFAULT 0,
    used_amount NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (plan_id, category)
);

-- Individual session cost records
CREATE TABLE IF NOT EXISTS public.budget_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.ndis_plans(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    hourly_rate NUMERIC(10, 2) DEFAULT 0,
    duration_minutes INT DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- NDIS support item catalog (simplified price guide)
CREATE TABLE IF NOT EXISTS public.support_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code TEXT UNIQUE,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT DEFAULT 'hour',     -- 'hour', 'each', 'km'
    default_rate NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- COMPLIANCE AUDIT LOG
CREATE TABLE IF NOT EXISTS public.compliance_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    compliance_score NUMERIC(5, 2) DEFAULT 0,
    rules_checked INT DEFAULT 0,
    rules_passed INT DEFAULT 0,
    rules_warnings INT DEFAULT 0,
    rules_failed INT DEFAULT 0,
    failed_rules JSONB DEFAULT '[]',
    all_rules JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_ndis_plans_patient_id ON ndis_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_ndis_plans_status ON ndis_plans(status);
CREATE INDEX IF NOT EXISTS idx_plan_budgets_plan_id ON plan_budgets(plan_id);
CREATE INDEX IF NOT EXISTS idx_budget_usage_plan_id ON budget_usage(plan_id);
CREATE INDEX IF NOT EXISTS idx_budget_usage_session_id ON budget_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_compliance_audit_session_id ON compliance_audit_logs(session_id);

-- Auto-update trigger for ndis_plans
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_ndis_plans_updated_at') THEN
        CREATE TRIGGER update_ndis_plans_updated_at
            BEFORE UPDATE ON ndis_plans
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Enable RLS
ALTER TABLE ndis_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role policies
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ndis_plans' AND policyname = 'service_role_all_ndis_plans') THEN
        CREATE POLICY "service_role_all_ndis_plans" ON ndis_plans FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plan_budgets' AND policyname = 'service_role_all_plan_budgets') THEN
        CREATE POLICY "service_role_all_plan_budgets" ON plan_budgets FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budget_usage' AND policyname = 'service_role_all_budget_usage') THEN
        CREATE POLICY "service_role_all_budget_usage" ON budget_usage FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_items' AND policyname = 'service_role_all_support_items') THEN
        CREATE POLICY "service_role_all_support_items" ON support_items FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'compliance_audit_logs' AND policyname = 'service_role_all_compliance_audit_logs') THEN
        CREATE POLICY "service_role_all_compliance_audit_logs" ON compliance_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Seed support items (simplified NDIS price guide)
INSERT INTO support_items (item_code, item_name, category, unit, default_rate) VALUES
    ('01_002_0107_1_1', 'Daily Activities - Support Worker', 'core', 'hour', 67.56),
    ('01_011_0107_1_1', 'Personal Care - Support Worker', 'core', 'hour', 67.56),
    ('04_049_0125_6_1', 'Assistance with Social, Economic & Community Participation', 'core', 'hour', 67.56),
    ('07_002_0106_1', 'Assessment, Recommendation, Therapy - OT', 'capacity_building', 'hour', 193.99),
    ('07_001_0128_1_3', 'Physiotherapy', 'capacity_building', 'hour', 193.99),
    ('07_003_0128_1_3', 'Speech Pathology', 'capacity_building', 'hour', 193.99),
    ('07_004_0128_1_3', 'Psychology', 'capacity_building', 'hour', 234.83),
    ('10_001_0102_5_3', 'Plan Management - Administration', 'capacity_building', 'hour', 104.45),
    ('07_100_0106_1', 'Support Coordination', 'capacity_building', 'hour', 100.14)
ON CONFLICT (item_code) DO NOTHING;

-- Update existing sessions to add status
UPDATE sessions SET status = 'completed' WHERE status IS NULL;

-- Insert seed participants if none exist beyond the initial one
INSERT INTO patients (full_name, ndis_number, date_of_birth, email, phone, plan_status, plan_start_date, plan_end_date, total_budget, used_budget, primary_disability, goals)
VALUES 
    ('Sarah Mitchell', 'NDIS43821094', '1988-03-15', 'sarah.m@email.com', '0412 345 678', 'active', '2024-07-01', '2025-06-30', 45000.00, 18200.00, 'Autism Spectrum Disorder', '[{"id":"legacy_d4e5f6a7","title":"Improve social communication","status":"active"},{"id":"legacy_e5f6a7b8","title":"Develop independent living skills","status":"active"},{"id":"legacy_f6a7b8c9","title":"Increase community participation","status":"active"}]'),
    ('James Chen', 'NDIS71204856', '1995-08-22', 'james.c@email.com', '0423 456 789', 'active', '2024-09-01', '2025-08-31', 38000.00, 12400.00, 'Cerebral Palsy', '[{"id":"legacy_a7b8c9d0","title":"Enhance mobility and coordination","status":"active"},{"id":"legacy_b8c9d0e1","title":"Improve speech clarity","status":"active"},{"id":"legacy_c9d0e1f2","title":"Gain employment skills","status":"active"}]'),
    ('Emma Thompson', 'NDIS29384756', '1979-11-30', 'emma.t@email.com', '0434 567 890', 'review', '2023-12-01', '2024-11-30', 52000.00, 47800.00, 'Acquired Brain Injury', '[{"id":"legacy_d0e1f2a3","title":"Cognitive rehabilitation","status":"active"},{"id":"legacy_e1f2a3b4","title":"Return to community activities","status":"active"},{"id":"legacy_f2a3b4c5","title":"Memory strategies","status":"active"}]')
ON CONFLICT (ndis_number) DO NOTHING;

-- Insert seed alerts
INSERT INTO alerts (patient_id, alert_type, severity, title, message, is_read)
SELECT 
    p.id,
    'plan_expiry',
    'high',
    'NDIS Plan Expiring Soon',
    'Emma Thompson''s NDIS plan expires within 30 days. Review and renewal required.',
    false
FROM patients p WHERE p.ndis_number = 'NDIS29384756'
ON CONFLICT DO NOTHING;

INSERT INTO alerts (patient_id, alert_type, severity, title, message, is_read)
SELECT 
    p.id,
    'budget',
    'medium',
    'Budget Utilisation Alert',
    'Emma Thompson has used 92% of their annual NDIS budget with 30 days remaining.',
    false
FROM patients p WHERE p.ndis_number = 'NDIS29384756'
ON CONFLICT DO NOTHING;

-- ============================================================
-- MIGRATE patients.goals TO NDISGoal FORMAT
-- Runs last so it covers all seed and update data written above.
-- Converts legacy {text, progress} objects and plain string goals
-- to the canonical NDISGoal format: {id, title, status}.
-- Already-migrated goals (with id/title/status) pass through unchanged.
-- Safe to run multiple times (idempotent).
-- ============================================================
UPDATE patients
SET goals = (
    SELECT COALESCE(
        jsonb_agg(migrated) FILTER (WHERE migrated IS NOT NULL),
        '[]'::jsonb
    )
    FROM (
        SELECT
            CASE
                -- Already in NDISGoal format: has id, title and status
                WHEN jsonb_typeof(elem) = 'object'
                     AND (elem->>'id') IS NOT NULL
                     AND (elem->>'title') IS NOT NULL
                     AND (elem->>'status') IS NOT NULL
                    THEN elem
                -- Legacy {text, progress} format
                WHEN jsonb_typeof(elem) = 'object'
                     AND (elem->>'text') IS NOT NULL
                     AND trim(elem->>'text') != ''
                    THEN jsonb_build_object(
                        'id',     'legacy_' || left(md5(trim(elem->>'text')), 8),
                        'title',  trim(elem->>'text'),
                        'status', 'active'
                    )
                -- Plain string element
                WHEN jsonb_typeof(elem) = 'string'
                     AND trim(elem #>> '{}') != ''
                    THEN jsonb_build_object(
                        'id',     'legacy_' || left(md5(trim(elem #>> '{}')), 8),
                        'title',  trim(elem #>> '{}'),
                        'status', 'active'
                    )
                ELSE NULL
            END AS migrated
        FROM jsonb_array_elements(
            CASE
                -- Stored as a proper JSONB array (ideal case)
                WHEN jsonb_typeof(goals) = 'array' THEN goals
                -- Stored as a JSONB string containing an encoded JSON array
                -- (produced when the Supabase client received json.dumps() output).
                -- Regex pre-check prevents a cast error on non-JSON scalar strings.
                WHEN jsonb_typeof(goals) = 'string'
                     AND (goals #>> '{}') ~ '^\s*\[.*\]\s*$'
                     AND jsonb_typeof((goals #>> '{}')::jsonb) = 'array'
                    THEN (goals #>> '{}')::jsonb
                ELSE '[]'::jsonb
            END
        ) AS elem
    ) sub
)
WHERE goals IS NOT NULL;
