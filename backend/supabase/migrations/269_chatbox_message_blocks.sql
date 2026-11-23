-- ============================================================
-- Quill: keep each answer's tables, charts and figures with it
-- ============================================================
-- Until now only the reply's text was saved, so reopening a past
-- conversation showed the sentences but none of the tables or charts
-- they described. `blocks` holds the same list the API returned with
-- the answer (built by chatbox/blocks.py from the tool results, never
-- from the model's prose). NULL for user turns and for older answers.
--
-- The backend reads and writes this column only when it exists
-- (chatbox/memory.py), so a server running ahead of this migration
-- keeps working and just doesn't save blocks.

ALTER TABLE public.chatbox_messages
    ADD COLUMN IF NOT EXISTS blocks jsonb;
