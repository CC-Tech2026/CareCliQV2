-- CARECLIQV2-261/262 — RLS + Supabase Realtime for in-app notifications

BEGIN;

-- ── Safe task template columns (044 may not be applied yet) ─────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'participant_task_templates'
    ) THEN
        ALTER TABLE public.participant_task_templates
            ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER NOT NULL DEFAULT 5,
            ADD COLUMN IF NOT EXISTS scheduled_offset_minutes INTEGER;
    END IF;
END $$;

-- ── RLS: user_notifications ─────────────────────────────────────────────────
ALTER TABLE public.user_notifications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'user_notifications' AND policyname = 'user_notifications_select_own'
    ) THEN
        CREATE POLICY user_notifications_select_own ON public.user_notifications
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'user_notifications' AND policyname = 'user_notifications_update_own'
    ) THEN
        CREATE POLICY user_notifications_update_own ON public.user_notifications
            FOR UPDATE TO authenticated
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());
    END IF;
END $$;

-- ── RLS: conversations ──────────────────────────────────────────────────────
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'conversations' AND policyname = 'conversations_select_participant'
    ) THEN
        CREATE POLICY conversations_select_participant ON public.conversations
            FOR SELECT TO authenticated
            USING (worker_id = auth.uid() OR coordinator_id = auth.uid());
    END IF;
END $$;

-- ── RLS: conversation_messages ──────────────────────────────────────────────
ALTER TABLE public.conversation_messages FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'conversation_messages' AND policyname = 'conversation_messages_select_participant'
    ) THEN
        CREATE POLICY conversation_messages_select_participant ON public.conversation_messages
            FOR SELECT TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.conversations c
                    WHERE c.id = conversation_id
                      AND (c.worker_id = auth.uid() OR c.coordinator_id = auth.uid())
                )
            );
    END IF;
END $$;

-- ── Realtime publication (INSERT/UPDATE for live inbox + messaging) ─────────
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    END IF;
END $$;

COMMIT;
