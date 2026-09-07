-- Version history for governance/policy documents.
--
-- Updating a policy shouldn't silently overwrite what it used to say - an
-- NDIS auditor can reasonably ask "what did your risk management policy
-- say before March". Uploading a new version now marks the old row as
-- superseded (mirroring medication_documents.superseded_by_document_id /
-- superseded_at, the same pattern already used elsewhere in this schema)
-- instead of deleting or silently replacing it. The vault's folder list
-- only shows the current (non-superseded) version; prior versions stay
-- reachable through the version-history endpoint.

BEGIN;

ALTER TABLE public.governance_documents
    ADD COLUMN IF NOT EXISTS superseded_by_document_id UUID
        REFERENCES public.governance_documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_governance_documents_superseded_by
    ON public.governance_documents (superseded_by_document_id);

COMMIT;
