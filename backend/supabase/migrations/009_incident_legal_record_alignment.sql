-- ============================================================
-- CareScribe incident legal-record alignment
-- ============================================================

ALTER TABLE public.incidents
ADD COLUMN IF NOT EXISTS original_language_input text,
ADD COLUMN IF NOT EXISTS detected_language text,
ADD COLUMN IF NOT EXISTS translated_english_report text,
ADD COLUMN IF NOT EXISTS compliance_input_text text,
ADD COLUMN IF NOT EXISTS translation_metadata jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS translation_status text DEFAULT 'not_required',
ADD COLUMN IF NOT EXISTS translation_provider text,
ADD COLUMN IF NOT EXISTS translation_confidence numeric(5,4),
ADD COLUMN IF NOT EXISTS translation_error text,
ADD COLUMN IF NOT EXISTS translation_completed_at timestamptz;

UPDATE public.incidents
SET
    original_language_input = COALESCE(
        original_language_input,
        trim(concat_ws(E'\n\n',
            'Title: ' || COALESCE(title, ''),
            'Description: ' || COALESCE(description, ''),
            CASE WHEN participant_impact IS NOT NULL AND trim(participant_impact) <> ''
                THEN 'Participant impact: ' || participant_impact END,
            CASE WHEN worker_actions IS NOT NULL AND trim(worker_actions) <> ''
                THEN 'Worker actions: ' || worker_actions END,
            CASE WHEN investigation_notes IS NOT NULL AND trim(investigation_notes) <> ''
                THEN 'Investigation notes: ' || investigation_notes END,
            CASE WHEN corrective_actions IS NOT NULL AND trim(corrective_actions) <> ''
                THEN 'Corrective actions: ' || corrective_actions END
        ))
    ),
    translated_english_report = COALESCE(
        translated_english_report,
        trim(concat_ws(E'\n\n',
            'Title: ' || COALESCE(title, ''),
            'Description: ' || COALESCE(description, ''),
            CASE WHEN participant_impact IS NOT NULL AND trim(participant_impact) <> ''
                THEN 'Participant impact: ' || participant_impact END,
            CASE WHEN worker_actions IS NOT NULL AND trim(worker_actions) <> ''
                THEN 'Worker actions: ' || worker_actions END,
            CASE WHEN investigation_notes IS NOT NULL AND trim(investigation_notes) <> ''
                THEN 'Investigation notes: ' || investigation_notes END,
            CASE WHEN corrective_actions IS NOT NULL AND trim(corrective_actions) <> ''
                THEN 'Corrective actions: ' || corrective_actions END
        ))
    ),
    compliance_input_text = COALESCE(
        compliance_input_text,
        trim(concat_ws(E'\n\n',
            'Title: ' || COALESCE(title, ''),
            'Description: ' || COALESCE(description, ''),
            CASE WHEN participant_impact IS NOT NULL AND trim(participant_impact) <> ''
                THEN 'Participant impact: ' || participant_impact END,
            CASE WHEN worker_actions IS NOT NULL AND trim(worker_actions) <> ''
                THEN 'Worker actions: ' || worker_actions END,
            CASE WHEN investigation_notes IS NOT NULL AND trim(investigation_notes) <> ''
                THEN 'Investigation notes: ' || investigation_notes END,
            CASE WHEN corrective_actions IS NOT NULL AND trim(corrective_actions) <> ''
                THEN 'Corrective actions: ' || corrective_actions END
        ))
    ),
    detected_language = COALESCE(detected_language, 'en'),
    translation_status = COALESCE(translation_status, 'not_required'),
    translation_provider = COALESCE(translation_provider, 'none'),
    translation_confidence = COALESCE(translation_confidence, 1.0000),
    translation_metadata = CASE
        WHEN translation_metadata IS NULL OR translation_metadata = '{}'::jsonb
            THEN jsonb_build_object('source', 'incident_backfill', 'migrated_at', now())
        ELSE translation_metadata
    END,
    translation_completed_at = COALESCE(translation_completed_at, now())
WHERE translated_english_report IS NULL
   OR compliance_input_text IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'incidents_translation_status_check'
          AND conrelid = 'public.incidents'::regclass
    ) THEN
        ALTER TABLE public.incidents
        ADD CONSTRAINT incidents_translation_status_check
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
        WHERE conname = 'incidents_english_record_check'
          AND conrelid = 'public.incidents'::regclass
    ) THEN
        ALTER TABLE public.incidents
        ADD CONSTRAINT incidents_english_record_check
        CHECK (
            translation_status NOT IN ('translated', 'not_required', 'manually_confirmed')
            OR length(trim(coalesce(compliance_input_text, ''))) > 0
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incidents_detected_language ON public.incidents(detected_language);
CREATE INDEX IF NOT EXISTS idx_incidents_translation_status ON public.incidents(translation_status);
CREATE INDEX IF NOT EXISTS idx_incidents_translation_completed_at ON public.incidents(translation_completed_at);
