-- generate_invoice_pdf() (billing_service.py) has a bare except Exception
-- around the real Jinja2/WeasyPrint render that silently falls back to
-- _minimal_pdf_bytes() — a five-line placeholder with no line items, no
-- NDIS detail, nothing distinguishing it from a real invoice PDF in the
-- database. The invoice's status can then be moved to finalized/sent with
-- no record anywhere that what got generated (and possibly already sent to
-- a participant or plan manager) wasn't the real document.
--
-- Nullable/default-false, additive: existing rows and any code path that
-- doesn't set it keep working exactly as before.

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS pdf_generation_failed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pdf_generation_error text;
