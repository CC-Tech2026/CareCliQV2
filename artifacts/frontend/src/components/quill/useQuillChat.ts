import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearChatHistory,
  deleteChatThread,
  getChatThreadMessages,
  listChatThreads,
  sendChatMessage,
  type ChatBlock,
  type ThreadSummary,
} from "@/services/chatboxService";

export type QuillMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks?: ChatBlock[];
  /** Follow-up questions offered under this answer. */
  suggestions?: string[];
  /** "error": the request failed and can be tried again; "stopped": the user stopped it. */
  status?: "error" | "stopped";
  /** The question an error or stopped answer belongs to, for Try again. */
  question?: string;
  createdAt?: string;
  durationMs?: number;
};

export const CHAT_ERROR_REPLY = "Sorry, I couldn't get that answer. Check your connection and try again.";
export const HISTORY_ERROR_REPLY = "Sorry, I couldn't open that conversation. Try again in a moment.";

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

/** Conversation state for Quill: the open thread, its messages, the list of
 * past threads, and sending (with stop and try again). */
export function useQuillChat(options: { answerStyle?: "brief" | "detailed" } = {}) {
  // Read at send time, so changing the setting applies to the next question.
  const answerStyleRef = useRef(options.answerStyle);
  answerStyleRef.current = options.answerStyle;
  const [messages, setMessages] = useState<QuillMessage[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsState, setThreadsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pending, setPending] = useState(false);
  const [openingThread, setOpeningThread] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadIdRef = useRef<string | undefined>(undefined);
  threadIdRef.current = threadId;
  // Bumped whenever another conversation is shown, so a late answer (or the
  // "stopped" note) never lands in the wrong one.
  const conversationRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadThreads = useCallback(async () => {
    setThreadsState((s) => (s === "ready" ? s : "loading"));
    try {
      setThreads(await listChatThreads());
      setThreadsState("ready");
    } catch {
      setThreadsState("error");
    }
  }, []);

  const ask = useCallback(
    async (question: string) => {
      setPending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = performance.now();
      const startedIn = threadIdRef.current;
      const conversation = conversationRef.current;
      try {
        const res = await sendChatMessage(question, startedIn, controller.signal, answerStyleRef.current);
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        // The person may have started a new chat or opened another one meanwhile.
        if (conversationRef.current !== conversation) return;
        setThreadId(res.thread_id);
        setMessages((prev) => [
          ...prev,
          { id: nextId("a"), role: "assistant", text: res.reply, blocks: res.blocks ?? [], suggestions: res.suggestions ?? [], question, createdAt: new Date().toISOString(), durationMs: performance.now() - startedAt },
        ]);
        void loadThreads();
      } catch {
        if (conversationRef.current !== conversation) return;
        const stopped = controller.signal.aborted;
        setMessages((prev) => [
          ...prev,
          stopped
            ? { id: nextId("a"), role: "assistant", text: "You stopped this answer.", status: "stopped", question }
            : { id: nextId("a"), role: "assistant", text: CHAT_ERROR_REPLY, status: "error", question },
        ]);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPending(false);
        }
      }
    },
    [loadThreads],
  );

  const send = useCallback(
    (text: string) => {
      const question = text.trim();
      if (!question || abortRef.current || openingThread) return;
      setMessages((prev) => [...prev, { id: nextId("u"), role: "user", text: question, createdAt: new Date().toISOString() }]);
      void ask(question);
    },
    [ask, openingThread],
  );

  /** Ask a failed or stopped question again, replacing that answer. */
  const retry = useCallback(
    (messageId: string) => {
      if (abortRef.current || openingThread) return;
      const failed = messages.find((m) => m.id === messageId);
      if (!failed?.question) return;
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      void ask(failed.question);
    },
    [ask, messages, openingThread],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    conversationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setOpeningThread(false);
    threadIdRef.current = undefined;
    setThreadId(undefined);
    setMessages([]);
  }, []);

  const openThread = useCallback(
    async (id: string) => {
      if (id === threadIdRef.current && messages.length) return;
      conversationRef.current += 1;
      const conversation = conversationRef.current;
      abortRef.current?.abort();
      abortRef.current = null;
      setPending(false);
      threadIdRef.current = id;
      setThreadId(id);
      setMessages([]);
      setOpeningThread(true);
      try {
        const history = await getChatThreadMessages(id);
        if (conversationRef.current !== conversation) return;
        setMessages(
          history.map((m, i) => ({
            id: `${id}-${i}`,
            role: m.role === "assistant" ? "assistant" : "user",
            text: m.content,
            blocks: m.blocks ?? [],
            createdAt: m.created_at || undefined,
          })),
        );
      } catch {
        if (conversationRef.current !== conversation) return;
        setMessages([{ id: nextId("a"), role: "assistant", text: HISTORY_ERROR_REPLY, status: "error" }]);
      } finally {
        if (conversationRef.current === conversation) setOpeningThread(false);
      }
    },
    [messages.length],
  );

  const deleteThread = useCallback(
    async (id: string) => {
      setThreads((prev) => prev.filter((t) => t.thread_id !== id));
      if (id === threadIdRef.current) newChat();
      try {
        await deleteChatThread(id);
      } catch {
        void loadThreads(); // put it back if the delete failed on the server
      }
    },
    [loadThreads, newChat],
  );

  const clearAll = useCallback(async () => {
    setThreads([]);
    newChat();
    try {
      await clearChatHistory();
    } catch {
      void loadThreads();
    }
  }, [loadThreads, newChat]);

  return {
    messages,
    threadId,
    threads,
    threadsState,
    pending,
    openingThread,
    loadThreads,
    send,
    retry,
    stop,
    newChat,
    openThread,
    deleteThread,
    clearAll,
  };
}

/** Today / Yesterday / Previous 7 days / Previous 30 days / Older, newest first. */
export function groupThreads(threads: ThreadSummary[], now = new Date()): { label: string; threads: ThreadSummary[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const buckets: [string, number][] = [
    ["Today", startOfToday],
    ["Yesterday", startOfToday - day],
    ["Previous 7 days", startOfToday - 7 * day],
    ["Previous 30 days", startOfToday - 30 * day],
    ["Older", -Infinity],
  ];
  const out = buckets.map(([label]) => ({ label, threads: [] as ThreadSummary[] }));
  for (const t of threads) {
    const time = new Date(t.updated_at).getTime();
    const index = buckets.findIndex(([, from]) => time >= from);
    out[index === -1 ? out.length - 1 : index].threads.push(t);
  }
  return out.filter((g) => g.threads.length);
}
