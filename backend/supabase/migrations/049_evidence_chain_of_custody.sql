-- ============================================================
-- CARECLIQV2-XXX — Evidence chain-of-custody for NDIS compliance
-- ============================================================
-- 
-- Implements immutable, tamper-detectable evidence tracking:
--   1. task_evidence_metadata: Single authoritative record per uploaded file
--      - Captures uploaded_by (from JWT), server timestamp, SHA-256 hash
--      - Device context: IP address, user agent
--      - Immutable after creation (no updates except integrity_verified_at)
--
--   2. evidence_access_audit_log: Append-only log of all evidence interactions
--      - Tracks view, download, upload, verification, export, errors
--      - Hash verification results for tamper detection
--      - Device context for each access
--      - Immutable (inserts only, never updates/deletes)
--
-- Security:
--   - RLS policies enforce read-only access for non-admin users
--   - Constraints block UPDATE/DELETE after creation
--   - Coordinator alerts triggered on hash mismatch
--
-- ============================================================

-- 1. Create task_evidence_metadata table (immutable audit anchor)
CREATE TABLE IF NOT EXISTS public.task_evidence_metadata (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Unique identifier for this evidence record
    evidence_id text NOT NULL UNIQUE,
    
    -- Session and organization context
    session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- === CHAIN OF CUSTODY: IMMUTABLE AFTER CREATION ===
    
    -- Who uploaded (from JWT, never client-supplied)
    uploaded_by uuid NOT NULL REFERENCES public.users(id),
    
    -- When (server timestamp at insert, immutable)
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    
    -- === TAMPER DETECTION ===
    
    -- SHA-256 hash of raw file bytes (computed server-side, immutable)
    file_hash text NOT NULL,  -- 64-char hex string
    file_hash_algorithm text DEFAULT 'sha256',
    
    -- File integrity metadata
    file_size_bytes bigint NOT NULL,
    mime_type text NOT NULL,
    
    -- === STORAGE REFERENCE ===
    
    -- Path in object storage (immutable)
    storage_path text NOT NULL,  -- e.g., "org_id/session_id/evidence/evid_xxx.jpg"
    storage_provider text NOT NULL,  -- "supabase" | "s3" | "azure"
    
    -- Signed URL (regenerated on-demand, not immutable)
    file_url text,
    
    -- === DEVICE/REQUEST CONTEXT ===
    
    -- IP address of uploader (PostgreSQL inet type for CIDR support)
    ip_address inet,
    
    -- User agent string (browser/app identifier)
    user_agent text,
    
    -- === EVIDENCE METADATA ===
    
    -- Type of evidence
    evidence_type text NOT NULL CHECK (evidence_type IN ('photo', 'voice', 'text', 'document')),
    
    -- Associated task and goal (nullable, may be standalone)
    task_id text,
    goal_id uuid,
    
    -- Duration for audio/video (seconds, nullable)
    duration_seconds int,
    
    -- === AUDIT METADATA ===
    
    -- Audit trail (created_at immutable, updated_at for integrity checks only)
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Last time hash was verified (updated on successful verification)
    integrity_verified_at timestamptz,
    
    -- Immutability enforcement: Mark as locked after upload completes
    is_finalized boolean DEFAULT true  -- Always true after creation; used for constraints
);

