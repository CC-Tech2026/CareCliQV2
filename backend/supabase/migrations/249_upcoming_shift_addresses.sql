-- Upcoming shifts show the participant's current home address.
--
-- Each shift keeps its own copy of the address (shifts.participant_address);
-- the worker app, its maps link and travel claims read that copy. It was never
-- refreshed when the participant's address changed, and new shifts were
-- created without one, so workers saw an old address or none.
--
-- This refreshes shifts that haven't started (unassigned, scheduled) from the
-- participant record. Shifts already worked keep the address they happened
-- at, and a participant with no address on file leaves the shift's copy
-- alone. Running this again changes nothing. From now on the API keeps the
-- copy current (participant_service._sync_upcoming_shift_addresses).

UPDATE public.shifts s
SET participant_address = TRIM(p.address)
FROM public.participants p
WHERE s.participant_id = p.id
  AND s.status IN ('unassigned', 'scheduled')
  AND COALESCE(TRIM(p.address), '') <> ''
  AND s.participant_address IS DISTINCT FROM TRIM(p.address);
