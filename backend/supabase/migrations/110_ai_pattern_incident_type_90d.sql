-- Incident Management spec — deterministic 90-day rolling-window pattern detection.
-- Adds a 4th pattern_type to the existing ai_detected_patterns table/dismiss workflow
-- (030_ai_detected_patterns.sql) rather than building a separate mechanism: "3+ incidents
-- of the SAME type for one participant within a rolling 90-day window". This is distinct
-- from the existing 'incident_escalation' type (type-agnostic 30d-vs-prior-30d frequency
-- spike) and from the AI semantic similarity matching in incident_pattern_service.py
-- (per-incident, cross-participant, not a standing alert).

BEGIN;

ALTER TABLE public.ai_detected_patterns DROP CONSTRAINT IF EXISTS ai_detected_patterns_pattern_type_check;

ALTER TABLE public.ai_detected_patterns
    ADD CONSTRAINT ai_detected_patterns_pattern_type_check
    CHECK (pattern_type IN (
        'low_compliance_pair',
        'incident_escalation',
        'refused_activity_no_deescalation',
        'incident_type_pattern_90d'
    ));

COMMIT;
