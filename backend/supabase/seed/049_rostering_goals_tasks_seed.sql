-- =============================================================================
-- CARECLIQ — Rostering prerequisites seed (goals + tasks)
-- -----------------------------------------------------------------------------
-- Shift assignment requires:
--   - >= 1 active ndis_goals per participant
--   - >= 1 participant_tasks per participant
--
-- Safe to re-run: only fills participants missing goals and/or tasks.
-- Target org: Sunshine / primary demo org (a1111111-...)
--
-- Run in Supabase SQL editor or via CLI after migrations.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_org           uuid := 'a1111111-1111-1111-1111-111111111111';
    v_coordinator   uuid;
    p               record;
    g1              uuid;
    g2              uuid;
    active_goals    int;
    task_count      int;
BEGIN
    SELECT id INTO v_coordinator
    FROM public.users
    WHERE organization_id = v_org
      AND role = 'support_coordinator'
    ORDER BY CASE WHEN email = 'sarah@sunshine-demo.com' THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_coordinator IS NULL THEN
        RAISE EXCEPTION 'No support coordinator found for org %. Run demo user seed first.', v_org;
    END IF;

    FOR p IN
        SELECT id, full_name
        FROM public.patients
        WHERE organization_id = v_org
        ORDER BY full_name
    LOOP
        SELECT COUNT(*)::int INTO active_goals
        FROM public.ndis_goals
        WHERE participant_id = p.id
          AND organization_id = v_org
          AND status = 'active';

        SELECT COUNT(*)::int INTO task_count
        FROM public.participant_tasks
        WHERE participant_id = p.id
          AND organization_id = v_org;

        -- ── Seed active goals when missing ───────────────────────────────────
        IF active_goals = 0 THEN
            g1 := gen_random_uuid();
            g2 := gen_random_uuid();

            INSERT INTO public.ndis_goals (
                id, participant_id, organization_id, created_by,
                name, goal_area, description, target_date, success_criteria, status
            ) VALUES
            (
                g1, p.id, v_org, v_coordinator,
                'Independent dressing — shirt and pants',
                'daily_living',
                'Participant will dress upper and lower body independently with minimal verbal prompting during morning routine.',
                (CURRENT_DATE + INTERVAL '6 months')::date,
                'Completes dressing in under 15 minutes with no more than 1 verbal prompt on 4 of 5 sessions.',
                'active'
            ),
            (
                g2, p.id, v_org, v_coordinator,
                'Increase community participation',
                'community',
                'Attend local community activities at least twice per week with appropriate support.',
                (CURRENT_DATE + INTERVAL '9 months')::date,
                'Participant attends 2+ community outings per week for 4 consecutive weeks.',
                'active'
            );

            active_goals := 2;
            RAISE NOTICE 'Seeded 2 goals for % (%)', p.full_name, p.id;
        END IF;

        -- ── Seed tasks when missing ──────────────────────────────────────────
        IF task_count = 0 THEN
            SELECT id INTO g1
            FROM public.ndis_goals
            WHERE participant_id = p.id
              AND organization_id = v_org
              AND status = 'active'
            ORDER BY created_at
            LIMIT 1;

            SELECT id INTO g2
            FROM public.ndis_goals
            WHERE participant_id = p.id
              AND organization_id = v_org
              AND status = 'active'
              AND id <> g1
            ORDER BY created_at
            LIMIT 1;

            IF g1 IS NULL THEN
                RAISE NOTICE 'Skip tasks for % — no active goals', p.full_name;
                CONTINUE;
            END IF;

            INSERT INTO public.participant_tasks (
                participant_id, goal_id, organization_id, created_by,
                name, description, frequency, status, is_mandatory
            ) VALUES
            (
                p.id, g1, v_org, v_coordinator,
                'Prompt independent dressing',
                'Lay out clothes in sequence. Use backward chaining for buttons. Document prompting level (independent / verbal / physical).',
                'each_shift',
                'pending',
                true
            );

            IF g2 IS NOT NULL THEN
                INSERT INTO public.participant_tasks (
                    participant_id, goal_id, organization_id, created_by,
                    name, description, frequency, status, is_mandatory
                ) VALUES
                (
                    p.id, g2, v_org, v_coordinator,
                    'Support community outing',
                    'Accompany participant to a community activity. Encourage participant-led choices and note social interactions.',
                    'weekly',
                    'pending',
                    false
                );
            END IF;

            RAISE NOTICE 'Seeded tasks for % (%)', p.full_name, p.id;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- Verify rostering prerequisites
SELECT
    p.full_name,
    (SELECT COUNT(*) FROM public.ndis_goals g
     WHERE g.participant_id = p.id AND g.organization_id = p.organization_id AND g.status = 'active') AS active_goals,
    (SELECT COUNT(*) FROM public.participant_tasks t
     WHERE t.participant_id = p.id AND t.organization_id = p.organization_id) AS tasks,
    CASE
        WHEN (SELECT COUNT(*) FROM public.ndis_goals g
              WHERE g.participant_id = p.id AND g.organization_id = p.organization_id AND g.status = 'active') > 0
         AND (SELECT COUNT(*) FROM public.participant_tasks t
              WHERE t.participant_id = p.id AND t.organization_id = p.organization_id) > 0
        THEN 'OK'
        ELSE 'BLOCKED'
    END AS rostering_ready
FROM public.patients p
WHERE p.organization_id = 'a1111111-1111-1111-1111-111111111111'
ORDER BY p.full_name;
