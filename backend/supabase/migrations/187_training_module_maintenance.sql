-- Maintenance state is separate from archival: keep the course visible to workers.
BEGIN;

ALTER TABLE public.training_modules
    ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS lock_reason text;

-- Serialize completion writes against module maintenance updates so a stale
-- worker page cannot submit through a concurrent lock.
CREATE OR REPLACE FUNCTION public.check_training_module_available()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE course public.training_modules%ROWTYPE;
BEGIN
    SELECT * INTO course FROM public.training_modules WHERE id = NEW.module_id FOR SHARE;
    IF NOT FOUND OR course.organization_id IS DISTINCT FROM NEW.organization_id OR NOT course.is_active THEN
        RAISE EXCEPTION 'Training module unavailable' USING ERRCODE = '23514';
    END IF;
    IF course.is_locked THEN
        RAISE EXCEPTION 'Training module is under maintenance' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS training_completion_available ON public.worker_training_completions;
CREATE TRIGGER training_completion_available
BEFORE INSERT OR UPDATE OF completed_at, acknowledged_at ON public.worker_training_completions
FOR EACH ROW EXECUTE FUNCTION public.check_training_module_available();

COMMIT;
