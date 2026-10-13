-- Vault document sizes: the true byte size of every document in the
-- Documents & Audit Vault, so folders can show "48 files · 2.4 MB" like a
-- file manager.
--
-- Most vault documents (session notes, incident reports, NDIS plans,
-- service agreements) are rendered to PDF on download rather than stored,
-- so they have no size until rendered. vault_size_service renders each one
-- once in the background, records its size here with a fingerprint of the
-- record, and re-measures only when the record changes. Uploaded files are
-- measured the same way, once.
--
-- Service-role only: the API reads and writes it on the MD's behalf.
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vault_document_sizes (
    organization_id uuid        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    category        text        NOT NULL,
    document_id     text        NOT NULL,
    fingerprint     text        NOT NULL,
    size_bytes      bigint      NOT NULL,
    measured_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, category, document_id)
);

ALTER TABLE public.vault_document_sizes ENABLE ROW LEVEL SECURITY;

COMMIT;
