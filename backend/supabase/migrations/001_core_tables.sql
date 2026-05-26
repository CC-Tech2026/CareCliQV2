-- ============================================================
-- CareScribe core tables
-- These base tables must exist before RBAC, multilingual, and seed scripts run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    full_name text DEFAULT '',
    role text NOT NULL DEFAULT 'support_worker'
        CHECK (role IN ('support_coordinator', 'support_worker', 'allied_health')),
    account_type text DEFAULT 'independent_worker',
    onboarding_data jsonb DEFAULT '{}'::jsonb,
    onboarding_complete boolean DEFAULT false,
    organization_id uuid,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login timestamptz
);

CREATE TABLE IF NOT EXISTS public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    organization_name text NOT NULL,
    provider_type text,
    registration_status text,
    team_size text,
    participant_volume text,
    contact_number text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name text NOT NULL,
    ndis_number text UNIQUE,
    date_of_birth date,
    email text,
    phone text,
    address text,
    plan_status text NOT NULL DEFAULT 'active',
    plan_start_date date,
    plan_end_date date,
    total_budget numeric(12,2),
    used_budget numeric(12,2) DEFAULT 0,
    primary_disability text,
    goals jsonb DEFAULT '[]'::jsonb,
    ndis_plan_id uuid,
    biological_sex text DEFAULT 'unspecified',
    organization_id uuid,
    assigned_worker_id uuid,
    support_worker_id uuid,
    allied_health_id uuid,
    clinician_id uuid,
    created_by uuid,
    owner_user_id uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
    session_date timestamptz NOT NULL DEFAULT now(),
    session_type text,
    duration_minutes integer DEFAULT 0,
    notes text,
    transcription text,
    ai_summary text,
    ai_insights jsonb,
    compliance_score numeric(5,2),
    compliance_notes text,
    tags jsonb DEFAULT '[]'::jsonb,
    goals_addressed jsonb DEFAULT '[]'::jsonb,
    photo_urls jsonb DEFAULT '[]'::jsonb,
    audio_url text,
    status text NOT NULL DEFAULT 'draft',
    compliance_status text DEFAULT 'draft',
    cost numeric(10,2) DEFAULT 0,
    support_category text,
    activities_performed text,
    outcomes text,
    participant_response text,
    progress_toward_goals text,
    body_markers jsonb DEFAULT '[]'::jsonb,
    restrictive_practice_detected boolean DEFAULT false,
    restrictive_practice_types jsonb,
    compliance_flags jsonb,
    compliance_checked_at timestamptz,
    input_language text,
    voice_input text,
    incident_language_detected boolean DEFAULT false,
    organization_id uuid,
    worker_id uuid,
    support_worker_id uuid,
    practitioner_id uuid,
    allied_health_id uuid,
    clinician_id uuid,
    created_by uuid,
    owner_user_id uuid,
    user_id uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.incidents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid,
    user_id uuid,
    participant_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
    session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    title text NOT NULL,
    description text NOT NULL,
    incident_type text NOT NULL DEFAULT 'other',
    severity text NOT NULL DEFAULT 'medium',
    status text NOT NULL DEFAULT 'reported',
    incident_date timestamptz NOT NULL DEFAULT now(),
    reported_date timestamptz NOT NULL DEFAULT now(),
    resolved_date timestamptz,
    location text,
    witnesses text,
    ndis_reportable boolean NOT NULL DEFAULT false,
    ndis_reported_at timestamptz,
    practice_standard text,
    participant_impact text,
    worker_actions text,
    investigation_notes text,
    corrective_actions text,
    follow_up_required boolean DEFAULT false,
    follow_up_date date,
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid,
    patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
    alert_type text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    title text NOT NULL,
    message text NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ndis_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid,
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    plan_number text,
    plan_start date NOT NULL,
    plan_end date NOT NULL,
    total_funding numeric(12,2) DEFAULT 0,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plan_budgets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.ndis_plans(id) ON DELETE CASCADE,
    category text NOT NULL,
    allocated_amount numeric(12,2) DEFAULT 0,
    used_amount numeric(12,2) DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE (plan_id, category)
);

CREATE TABLE IF NOT EXISTS public.budget_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.ndis_plans(id) ON DELETE CASCADE,
    session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    category text NOT NULL,
    amount numeric(10,2) NOT NULL DEFAULT 0,
    hourly_rate numeric(10,2) DEFAULT 0,
    duration_minutes integer DEFAULT 0,
    description text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patient_goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid REFERENCES public.ndis_plans(id) ON DELETE CASCADE,
    description text,
    status text DEFAULT 'active',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.session_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    sender_role text NOT NULL DEFAULT 'worker',
    message_type text NOT NULL DEFAULT 'text',
    content text,
    media_url text,
    translated_content text,
    detected_language text,
    translation_status text,
    translation_metadata jsonb DEFAULT '{}'::jsonb,
    attachment_id uuid,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practitioner_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    allocated_role text NOT NULL DEFAULT 'support_worker',
    organization_id uuid,
    assigned_by uuid REFERENCES public.users(id),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT uq_practitioner_allocations_patient_user UNIQUE (patient_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    email text NOT NULL,
    role text NOT NULL DEFAULT 'support_worker'
        CHECK (role IN ('support_coordinator', 'support_worker', 'allied_health')),
    token text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    accepted_by uuid,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid,
    user_id text,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    details jsonb,
    ip_address text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.access_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid,
    user_id uuid,
    resource_type text,
    resource_id uuid,
    action text,
    ip_address text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_role_idx ON public.users(role);
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_patients_organization_id ON public.patients(organization_id);
CREATE INDEX IF NOT EXISTS idx_patients_assigned_worker_id ON public.patients(assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_patients_support_worker_id ON public.patients(support_worker_id);
CREATE INDEX IF NOT EXISTS idx_patients_allied_health_id ON public.patients(allied_health_id);
CREATE INDEX IF NOT EXISTS idx_patients_clinician_id ON public.patients(clinician_id);
CREATE INDEX IF NOT EXISTS idx_patients_plan_status ON public.patients(plan_status);
CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON public.sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON public.sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_date ON public.sessions(session_date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_worker_id ON public.sessions(worker_id);
CREATE INDEX IF NOT EXISTS idx_sessions_support_worker_id ON public.sessions(support_worker_id);
CREATE INDEX IF NOT EXISTS idx_sessions_practitioner_id ON public.sessions(practitioner_id);
CREATE INDEX IF NOT EXISTS incidents_participant_id_idx ON public.incidents(participant_id);
CREATE INDEX IF NOT EXISTS incidents_organization_id_idx ON public.incidents(organization_id);
CREATE INDEX IF NOT EXISTS incidents_user_id_idx ON public.incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_patient_id ON public.alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON public.alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ndis_plans_patient_id ON public.ndis_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_plan_budgets_plan_id ON public.plan_budgets(plan_id);
CREATE INDEX IF NOT EXISTS idx_budget_usage_plan_id ON public.budget_usage(plan_id);
CREATE INDEX IF NOT EXISTS idx_budget_usage_session_id ON public.budget_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_patient_goals_plan_id ON public.patient_goals(plan_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON public.session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_patient_id ON public.practitioner_allocations(patient_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_user_id ON public.practitioner_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_allocations_org_id ON public.practitioner_allocations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_org_id ON public.invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_id ON public.audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_organization_id ON public.access_logs(organization_id);
