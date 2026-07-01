-- Invoice PDF storage bucket (used by billing_service.generate_invoice_pdf)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'invoice-files',
    'invoice-files',
    true,
    10485760,
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'invoice_files_storage_service_all'
    ) THEN
        CREATE POLICY invoice_files_storage_service_all
        ON storage.objects
        FOR ALL TO service_role
        USING (bucket_id = 'invoice-files')
        WITH CHECK (bucket_id = 'invoice-files');
    END IF;
END $$;
