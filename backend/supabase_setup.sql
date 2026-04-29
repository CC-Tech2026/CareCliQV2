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
    goals = '["Improve mobility", "Reduce pain", "Increase independence"]',
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
    ('Sarah Mitchell', 'NDIS43821094', '1988-03-15', 'sarah.m@email.com', '0412 345 678', 'active', '2024-07-01', '2025-06-30', 45000.00, 18200.00, 'Autism Spectrum Disorder', '["Improve social communication", "Develop independent living skills", "Increase community participation"]'),
    ('James Chen', 'NDIS71204856', '1995-08-22', 'james.c@email.com', '0423 456 789', 'active', '2024-09-01', '2025-08-31', 38000.00, 12400.00, 'Cerebral Palsy', '["Enhance mobility and coordination", "Improve speech clarity", "Gain employment skills"]'),
    ('Emma Thompson', 'NDIS29384756', '1979-11-30', 'emma.t@email.com', '0434 567 890', 'review', '2023-12-01', '2024-11-30', 52000.00, 47800.00, 'Acquired Brain Injury', '["Cognitive rehabilitation", "Return to community activities", "Memory strategies"]')
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
