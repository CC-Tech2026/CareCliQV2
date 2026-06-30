-- CARECLIQV2-294 — Shift summary auto-generation, indefinite retention, share audit

BEGIN;

ALTER TABLE public.shift_export_requests
    ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS shared_recipients JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Auto-generated summaries are retained indefinitely (expires_at NULL).
-- Manual on-demand exports keep a 30-day TTL from application code.

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_export_auto_per_shift
    ON public.shift_export_requests (shift_id)
    WHERE auto_generated = true AND status IN ('pending', 'ready');

CREATE INDEX IF NOT EXISTS idx_shift_export_requests_shift_auto
    ON public.shift_export_requests (shift_id, auto_generated, created_at DESC);

COMMIT;