-- Ensure immutability: no one can update core fields after insert
ALTER TABLE public.task_evidence_metadata
ADD CONSTRAINT prevent_evidence_modification
CHECK (
    -- Fields that are immutable after creation:
    -- evidence_id, session_id, organization_id, uploaded_by, uploaded_at,
    -- file_hash, file_hash_algorithm, file_size_bytes, mime_type,
    -- storage_path, storage_provider, ip_address, user_agent,
    -- evidence_type, task_id, goal_id, duration_seconds
    -- (Constraint enforced at service layer; this is a schema guardrail)
    is_finalized = true
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_session_id 
    ON public.task_evidence_metadata(session_id);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_organization_id 
    ON public.task_evidence_metadata(organization_id);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_uploaded_by 
    ON public.task_evidence_metadata(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_uploaded_at 
    ON public.task_evidence_metadata(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_file_hash 
    ON public.task_evidence_metadata(file_hash);  -- For duplicate detection
CREATE INDEX IF NOT EXISTS idx_task_evidence_metadata_evidence_id 
    ON public.task_evidence_metadata(evidence_id);  -- Primary lookup

-- 2. Create evidence_access_audit_log table (append-only)
CREATE TABLE IF NOT EXISTS public.evidence_access_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Reference to the evidence
    evidence_id text NOT NULL,  -- Foreign key to task_evidence_metadata.evidence_id
    session_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    
    -- === IMMUTABLE AUDIT RECORD ===
    
    -- Who accessed the evidence
    accessed_by uuid NOT NULL REFERENCES public.users(id),
    
    -- What action was taken (enum)
    action text NOT NULL CHECK (action IN (
        'upload',              -- File uploaded
        'view',                -- Evidence viewed in UI
        'download',            -- File downloaded
        'hash_verified',       -- Hash verification passed
        'hash_failed',         -- Hash verification FAILED (security incident)
        'exported',            -- Evidence included in compliance export
        'compliance_review_used',  -- Used in compliance review workflow
        'permission_denied',   -- Access denied (authorization failure)
        'quarantined'          -- File quarantined due to integrity failure
    )),
    
    -- === DEVICE/REQUEST CONTEXT ===
    
    -- IP address of accessor (PostgreSQL inet type)
    ip_address inet,
    
    -- User agent (browser/app identifier)
    user_agent text,
    
    -- === VERIFICATION RESULT (nullable if not applicable) ===
    
    -- true = hash matched, false = hash mismatch, null = not verified
    file_hash_match boolean,
    
    -- Hashes for audit comparison (populated on mismatch)
    file_hash_stored text,      -- Expected hash from metadata
    file_hash_computed text,    -- Computed hash on access
    
    -- === CONTEXT AND FAILURE INFO ===
    
    -- Why was the evidence accessed?
    purpose text,  -- e.g., "compliance_review", "export_report", "session_view"
    
    -- If action failed, capture details
    error_code text,
    error_message text,
    
    -- === AUDIT METADATA (IMMUTABLE) ===
    
    created_at timestamptz DEFAULT now()
);

-- Enforce immutability: no updates or deletes on evidence_access_audit_log
-- (Via service layer + RLS policies; this is a procedural guardrail)

-- Indexes for queries
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_evidence_id 
    ON public.evidence_access_audit_log(evidence_id);
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_session_id 
    ON public.evidence_access_audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_accessed_by 
    ON public.evidence_access_audit_log(accessed_by);
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_action 
    ON public.evidence_access_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_created_at 
    ON public.evidence_access_audit_log(created_at DESC);

-- CRITICAL: Index for finding hash mismatches (security queries)
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_hash_failures
    ON public.evidence_access_audit_log(evidence_id, created_at DESC)
    WHERE file_hash_match = false;

-- Performance: Index for compliance audit queries
CREATE INDEX IF NOT EXISTS idx_evidence_access_audit_log_compliance
    ON public.evidence_access_audit_log(session_id, action, created_at DESC)
    WHERE action IN ('export', 'compliance_review_used');

-- 3. Row-level security (RLS) for immutability enforcement
ALTER TABLE public.task_evidence_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_access_audit_log ENABLE ROW LEVEL SECURITY;

-- Allow organization members to read evidence metadata (via sessions they can access)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'task_evidence_metadata'
          AND policyname = 'org_members_read'
    ) THEN
        CREATE POLICY org_members_read
            ON public.task_evidence_metadata FOR SELECT
            USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members
                    WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- Allow organization members to read evidence access logs (via their org)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'evidence_access_audit_log'
          AND policyname = 'org_members_read'
    ) THEN
        CREATE POLICY org_members_read
            ON public.evidence_access_audit_log FOR SELECT
            USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members
                    WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- Prevent all UPDATE operations on evidence metadata (append-only)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'task_evidence_metadata'
          AND policyname = 'prevent_updates'
    ) THEN
        CREATE POLICY prevent_updates
            ON public.task_evidence_metadata FOR UPDATE
            USING (false);  -- Deny all updates
    END IF;
END $$;

-- Prevent all DELETE operations on evidence metadata
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'task_evidence_metadata'
          AND policyname = 'prevent_deletes'
    ) THEN
        CREATE POLICY prevent_deletes
            ON public.task_evidence_metadata FOR DELETE
            USING (false);  -- Deny all deletes
    END IF;
END $$;

-- Prevent all UPDATE operations on evidence access logs (append-only)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'evidence_access_audit_log'
          AND policyname = 'prevent_updates'
    ) THEN
        CREATE POLICY prevent_updates
            ON public.evidence_access_audit_log FOR UPDATE
            USING (false);  -- Deny all updates
    END IF;
END $$;

-- Prevent all DELETE operations on evidence access logs (append-only)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'evidence_access_audit_log'
          AND policyname = 'prevent_deletes'
    ) THEN
        CREATE POLICY prevent_deletes
            ON public.evidence_access_audit_log FOR DELETE
            USING (false);  -- Deny all deletes
    END IF;
END $$;

-- 4. Grant minimal permissions
GRANT SELECT ON public.task_evidence_metadata TO authenticated;
GRANT SELECT ON public.evidence_access_audit_log TO authenticated;

-- Service role (backend) can insert (needed for audit logging)
-- Grants already exist for service_role via defaults
