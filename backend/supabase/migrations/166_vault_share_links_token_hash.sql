-- vault_share_links.token -> token_hash (phase-2 schema, still unused by any
-- endpoint). The column was set up to hold the raw bearer token; when the
-- external-share-link feature is actually built it must store only a hash
-- (e.g. SHA-256) of the token, the same way otp_code_hash already never
-- stores the raw one-time code, so a database read alone can never yield a
-- usable link. Table is empty and unreferenced by any code, so a plain
-- rename is safe.

BEGIN;

ALTER TABLE public.vault_share_links RENAME COLUMN token TO token_hash;

COMMENT ON COLUMN public.vault_share_links.token_hash IS
    'SHA-256 (or similar) hash of the share token, never the raw token itself. '
    'The raw token is shown to the MD once at creation time and must not be persisted anywhere.';

COMMIT;
