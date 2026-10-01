-- Vault document register: a permanent, human-readable ID for every document
-- the vault shows, e.g. SUNR-SN-000047 (org abbreviation, type code, number).
--
-- The vault lists records that live in their own tables (sessions, incidents,
-- credentials, ...), so the register stores only the identity: which kind of
-- document, which source row, and the number it was given. The org
-- abbreviation is added when the ID is displayed, so an org that sets its
-- abbreviation later still gets full IDs.
--
-- Numbers are per (organisation, type code), never reused and never changed.
-- A governance document keeps its number across versions: it is registered
-- under the first version's id.
--
-- Safe to re-run (a migration may be applied by hand before the deploy
-- runner records it).

BEGIN;

CREATE TABLE IF NOT EXISTS public.vault_document_counters (
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    type_code        TEXT        NOT NULL CHECK (type_code ~ '^[A-Z]{2,4}$'),
    last_seq         INTEGER     NOT NULL CHECK (last_seq > 0),
    PRIMARY KEY (organization_id, type_code)
);

CREATE TABLE IF NOT EXISTS public.vault_document_register (
    organization_id  UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    doc_kind         TEXT        NOT NULL,
    source_id        TEXT        NOT NULL,
    type_code        TEXT        NOT NULL CHECK (type_code ~ '^[A-Z]{2,4}$'),
    seq              INTEGER     NOT NULL CHECK (seq > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, doc_kind, source_id),
    CONSTRAINT vault_document_register_number_unique UNIQUE (organization_id, type_code, seq)
);

ALTER TABLE public.vault_document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_document_register ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'vault_document_counters'
          AND policyname = 'vault_document_counters_service_role'
    ) THEN
        CREATE POLICY vault_document_counters_service_role
        ON public.vault_document_counters
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'vault_document_register'
          AND policyname = 'vault_document_register_service_role'
    ) THEN
        CREATE POLICY vault_document_register_service_role
        ON public.vault_document_register
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Registers any of p_items not seen before and returns the numbers for all
-- of them. p_items: [{"kind": ..., "source_id": ..., "type_code": ...}],
-- oldest first so older documents get lower numbers. One call per folder
-- listing; the per-org advisory lock keeps numbering gap-free and unique when
-- folders load in parallel.
CREATE OR REPLACE FUNCTION public.assign_vault_document_ids(p_org UUID, p_items JSONB)
RETURNS TABLE (doc_kind TEXT, source_id TEXT, type_code TEXT, seq INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    item  JSONB;
    v_seq INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('vault_document_register:' || p_org::text, 0));

    FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.vault_document_register r
            WHERE r.organization_id = p_org
              AND r.doc_kind = item->>'kind'
              AND r.source_id = item->>'source_id'
        ) THEN
            INSERT INTO public.vault_document_counters AS c (organization_id, type_code, last_seq)
            VALUES (p_org, item->>'type_code', 1)
            ON CONFLICT (organization_id, type_code) DO UPDATE SET last_seq = c.last_seq + 1
            RETURNING c.last_seq INTO v_seq;

            INSERT INTO public.vault_document_register (organization_id, doc_kind, source_id, type_code, seq)
            VALUES (p_org, item->>'kind', item->>'source_id', item->>'type_code', v_seq);
        END IF;
    END LOOP;

    RETURN QUERY
        SELECT r.doc_kind, r.source_id, r.type_code, r.seq
        FROM public.vault_document_register r
        JOIN jsonb_array_elements(p_items) AS i(value)
          ON r.doc_kind = i.value->>'kind' AND r.source_id = i.value->>'source_id'
        WHERE r.organization_id = p_org;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_vault_document_ids(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_vault_document_ids(UUID, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_vault_document_ids(UUID, JSONB) TO service_role;

COMMIT;
