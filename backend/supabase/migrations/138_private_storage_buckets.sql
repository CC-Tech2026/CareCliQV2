-- Tenant isolation audit (2026-08-21): credential-files, invoice-files, and
-- profile-photos were created with public = true, meaning Supabase served every
-- object in them via an unauthenticated endpoint that bypasses storage.objects RLS
-- entirely — anyone who ever obtained one of these URLs got permanent, unsigned,
-- cross-org access to NDIS screening/credential documents and invoices. The backend
-- now generates short-lived signed URLs on read instead of persisting a public one
-- (see signed_storage_url() in backend/app/services/supabase_client.py); this
-- migration is the other half of that fix — locking the buckets down at the
-- storage layer so an old, already-issued public URL stops working immediately.

UPDATE storage.buckets
SET public = false
WHERE id IN ('credential-files', 'invoice-files', 'profile-photos');
