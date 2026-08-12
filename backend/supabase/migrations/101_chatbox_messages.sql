-- ============================================================
-- Chatbox ("Quill") — persisted conversation history
-- Phase A3: replaces the in-process MemorySaver, which lost all
-- history on every backend restart/redeploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chatbox_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    thread_id       text NOT NULL,
    role            text NOT NULL CHECK (role IN ('user', 'assistant')),
    content         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chatbox_messages_thread_idx
    ON public.chatbox_messages (thread_id, created_at);

-- Users may only read/write their own messages
ALTER TABLE public.chatbox_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.chatbox_messages
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
