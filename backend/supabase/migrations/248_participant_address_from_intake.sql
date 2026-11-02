-- Home address on the participant record.
--
-- Until now an intake's address (street, suburb, state, postcode from the
-- referral or onboarding form, or one `address` line from a data import)
-- never reached participants.address when the intake was activated, and the
-- participant API discarded any address it was sent. So participants who
-- joined through onboarding have their address on the intake only.
--
-- This copies it across, for participants whose address is blank. An address
-- someone has already entered is never touched, and running this again
-- changes nothing. Same composition as _intake_address() in
-- services/participant_intake_service.py.

ALTER TABLE public.participants
    ADD COLUMN IF NOT EXISTS address TEXT;

UPDATE public.participants p
SET address = src.intake_address
FROM (
    SELECT DISTINCT ON (i.participant_id)
        i.participant_id,
        NULLIF(TRIM(COALESCE(
            NULLIF(TRIM(i.web_intake->>'address'), ''),
            CONCAT_WS(', ',
                NULLIF(TRIM(i.web_intake->>'street_address'), ''),
                NULLIF(TRIM(i.web_intake->>'suburb'), ''),
                NULLIF(TRIM(CONCAT_WS(' ',
                    NULLIF(TRIM(i.web_intake->>'state'), ''),
                    NULLIF(TRIM(i.web_intake->>'postcode'), '')
                )), '')
            )
        )), '') AS intake_address
    FROM public.participant_intakes i
    WHERE i.participant_id IS NOT NULL
    ORDER BY i.participant_id, i.updated_at DESC NULLS LAST
) src
WHERE src.participant_id = p.id
  AND src.intake_address IS NOT NULL
  AND COALESCE(TRIM(p.address), '') = '';
