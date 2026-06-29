-- RPC FUNCTION for efficient shift listing with worker/participant names
-- Eliminates N+1 query pattern in GET /coordinator/shifts

BEGIN;

CREATE OR REPLACE FUNCTION public.get_coordinator_shifts_with_details(
    p_organization_id UUID,
    p_start_date TIMESTAMPTZ DEFAULT NULL,
    p_end_date TIMESTAMPTZ DEFAULT NULL,
    p_worker_id UUID DEFAULT NULL,
    p_status_filter TEXT DEFAULT NULL,
    p_limit INT DEFAULT 500,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    worker_id UUID,
    participant_id UUID,
    session_id UUID,
    shift_type TEXT,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    duration_minutes INT,
    status TEXT,
    participant_name TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    worker_name TEXT,
    worker_email TEXT
) AS $$
    SELECT
        s.id,
        s.organization_id,
        s.worker_id,
        s.participant_id,
        s.session_id,
        s.shift_type,
        s.scheduled_start,
        s.scheduled_end,
        s.duration_minutes,
        s.status,
        s.participant_name,
        s.created_at,
        s.updated_at,
        COALESCE(u.full_name, 'Worker') AS worker_name,
        u.email AS worker_email
    FROM public.shifts s
    LEFT JOIN public.users u ON s.worker_id = u.id 
        AND u.organization_id = p_organization_id
    WHERE s.organization_id = p_organization_id
        AND (p_start_date IS NULL OR s.scheduled_start >= p_start_date)
        AND (p_end_date IS NULL OR s.scheduled_start <= p_end_date)
        AND (p_worker_id IS NULL OR s.worker_id = p_worker_id)
        AND (p_status_filter IS NULL OR s.status = p_status_filter)
    ORDER BY s.scheduled_start DESC, s.id DESC
    LIMIT p_limit
    OFFSET p_offset;
$$ LANGUAGE SQL STABLE;

GRANT EXECUTE ON FUNCTION public.get_coordinator_shifts_with_details TO authenticated, service_role;

COMMIT;
