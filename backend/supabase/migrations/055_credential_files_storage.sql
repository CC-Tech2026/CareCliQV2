-- CARECLIQV2: storage bucket for worker credential document uploads

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'credential-files',
    'credential-files',
    true,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'credential_files_storage_service_all'
    ) THEN
        CREATE POLICY credential_files_storage_service_all
        ON storage.objects
        FOR ALL TO service_role
        USING (bucket_id = 'credential-files')
        WITH CHECK (bucket_id = 'credential-files');
    END IF;
END $$;
