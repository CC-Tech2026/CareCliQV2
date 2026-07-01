-- Backfill English legal-record fields for sessions that have notes but no
-- compliance_input_text (e.g. rows created before multilingual alignment or
-- seeds that did not upsert legal-record columns on conflict).

UPDATE public.sessions
SET
    translated_english_note = notes,
    compliance_input_text = notes,
    detected_language = COALESCE(detected_language, input_language, 'en'),
    translation_status = COALESCE(translation_status, 'not_required'),
    translation_provider = COALESCE(translation_provider, 'none'),
    translation_confidence = COALESCE(translation_confidence, 1.0000),
    translation_metadata = COALESCE(
        translation_metadata,
        jsonb_build_object('source', 'backfill', 'migrated_at', now())
    ),
    translation_completed_at = COALESCE(translation_completed_at, now())
WHERE notes IS NOT NULL
  AND length(trim(notes)) > 0
  AND (
      compliance_input_text IS NULL
      OR length(trim(coalesce(compliance_input_text, ''))) = 0
  );
