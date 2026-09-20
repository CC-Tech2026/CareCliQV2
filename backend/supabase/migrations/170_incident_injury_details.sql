-- Injury-specific fields for the Log Incident form (shown only when incident_type = 'injury').
-- Mirrors the organisation's paper incident report: "Nature of injury or harm" and
-- "Did the participant receive medical attention?".

BEGIN;

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS injury_nature TEXT,
    ADD COLUMN IF NOT EXISTS injury_medical_attention TEXT
        CHECK (injury_medical_attention IN ('ambulance', 'hospital_self_transport', 'gp', 'none'));

COMMENT ON COLUMN public.incidents.injury_nature IS
    'Free-text description of the injury/harm sustained. Only collected when incident_type = injury.';
COMMENT ON COLUMN public.incidents.injury_medical_attention IS
    'Medical attention received: ambulance (000), hospital_self_transport, gp, or none. Only collected when incident_type = injury.';

COMMIT;
