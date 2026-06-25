-- CARECLIQV2-273 — Worker help, FAQ, known issues, tutorial progress
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_support_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    support_phone TEXT NOT NULL DEFAULT '1800 000 000',
    support_email TEXT NOT NULL DEFAULT 'support@carecliq.com.au',
    business_hours_json JSONB NOT NULL DEFAULT '{"timezone":"Australia/Sydney","weekdays":"Mon–Fri 9:00–17:00 AEST"}'::jsonb,
    outside_hours_message TEXT NOT NULL DEFAULT 'Our support team is available Mon–Fri 9:00–17:00 AEST. We will respond on the next business day.',
    intercom_app_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_faq_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_faq_published
    ON public.support_faq_articles (is_published, sort_order);

CREATE INDEX IF NOT EXISTS idx_support_faq_tags
    ON public.support_faq_articles USING GIN (tags);

CREATE TABLE IF NOT EXISTS public.support_known_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    affected_version TEXT,
    workaround TEXT,
    expected_fix_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_known_issues_active
    ON public.support_known_issues (is_active, expected_fix_date);

CREATE TABLE IF NOT EXISTS public.worker_tutorial_progress (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    completed_at TIMESTAMPTZ,
    skipped BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, step_key)
);

-- Seed singleton support config when empty
INSERT INTO public.app_support_config (support_phone, support_email)
SELECT '1800 000 000', 'support@carecliq.com.au'
WHERE NOT EXISTS (SELECT 1 FROM public.app_support_config);

-- Seed FAQ articles (idempotent via slug)
INSERT INTO public.support_faq_articles (slug, title, body_markdown, tags, sort_order)
VALUES
    ('add-evidence', 'How to add evidence', 'Open your shift, tap a task, then use the camera, voice, or notes buttons to attach evidence. Evidence saves locally if you are offline and syncs when connection returns.', ARRAY['evidence','tasks'], 1),
    ('offline', 'What to do if offline', 'You will see a yellow banner when offline. Your work is saved on this device. Open **Sync status** from the header indicator to review pending items and tap **Retry sync** when back online.', ARRAY['offline','sync'], 2),
    ('compliance-score', 'How compliance score is calculated', 'Your compliance score reflects completed mandatory tasks, evidence quality, timely notes, and shift sign-off. Coordinators see the same score in session review.', ARRAY['compliance'], 3),
    ('forgot-clock-out', 'What happens if I forget to clock out', 'Contact your coordinator as soon as possible. They can adjust the shift record. Always end your shift in the app when you leave the participant.', ARRAY['shifts','clock'], 4),
    ('report-incident', 'How to report an incident', 'Go to **Incidents** in the menu, tap **Report incident**, and complete the form. For emergencies call 000 first, then log the incident.', ARRAY['incidents','safety'], 5),
    ('clock-in-gps', 'Clock-in and GPS', 'At the participant location, tap **Clock in** and allow location access. GPS verifies you are at the service address.', ARRAY['shifts','gps'], 6),
    ('shift-signature', 'End shift and signature', 'Before ending a shift, complete mandatory tasks, then sign the shift summary confirming accuracy and safety.', ARRAY['shifts','signature'], 7),
    ('notifications', 'Notifications', 'Bell icon shows coordinator messages and alerts. Time-sensitive items also appear as banners during your shift.', ARRAY['notifications'], 8),
    ('credentials', 'Uploading credentials', 'Open **Credentials** to upload NDIS screening, first aid, and other required documents.', ARRAY['credentials'], 9),
    ('na-tasks', 'Marking a task N/A', 'If a task does not apply, mark it N/A with a reason. Mandatory tasks cannot be skipped without coordinator approval.', ARRAY['tasks'], 10),
    ('coordinator-chat', 'Messaging your coordinator', 'Use **Notifications** or **Messages** to read coordinator updates and reply when online.', ARRAY['messages'], 11),
    ('privacy', 'Your data and privacy', 'Open **Security** and **Privacy** in your profile to manage exports, analytics opt-out, and account security.', ARRAY['privacy'], 12),
    ('sync-queue', 'Understanding the sync queue', 'The header sync indicator shows offline, syncing, or all synced. Tap it to see each pending item with size and queued time.', ARRAY['offline','sync'], 13),
    ('mobile-data', 'Mobile data and uploads', 'Large photo uploads on mobile data may prompt a warning. You can wait for Wi-Fi or upload now. Data used this shift is shown on the sync screen.', ARRAY['offline','data'], 14),
    ('risk-alerts', 'Participant risk alerts', 'Review and acknowledge risk alerts at the start of each shift before providing support.', ARRAY['safety'], 15)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.app_support_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_faq_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_known_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_tutorial_progress ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_support_config' AND policyname = 'support_config_read') THEN
        CREATE POLICY support_config_read ON public.app_support_config FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_faq_articles' AND policyname = 'faq_read_published') THEN
        CREATE POLICY faq_read_published ON public.support_faq_articles FOR SELECT TO authenticated
            USING (is_published = true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'support_known_issues' AND policyname = 'known_issues_read_active') THEN
        CREATE POLICY known_issues_read_active ON public.support_known_issues FOR SELECT TO authenticated
            USING (is_active = true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'worker_tutorial_progress' AND policyname = 'tutorial_progress_own') THEN
        CREATE POLICY tutorial_progress_own ON public.worker_tutorial_progress FOR ALL TO authenticated
            USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    END IF;
END $$;

COMMIT;
