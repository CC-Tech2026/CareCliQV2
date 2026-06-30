-- Add NDIS support category to goals and tasks
-- Links goals/tasks to the participant's funded budget lines

ALTER TABLE ndis_goals
  ADD COLUMN IF NOT EXISTS support_category TEXT;

ALTER TABLE participant_tasks
  ADD COLUMN IF NOT EXISTS support_category TEXT;

COMMENT ON COLUMN ndis_goals.support_category     IS 'NDIS funding line: core_daily_activities | core_transport | core_consumables | core_social_community | cb_support_coordination | cb_daily_living | cb_health_wellbeing | cb_social_skills | cb_employment | cb_learning | capital_assistive_tech | capital_home_mods';
COMMENT ON COLUMN participant_tasks.support_category IS 'NDIS funding line matching ndis_goals.support_category';
