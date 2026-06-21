-- ============================================================================
-- FIX: Add missing SELECT, UPDATE, DELETE RLS policies for alerts table
-- Allows workers to read/update alerts targeted to them
-- Allows coordinators to manage org-wide alerts
-- ============================================================================

-- Enable RLS if not already enabled
ALTER TABLE public.alerts FORCE ROW LEVEL SECURITY;

-- 1. SELECT policy: Users can see alerts in their org + alerts targeted to them
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alerts' AND policyname='alerts_select_user') THEN
        CREATE POLICY alerts_select_user ON public.alerts FOR SELECT TO authenticated
        USING (
            organization_id = public.cs_user_org_id() 
            OR 
            (recipient_user_id = auth.uid() AND organization_id = public.cs_user_org_id())
        );
    END IF;
END $$;

-- 2. UPDATE policy: Users can mark alerts as read
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alerts' AND policyname='alerts_update_user') THEN
        CREATE POLICY alerts_update_user ON public.alerts FOR UPDATE TO authenticated
        USING (
            organization_id = public.cs_user_org_id()
            AND
            (recipient_user_id = auth.uid() OR recipient_user_id IS NULL)
        )
        WITH CHECK (
            organization_id = public.cs_user_org_id()
            AND
            (recipient_user_id = auth.uid() OR recipient_user_id IS NULL)
        );
    END IF;
END $$;

-- 3. DELETE policy: Coordinators can delete alerts in their org
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alerts' AND policyname='alerts_delete_org') THEN
        CREATE POLICY alerts_delete_org ON public.alerts FOR DELETE TO authenticated
        USING (organization_id = public.cs_user_org_id());
    END IF;
END $$;

-- Keep existing INSERT policy for coordinators
-- alerts_insert_org already exists from migration 019
