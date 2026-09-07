-- Read-only audit of invoices.participant_id (run in Supabase SQL Editor).
-- Safe to run anytime; makes no changes. Answers three questions before any backfill:
--   1. How many invoices have a null participant_id at all?
--   2. Of those, how many are clean backfill candidates (recipient_name matches exactly
--      one participant in the same org)?
--   3. What does that candidate set actually look like — sample it before trusting it.
-- A null participant_id with no matching participant (or matching more than one) is left
-- alone here; that is the organisation-level case (e.g. billed straight to "NDIA") or an
-- ambiguous name, neither of which this script treats as a backfill candidate.

-- ── 1. Total null-participant_id invoices ───────────────────────────────────
SELECT count(*) AS null_participant_invoice_count
FROM public.invoices
WHERE participant_id IS NULL;

-- ── 2. Backfill candidates: recipient_name matches exactly one participant  ──
--       in the same org, case-insensitive exact match.
WITH candidates AS (
    SELECT
        i.id            AS invoice_id,
        i.organization_id,
        i.recipient_name,
        i.invoice_number,
        i.status,
        i.created_at,
        (
            SELECT array_agg(p.id)
            FROM public.patients p
            WHERE p.organization_id = i.organization_id
              AND lower(trim(p.full_name)) = lower(trim(i.recipient_name))
        ) AS matching_participant_ids
    FROM public.invoices i
    WHERE i.participant_id IS NULL
      AND coalesce(trim(i.recipient_name), '') <> ''
)
SELECT
    count(*) FILTER (WHERE array_length(matching_participant_ids, 1) = 1)  AS clean_single_match_count,
    count(*) FILTER (WHERE array_length(matching_participant_ids, 1) > 1)  AS ambiguous_multi_match_count,
    count(*) FILTER (WHERE matching_participant_ids IS NULL)              AS no_match_count
FROM candidates;

-- ── 3. Sample of the clean single-match candidates — inspect before backfilling ──
WITH candidates AS (
    SELECT
        i.id            AS invoice_id,
        i.organization_id,
        i.recipient_name,
        i.invoice_number,
        i.status,
        i.created_at,
        (
            SELECT array_agg(p.id)
            FROM public.patients p
            WHERE p.organization_id = i.organization_id
              AND lower(trim(p.full_name)) = lower(trim(i.recipient_name))
        ) AS matching_participant_ids
    FROM public.invoices i
    WHERE i.participant_id IS NULL
      AND coalesce(trim(i.recipient_name), '') <> ''
)
SELECT invoice_id, invoice_number, organization_id, recipient_name, status, created_at,
       matching_participant_ids[1] AS candidate_participant_id
FROM candidates
WHERE array_length(matching_participant_ids, 1) = 1
ORDER BY created_at DESC
LIMIT 20;

-- ── 4. Ambiguous matches — needs a human, never auto-backfill these ─────────
WITH candidates AS (
    SELECT
        i.id            AS invoice_id,
        i.organization_id,
        i.recipient_name,
        i.invoice_number,
        i.created_at,
        (
            SELECT array_agg(p.id)
            FROM public.patients p
            WHERE p.organization_id = i.organization_id
              AND lower(trim(p.full_name)) = lower(trim(i.recipient_name))
        ) AS matching_participant_ids
    FROM public.invoices i
    WHERE i.participant_id IS NULL
      AND coalesce(trim(i.recipient_name), '') <> ''
)
SELECT invoice_id, invoice_number, organization_id, recipient_name, created_at, matching_participant_ids
FROM candidates
WHERE array_length(matching_participant_ids, 1) > 1
ORDER BY created_at DESC
LIMIT 20;
