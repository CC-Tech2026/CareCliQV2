-- Profile photo storage bucket (used by POST/DELETE /api/users/me/photo)
-- Matches ALLOWED_IMAGE_TYPES / MAX_PROFILE_PHOTO_BYTES in backend/app/api/users.py

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'profile-photos',
    'profile-photos',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'profile_photos_storage_service_all'
    ) THEN
        CREATE POLICY profile_photos_storage_service_all
        ON storage.objects
        FOR ALL TO service_role
        USING (bucket_id = 'profile-photos')
        WITH CHECK (bucket_id = 'profile-photos');
    END IF;
END $$;
