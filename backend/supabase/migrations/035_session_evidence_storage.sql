-- CARECLIQV2-230: dedicated storage bucket for task evidence media (photos, voice)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'session-evidence',
    'session-evidence',
    false,
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'session_evidence_storage_service_all'
    ) THEN
        CREATE POLICY session_evidence_storage_service_all
        ON storage.objects
        FOR ALL TO service_role
        USING (bucket_id = 'session-evidence')
        WITH CHECK (bucket_id = 'session-evidence');
    END IF;
END $$;
