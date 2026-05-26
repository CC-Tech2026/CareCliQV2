-- ============================================================
-- CareScribe multilingual legal-record alignment + attachments
-- ============================================================

ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS organization_id uuid,
ADD COLUMN IF NOT EXISTS assigned_worker_id uuid,
ADD COLUMN IF NOT EXISTS support_worker_id uuid,
ADD COLUMN IF NOT EXISTS allied_health_id uuid,
ADD COLUMN IF NOT EXISTS clinician_id uuid,
ADD COLUMN IF NOT EXISTS created_by uuid,
ADD COLUMN IF NOT EXISTS owner_user_id uuid;

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS original_language_input text,
ADD COLUMN IF NOT EXISTS detected_language text,
ADD COLUMN IF NOT EXISTS translated_english_note text,
ADD COLUMN IF NOT EXISTS translation_metadata jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS translation_status text DEFAULT 'not_required',
ADD COLUMN IF NOT EXISTS compliance_input_text text,
ADD COLUMN IF NOT EXISTS legal_record_version integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS translation_provider text,
ADD COLUMN IF NOT EXISTS translation_confidence numeric(5,4),
ADD COLUMN IF NOT EXISTS translation_error text,
ADD COLUMN IF NOT EXISTS translation_completed_at timestamptz,
ADD COLUMN IF NOT EXISTS organization_id uuid,
ADD COLUMN IF NOT EXISTS worker_id uuid,
ADD COLUMN IF NOT EXISTS support_worker_id uuid,
ADD COLUMN IF NOT EXISTS practitioner_id uuid,
ADD COLUMN IF NOT EXISTS allied_health_id uuid,
ADD COLUMN IF NOT EXISTS clinician_id uuid,
ADD COLUMN IF NOT EXISTS created_by uuid,
ADD COLUMN IF NOT EXISTS owner_user_id uuid,
ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sessions_translation_status_check'
          AND conrelid = 'public.sessions'::regclass
    ) THEN
        ALTER TABLE public.sessions
        ADD CONSTRAINT sessions_translation_status_check
        CHECK (
            translation_status IN (
                'not_required',
                'pending',
                'translated',
                'failed',
                'unsupported',
                'manually_confirmed'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sessions_completed_english_record_check'
          AND conrelid = 'public.sessions'::regclass
    ) THEN
        ALTER TABLE public.sessions
        ADD CONSTRAINT sessions_completed_english_record_check
        CHECK (
            status IS DISTINCT FROM 'completed'
            OR (
                translation_status IN ('translated', 'not_required', 'manually_confirmed')
                AND length(trim(coalesce(compliance_input_text, ''))) > 0
            )
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON public.sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON public.sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_detected_language ON public.sessions(detected_language);
CREATE INDEX IF NOT EXISTS idx_sessions_translation_status ON public.sessions(translation_status);
CREATE INDEX IF NOT EXISTS idx_sessions_compliance_checked_at ON public.sessions(compliance_checked_at);
CREATE INDEX IF NOT EXISTS idx_patients_organization_id ON public.patients(organization_id);
CREATE INDEX IF NOT EXISTS idx_patients_assigned_worker_id ON public.patients(assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_patients_support_worker_id ON public.patients(support_worker_id);
CREATE INDEX IF NOT EXISTS idx_patients_allied_health_id ON public.patients(allied_health_id);
CREATE INDEX IF NOT EXISTS idx_patients_clinician_id ON public.patients(clinician_id);
CREATE INDEX IF NOT EXISTS idx_sessions_worker_id ON public.sessions(worker_id);
CREATE INDEX IF NOT EXISTS idx_sessions_support_worker_id ON public.sessions(support_worker_id);
CREATE INDEX IF NOT EXISTS idx_sessions_practitioner_id ON public.sessions(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_allied_health_id ON public.sessions(allied_health_id);
CREATE INDEX IF NOT EXISTS idx_sessions_clinician_id ON public.sessions(clinician_id);

UPDATE public.sessions
SET
    translated_english_note = notes,
    compliance_input_text = notes,
    detected_language = COALESCE(input_language, 'en'),
    translation_status = 'not_required',
    translation_provider = COALESCE(translation_provider, 'none'),
    translation_confidence = COALESCE(translation_confidence, 1.0000),
    translation_metadata = jsonb_build_object(
        'source', 'backfill',
        'migrated_at', now()
    ),
    translation_completed_at = COALESCE(translation_completed_at, now())
WHERE notes IS NOT NULL
  AND translated_english_note IS NULL;

CREATE TABLE IF NOT EXISTS public.session_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    organization_id uuid,
    uploaded_by uuid,
    file_name text NOT NULL,
    file_path text NOT NULL,
    public_url text,
    mime_type text,
    size_bytes bigint,
    attachment_type text DEFAULT 'file',
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_attachments_session_id ON public.session_attachments(session_id);
CREATE INDEX IF NOT EXISTS idx_session_attachments_organization_id ON public.session_attachments(organization_id);
CREATE INDEX IF NOT EXISTS idx_session_attachments_uploaded_by ON public.session_attachments(uploaded_by);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'incidents'
    ) THEN
        ALTER TABLE public.incidents
            ADD COLUMN IF NOT EXISTS organization_id uuid,
            ADD COLUMN IF NOT EXISTS user_id uuid,
            ADD COLUMN IF NOT EXISTS created_by uuid;

        CREATE INDEX IF NOT EXISTS incidents_organization_id_idx
            ON public.incidents(organization_id);
        CREATE INDEX IF NOT EXISTS incidents_user_id_idx
            ON public.incidents(user_id);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cs_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND is_active = true
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cs_is_coordinator()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members
        WHERE user_id = auth.uid()
          AND role = 'support_coordinator'
          AND is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.cs_can_access_patient(target_patient_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.patients p
        WHERE p.id = target_patient_id
          AND p.organization_id IN (SELECT public.cs_user_org_ids())
          AND (
              public.cs_is_coordinator()
              OR (
                  public.cs_user_role() = 'support_worker'
                  AND (
                      p.assigned_worker_id = auth.uid()
                      OR p.support_worker_id = auth.uid()
                  )
              )
              OR (
                  public.cs_user_role() = 'allied_health'
                  AND (
                      p.allied_health_id = auth.uid()
                      OR p.clinician_id = auth.uid()
                  )
              )
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.cs_can_access_session(target_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.sessions s
        LEFT JOIN public.patients p ON p.id = s.patient_id
        WHERE s.id = target_session_id
          AND COALESCE(s.organization_id, p.organization_id) IN (SELECT public.cs_user_org_ids())
          AND (
              public.cs_is_coordinator()
              OR (
                  public.cs_user_role() = 'support_worker'
                  AND (
                      s.worker_id = auth.uid()
                      OR s.support_worker_id = auth.uid()
                      OR p.assigned_worker_id = auth.uid()
                      OR p.support_worker_id = auth.uid()
                  )
              )
              OR (
                  public.cs_user_role() = 'allied_health'
                  AND (
                      s.practitioner_id = auth.uid()
                      OR s.allied_health_id = auth.uid()
                      OR s.clinician_id = auth.uid()
                      OR p.allied_health_id = auth.uid()
                      OR p.clinician_id = auth.uid()
                  )
              )
          )
    );
$$;

ALTER TABLE public.session_attachments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    constraint_name text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'session_attachments'
          AND policyname = 'session_attachments_service_all'
    ) THEN
        CREATE POLICY session_attachments_service_all
        ON public.session_attachments
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'session_attachments'
          AND policyname = 'session_attachments_org_read'
    ) THEN
        CREATE POLICY session_attachments_org_read
        ON public.session_attachments
        FOR SELECT TO authenticated
        USING (
            public.cs_can_access_session(session_attachments.session_id)
        );
    END IF;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('session-attachments', 'session-attachments', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'session_attachments_storage_service_all'
    ) THEN
        CREATE POLICY session_attachments_storage_service_all
        ON storage.objects
        FOR ALL TO service_role
        USING (bucket_id = 'session-attachments')
        WITH CHECK (bucket_id = 'session-attachments');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.session_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    sender_role text NOT NULL DEFAULT 'worker',
    message_type text NOT NULL DEFAULT 'text',
    content text,
    media_url text,
    translated_content text,
    detected_language text,
    translation_status text DEFAULT 'not_required',
    translation_metadata jsonb DEFAULT '{}'::jsonb,
    attachment_id uuid REFERENCES public.session_attachments(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.session_messages
ADD COLUMN IF NOT EXISTS translated_content text,
ADD COLUMN IF NOT EXISTS detected_language text,
ADD COLUMN IF NOT EXISTS translation_status text DEFAULT 'not_required',
ADD COLUMN IF NOT EXISTS translation_metadata jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS attachment_id uuid REFERENCES public.session_attachments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON public.session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_attachment_id ON public.session_messages(attachment_id);

DO $$
DECLARE
    constraint_name text;
BEGIN
    UPDATE public.users
    SET role = CASE
        WHEN role IN ('admin', 'manager') THEN 'support_coordinator'
        WHEN role = 'auditor' THEN 'support_worker'
        ELSE role
    END
    WHERE role IN ('admin', 'manager', 'auditor');

    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', constraint_name);
    END LOOP;

    ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('support_worker', 'support_coordinator', 'allied_health'));

    UPDATE public.organization_members
    SET role = CASE
        WHEN role IN ('admin', 'manager') THEN 'support_coordinator'
        WHEN role = 'auditor' THEN 'support_worker'
        ELSE role
    END
    WHERE role IN ('admin', 'manager', 'auditor');

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organization_members_role_check'
          AND conrelid = 'public.organization_members'::regclass
    ) THEN
        ALTER TABLE public.organization_members DROP CONSTRAINT organization_members_role_check;
    END IF;

    ALTER TABLE public.organization_members
    ADD CONSTRAINT organization_members_role_check
    CHECK (role IN ('support_worker', 'support_coordinator', 'allied_health'));

    UPDATE public.invitations
    SET role = CASE
        WHEN role IN ('admin', 'manager') THEN 'support_coordinator'
        WHEN role = 'auditor' THEN 'support_worker'
        ELSE role
    END
    WHERE role IN ('admin', 'manager', 'auditor');

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invitations_role_check'
          AND conrelid = 'public.invitations'::regclass
    ) THEN
        ALTER TABLE public.invitations DROP CONSTRAINT invitations_role_check;
    END IF;

    ALTER TABLE public.invitations
    ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('support_worker', 'support_coordinator', 'allied_health'));
END $$;
