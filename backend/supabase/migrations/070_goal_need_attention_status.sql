-- Goal need_attention status for task miss tracking
-- Enables goals to flag when too many linked tasks are missed/incomplete

-- Add "need_attention" to the status CHECK constraint
ALTER TABLE ndis_goals
    DROP CONSTRAINT IF EXISTS ndis_goals_status_check;

ALTER TABLE ndis_goals
    ADD CONSTRAINT ndis_goals_status_check
    CHECK (status IN ('active', 'need_attention', 'completed', 'archived'));

-- Add field to track when need_attention status was set
ALTER TABLE ndis_goals
    ADD COLUMN IF NOT EXISTS need_attention_set_at TIMESTAMPTZ;

-- Add field to track reason for need_attention (e.g., "3 tasks missed in 2 weeks")
ALTER TABLE ndis_goals
    ADD COLUMN IF NOT EXISTS need_attention_reason TEXT;
