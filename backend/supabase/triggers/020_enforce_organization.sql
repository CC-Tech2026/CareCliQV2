CREATE OR REPLACE FUNCTION public.enforce_org_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.cs_user_org_id();
  END IF;

  IF NEW.organization_id != public.cs_user_org_id() THEN
    RAISE EXCEPTION 'Cross-tenant write blocked';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- APPLY TRIGGERS FOR SESSIONS, INCIDENTS, PATIENTS, AND ALERTS --

CREATE TRIGGER patients_org_guard
BEFORE INSERT OR UPDATE ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.enforce_org_id();

CREATE TRIGGER sessions_org_guard
BEFORE INSERT OR UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_org_id();

CREATE TRIGGER incidents_org_guard
BEFORE INSERT OR UPDATE ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.enforce_org_id();

CREATE TRIGGER alerts_org_guard
BEFORE INSERT OR UPDATE ON public.alerts
FOR EACH ROW EXECUTE FUNCTION public.enforce_org_id();