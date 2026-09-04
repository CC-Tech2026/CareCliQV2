-- Organisation branding for the onboarding touchpoints (offer/invite emails,
-- first-login welcome screen). A new hire applied to the provider, not to
-- CareCliQ — everything they see before their first login should read as
-- coming from the employer. Scoped deliberately to those three places only;
-- the rest of the product keeps CareCliQ's own design system.

BEGIN;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS brand_accent_color TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'organization-branding',
    'organization-branding',
    true,
    5242880,
    ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
