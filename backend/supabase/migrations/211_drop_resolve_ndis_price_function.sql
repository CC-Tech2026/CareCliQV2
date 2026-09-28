-- Retire public.resolve_ndis_price(). Its only live caller,
-- record_task_completion() (backend/app/api/ndis_tasks.py), has been
-- switched to ndis_pricing_service.resolve_price() (the Python
-- implementation, now with the same remote/very-remote multiplier
-- fallback this function had — see that commit). Confirmed via a full
-- repo search that nothing else calls it.
--
-- DEPLOY ORDER: apply this only after the backend deploy containing that
-- ndis_tasks.py change is live. Applying it first would break
-- record_task_completion()'s price lookup on any backend instance still
-- running the old code (it degrades gracefully — the RPC call is wrapped
-- in try/except and evidence still records without a billed_amount — but
-- there's no reason to take that hit if the order is just reversed).

DROP FUNCTION IF EXISTS public.resolve_ndis_price(text, uuid, date, text);
