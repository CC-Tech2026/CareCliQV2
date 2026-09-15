-- Next of kin / guardian / nominee contact for a participant. Distinct from
-- emergency_contact (who to call in an emergency) and case_manager_name/phone
-- (the NDIS-side contact who manages their plan/coordination) — this is the
-- personal contact who represents the participant's interests. Same shape as
-- emergency_contact ({name, phone, relationship}) for consistency.
ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS next_of_kin JSONB;
