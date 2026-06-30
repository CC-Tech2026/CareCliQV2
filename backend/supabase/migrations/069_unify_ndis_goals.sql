-- Unify goals on ndis_goals (single source of truth for coordinator + support worker)
-- Migrates legacy patient_goals rows and adds worker-facing columns.

BEGIN;

-- ── Extend ndis_goals with plan-linked + worker session fields ───────────────
ALTER TABLE public.ndis_goals
  ADD COLUMN IF NOT EXISTS plan_id         UUID REFERENCES public.ndis_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_focus    JSONB    NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS priority        INTEGER  NOT NULL DEFAULT 99,
  ADD COLUMN IF NOT EXISTS why_it_matters  TEXT;

CREATE INDEX IF NOT EXISTS idx_ndis_goals_plan_priority
  ON public.ndis_goals (plan_id, priority ASC)
  WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ndis_goals_participant_priority
  ON public.ndis_goals (participant_id, priority ASC, status);

-- ── Migrate patient_goals → ndis_goals (preserve IDs for sessions.goals_addressed) ─
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'patient_goals'
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
            success_criteria,
            why_it_matters,
            worker_focus,
            priority,
            status,
            created_at,
            updated_at,
            completed_at
        )
        SELECT
            pg.id,
            np.patient_id,
            COALESCE(p.organization_id, np.organization_id),
            pg.plan_id,
            COALESCE(NULLIF(TRIM(pg.title), ''), NULLIF(TRIM(pg.description), ''), 'Untitled goal'),
            CASE LOWER(COALESCE(pg.category, 'general'))
                WHEN 'community'   THEN 'community'
                WHEN 'health'      THEN 'health'
                WHEN 'social'      THEN 'social'
                WHEN 'employment'  THEN 'employment'
                WHEN 'other'       THEN 'other'
                ELSE 'daily_living'
            END,
            pg.description,
            pg.target_date,
            pg.why_it_matters,
            pg.why_it_matters,
            COALESCE(pg.worker_focus, '[]'::jsonb),
            COALESCE(pg.priority, 99),
            CASE
                WHEN pg.status = 'completed' THEN 'completed'
                WHEN pg.status IN ('active', 'archived') THEN pg.status
                ELSE 'active'
            END,
            COALESCE(pg.created_at, now()),
            now(),
            CASE WHEN pg.status = 'completed' THEN now() ELSE NULL END
        FROM public.patient_goals pg
        JOIN public.ndis_plans np ON np.id = pg.plan_id
        JOIN public.patients p ON p.id = np.patient_id
        ON CONFLICT (id) DO UPDATE SET
            plan_id        = COALESCE(EXCLUDED.plan_id, ndis_goals.plan_id),
            worker_focus   = CASE
                WHEN ndis_goals.worker_focus = '[]'::jsonb THEN EXCLUDED.worker_focus
                ELSE ndis_goals.worker_focus
            END,
            priority       = LEAST(COALESCE(ndis_goals.priority, 99), COALESCE(EXCLUDED.priority, 99)),
            why_it_matters = COALESCE(EXCLUDED.why_it_matters, ndis_goals.why_it_matters),
            success_criteria = COALESCE(EXCLUDED.success_criteria, ndis_goals.success_criteria),
            updated_at     = now();

        COMMENT ON TABLE public.patient_goals IS
            'DEPRECATED: use ndis_goals. Legacy rows migrated by 069_unify_ndis_goals.sql.';
    END IF;
END $$;

-- ── RLS for ndis_goals (org-scoped via participant) ───────────────────────────
ALTER TABLE public.ndis_goals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'ndis_goals' AND policyname = 'ndis_goals_org'
    ) THEN
        CREATE POLICY ndis_goals_org ON public.ndis_goals
            FOR ALL TO authenticated
            USING (
                organization_id = public.cs_user_org_id()
            )
            WITH CHECK (
                organization_id = public.cs_user_org_id()
            );
    END IF;
END $$;

COMMIT;
