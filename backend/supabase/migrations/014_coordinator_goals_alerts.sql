-- ============================================================
-- Coordinator Goals & Planning — new columns (Task #17)
-- ============================================================

-- upcoming_review_date: coordinator-scheduled goal review date per participant
ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS upcoming_review_date TEXT;

-- recipient_user_id: targeted in-app alerts (e.g. bulk credential reminders)
ALTER TABLE public.alerts
    ADD COLUMN IF NOT EXISTS recipient_user_id UUID;
