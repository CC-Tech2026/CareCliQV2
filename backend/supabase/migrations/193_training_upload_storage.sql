-- Training covers and learning materials use the private onboarding bucket.
BEGIN;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'onboarding-resources', 'onboarding-resources', false, 52428800,
    ARRAY['application/pdf', 'video/mp4', 'video/quicktime', 'video/webm',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Preserve existing MIME choices and size limits. NULL already permits every MIME type.
UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/webp')
WHERE id = 'onboarding-resources'
  AND allowed_mime_types IS NOT NULL
  AND NOT ('image/webp' = ANY(allowed_mime_types));
COMMIT;
