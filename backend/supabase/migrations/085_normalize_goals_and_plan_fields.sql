-- Phase 2 normalization: single source of truth for goals and plan management.
-- Backfills any remaining patients.goals JSONB into ndis_goals before dropping legacy columns.

BEGIN;

-- ── 1. Backfill patients.goals → ndis_goals (skip IDs already present) ───────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'patients'
          AND column_name = 'goals'
    ) THEN
        INSERT INTO public.ndis_goals (
            id,
            participant_id,
            organization_id,
            plan_id,
            name,
            goal_area,
            description,
            target_date,
            why_it_matters,
            worker_focus,
            priority,
            status,
            created_at,
            updated_at,
            completed_at
        )
        SELECT
            CASE
                WHEN NULLIF(TRIM(elem->>'id'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN NULLIF(TRIM(elem->>'id'), '')::uuid
                ELSE gen_random_uuid()
            END,
            p.id,
            p.organization_id,
            np.id,
            COALESCE(
                NULLIF(TRIM(elem->>'title'), ''),
                NULLIF(TRIM(elem->>'description'), ''),
                NULLIF(TRIM(elem->>'goal_text'), ''),
                'Untitled goal'
            ),
            CASE LOWER(COALESCE(elem->>'category', elem->>'ndis_category', 'general'))
                WHEN 'community'          THEN 'community'
                WHEN 'health'             THEN 'health'
                WHEN 'social'             THEN 'social'
                WHEN 'employment'         THEN 'employment'
                WHEN 'capacity_building'  THEN 'health'
                WHEN 'capital'            THEN 'other'
                WHEN 'other'              THEN 'other'
                ELSE 'daily_living'
            END,
            COALESCE(
                NULLIF(TRIM(elem->>'description'), ''),
                NULLIF(TRIM(elem->>'goal_text'), ''),
                NULLIF(TRIM(elem->>'title'), '')
            ),
            CASE
                WHEN NULLIF(TRIM(elem->>'target_date'), '') ~ '^\d{4}-\d{2}-\d{2}$'
                THEN NULLIF(TRIM(elem->>'target_date'), '')::date
                ELSE NULL
            END,
            NULLIF(TRIM(elem->>'why_it_matters'), ''),
            '[]'::jsonb,
            99,
            CASE
                WHEN COALESCE((elem->>'is_achieved')::boolean, false) THEN 'completed'
                WHEN LOWER(COALESCE(elem->>'status', 'active')) IN ('archived', 'completed') THEN LOWER(elem->>'status')
                ELSE 'active'
            END,
            now(),
            now(),
            CASE
                WHEN COALESCE((elem->>'is_achieved')::boolean, false) THEN now()
                ELSE NULL
            END
        FROM public.patients p
        LEFT JOIN LATERAL (
            SELECT id FROM public.ndis_plans
            WHERE patient_id = p.id
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1
        ) np ON true
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(p.goals) = 'array' THEN p.goals
                ELSE '[]'::jsonb
            END
        ) AS elem
        WHERE jsonb_array_length(
            CASE
                WHEN jsonb_typeof(p.goals) = 'array' THEN p.goals
                ELSE '[]'::jsonb
            END
        ) > 0
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- ── 2. Collapse duplicate goal text column ───────────────────────────────────
UPDATE public.ndis_goals
SET why_it_matters = COALESCE(NULLIF(TRIM(why_it_matters), ''), NULLIF(TRIM(success_criteria), ''))
WHERE success_criteria IS NOT NULL
  AND (why_it_matters IS NULL OR TRIM(why_it_matters) = '');

ALTER TABLE public.ndis_goals
  DROP COLUMN IF EXISTS success_criteria;

-- ── 3. Drop legacy patient columns ───────────────────────────────────────────
ALTER TABLE public.patients
  DROP COLUMN IF EXISTS goals,
  DROP COLUMN IF EXISTS plan_management,
  DROP COLUMN IF EXISTS used_budget;

COMMIT;
