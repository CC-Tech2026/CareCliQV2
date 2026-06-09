-- ============================================================
-- CCQ-110 — Supabase JWT custom claim: organisation_id
-- ============================================================
-- Creates a PG function that Supabase Auth calls as a "Custom
-- Access Token Hook" (Dashboard → Authentication → Hooks).
--
-- The function reads the user's active organization_id from
-- organization_members and injects it into app_metadata so it
-- travels in the JWT without an extra DB round-trip per request.
--
-- How to activate in Supabase Dashboard:
--   Authentication → Hooks → Custom Access Token Hook
--   URI: public.custom_access_token_hook
--
-- The Python middleware (CCQ-104) reads organisation_id from the
-- application-issued JWT instead of from this hook — both paths
-- are maintained for compatibility.
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id   uuid;
    _org_id    uuid;
    _claims    jsonb;
BEGIN
    _user_id := (event->>'user_id')::uuid;

    -- Resolve the active org for this user
    SELECT organization_id INTO _org_id
    FROM   public.organization_members
    WHERE  user_id   = _user_id
      AND  is_active = true
    LIMIT  1;

    _claims := COALESCE(event->'claims', '{}'::jsonb);

    -- Inject into app_metadata so Supabase embeds it in the JWT
    _claims := jsonb_set(
        _claims,
        '{app_metadata}',
        COALESCE(_claims->'app_metadata', '{}'::jsonb) || jsonb_build_object('organisation_id', _org_id),
        true
    );

    RETURN jsonb_set(event, '{claims}', _claims, true);
END;
$$;

-- Grant execute to the supabase_auth_admin role used by the hook system
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC, anon, authenticated;

-- ── Helper: refresh org claim when user's org changes ───────────────────────
-- Call this after update_member_role / remove_member so the claim
-- is stale-safe on re-login.  No action needed for existing tokens
-- (they expire per settings.access_token_expire_minutes).

COMMENT ON FUNCTION public.custom_access_token_hook IS
    'CCQ-110 — Injects app_metadata.organisation_id into Supabase JWTs at sign-in.';
