import { useEffect, useRef, useState } from "react";
import { X, Send, GripHorizontal, Plus, MessageSquare, Trash2, Settings, Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import {
  sendChatMessage,
  listChatThreads,
  getChatThreadMessages,
  deleteChatThread,
  clearChatHistory,
  type ChatBlock,
  type ThreadSummary,
} from "@/services/chatboxService";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const MASCOT_SRC = "/carecliq-bot-quill-animated.svg";
const BTN_SIZE = 60;
// Panel sizes to at least half the viewport, never smaller than these floors.
const MIN_PANEL_W = 340;
const MIN_PANEL_H = 460;
const MARGIN = 16;
const SIDEBAR_W = 220;

type ChatMessage = { id: string; role: "bot" | "user"; text: string; blocks?: ChatBlock[] };

function StatBlockView({ block }: { block: Extract<ChatBlock, { type: "stat" }> }) {
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: BORDER, background: "var(--cc-bg)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{block.label}</p>
      <p className="text-[18px] font-black leading-tight" style={{ color: PLUM }}>
        {block.value ?? "—"}
        {block.target != null && (
          <span className="text-[11px] font-semibold" style={{ color: MUTED }}> / {block.target} target</span>
        )}
      </p>
    </div>
  );
}

function TableBlockView({ block }: { block: Extract<ChatBlock, { type: "table" }> }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: BORDER }}>
      <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{block.title}</p>
      <div className="overflow-x-auto px-2 pb-2 pt-1">
        <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {block.columns.map((c) => (
                <th key={c} className="text-left font-bold px-1.5 py-1" style={{ color: TEXT, borderBottom: `1px solid ${BORDER}` }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="px-1.5 py-1" style={{ color: TEXT, borderBottom: `1px solid ${BORDER}` }}>
                    {cell ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BarChartBlockView({ block }: { block: Extract<ChatBlock, { type: "bar_chart" }> }) {
  const seriesKey = block.series[0]?.key;
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: BORDER }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: MUTED }}>{block.title}</p>
      <div style={{ width: "100%", height: 120 }}>
        <ResponsiveContainer>
          <BarChart data={block.data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
            <XAxis dataKey={block.x_key} tick={{ fontSize: 10, fill: MUTED }} axisLine={{ stroke: BORDER }} tickLine={false} />
            <Tooltip
              contentStyle={{ fontSize: 11, background: "var(--cc-bg)", border: `1px solid ${BORDER}`, borderRadius: 8 }}
            />
            {seriesKey && <Bar dataKey={seriesKey} fill={PLUM} radius={[4, 4, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DownloadBlockView({ block }: { block: Extract<ChatBlock, { type: "download" }> }) {
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-black/5"
      style={{ borderColor: BORDER, color: PLUM, background: "var(--cc-bg)" }}
    >
      <Download size={14} className="shrink-0" />
      <span className="flex-1 truncate">{block.title}</span>
      {block.count != null && (
        <span className="shrink-0 text-[10px] font-semibold" style={{ color: MUTED }}>
          {block.count} file{block.count === 1 ? "" : "s"}
        </span>
      )}
    </a>
  );
}

function BlockView({ block }: { block: ChatBlock }) {
  if (block.type === "stat") return <StatBlockView block={block} />;
  if (block.type === "table") return <TableBlockView block={block} />;
  if (block.type === "bar_chart") return <BarChartBlockView block={block} />;
  if (block.type === "download") return <DownloadBlockView block={block} />;
  return null;
}

/** Renders `**bold**` markers from Quill's replies as real <strong> text —
 * intentionally minimal, not a full markdown parser, since the model is only
 * ever instructed to use this one marker for emphasis. */
function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function formatThreadDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const LOADING_PHRASES = ["Thinking", "Looking that up", "Checking the data", "Putting it together", "Almost there"];

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "bot",
  text: "Hi, I'm the CareCliQ Assistant. I can help you look up participants, check compliance status, summarise a shift or draft a note. This is an early preview — I can't take real actions yet.",
};

const SUGGESTIONS = [
  "Who's on shift right now?",
  "Any compliance items expiring soon?",
  "Summarise today's incidents",
];

const CHAT_ERROR_REPLY = "Sorry, I couldn't get that data right now — please try again in a moment.";
const HISTORY_ERROR_REPLY = "Sorry, I couldn't load that conversation right now.";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function FloatingAiAssistant() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState(LOADING_PHRASES[0]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const dragState = useRef<{ dragging: boolean; moved: boolean; offsetX: number; offsetY: number }>({
    dragging: false, moved: false, offsetX: 0, offsetY: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const isFreshConversation = messages.length === 1 && messages[0].id === "welcome";

  // Autofocus the input each time the panel opens, so a coordinator can start typing immediately.
  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Load the thread list the first time the panel is opened.
  useEffect(() => {
    if (!open || threadsLoaded) return;
    setThreadsLoaded(true);
    listChatThreads()
      .then(setThreads)
      .catch(() => setThreads([]));
  }, [open, threadsLoaded]);

  // Default to bottom-right on first mount, leaving room for the mobile bottom nav.
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    setPos({
      x: window.innerWidth - BTN_SIZE - MARGIN,
      y: window.innerHeight - BTN_SIZE - MARGIN - (isMobile ? 74 : 0),
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (!sending) return;
    setLoadingPhrase(LOADING_PHRASES[0]);
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % LOADING_PHRASES.length;
      setLoadingPhrase(LOADING_PHRASES[i]);
    }, 1600);
    return () => clearInterval(interval);
  }, [sending]);

  // Close the settings popover on an outside click.
  useEffect(() => {
    if (!settingsOpen) return;
    function onClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [settingsOpen]);

  function clampToViewport(x: number, y: number) {
    return {
      x: clamp(x, MARGIN, window.innerWidth - BTN_SIZE - MARGIN),
      y: clamp(y, MARGIN, window.innerHeight - BTN_SIZE - MARGIN),
    };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!pos) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      dragging: true,
      moved: false,
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.offsetX;
    const dy = e.clientY - dragState.current.offsetY;
    dragState.current.moved = true;
    setPos(clampToViewport(dx, dy));
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragState.current.dragging) return;
    const wasDrag = dragState.current.moved;
    dragState.current.dragging = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (!wasDrag) setOpen((v) => !v);
  }

  function refreshThreads() {
    listChatThreads().then(setThreads).catch(() => {});
  }

  function startNewChat() {
    if (sending) return;
    setThreadId(undefined);
    setMessages([WELCOME_MESSAGE]);
    setDraft("");
  }

  async function handleDeleteThread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    setThreads((prev) => prev.filter((t) => t.thread_id !== id));
    if (id === threadId) startNewChat();
    try {
      await deleteChatThread(id);
    } catch {
      refreshThreads(); // put it back in the list if the delete actually failed server-side
    }
  }

  async function handleClearHistory() {
    if (!window.confirm("Clear all conversation history? This deletes every past chat and can't be undone.")) return;
    setSettingsOpen(false);
    setThreads([]);
    startNewChat();
    try {
      await clearChatHistory();
    } catch {
      refreshThreads(); // restore the list if the delete actually failed server-side
    }
  }

  async function openThread(id: string) {
    if (sending || id === threadId) return;
    setThreadId(id);
    setSending(true);
    try {
      const history = await getChatThreadMessages(id);
      setMessages(
        history.map((m, i) => ({
          id: `${id}-${i}`,
          role: m.role === "assistant" ? "bot" : "user",
          text: m.content,
        })),
      );
    } catch {
      setMessages([{ id: `err-${Date.now()}`, role: "bot", text: HISTORY_ERROR_REPLY }]);
    } finally {
      setSending(false);
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const wasNewThread = !threadId;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: trimmed }]);
    setDraft("");
    setSending(true);
    try {
      const { reply, thread_id, blocks } = await sendChatMessage(trimmed, threadId);
      setThreadId(thread_id);
      setMessages((prev) => [...prev, { id: `b-${Date.now()}`, role: "bot", text: reply, blocks }]);
      if (wasNewThread) refreshThreads();
    } catch {
      setMessages((prev) => [...prev, { id: `b-${Date.now()}`, role: "bot", text: CHAT_ERROR_REPLY }]);
    } finally {
      setSending(false);
    }
  }

  if (!pos) return null;

  const openUpward = pos.y > window.innerHeight / 2;
  const openLeftward = pos.x > window.innerWidth / 2;

  // At least half the viewport in each dimension, never smaller than the floor.
  const PANEL_W = Math.max(MIN_PANEL_W, Math.round(window.innerWidth * 0.7));
  const PANEL_H = Math.max(MIN_PANEL_H, Math.round(window.innerHeight * 0.9));

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    width: PANEL_W,
    maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
    height: PANEL_H,
    maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
    ...(openLeftward
      ? { right: clamp(window.innerWidth - pos.x - BTN_SIZE, MARGIN, window.innerWidth - PANEL_W - MARGIN) }
      : { left: clamp(pos.x, MARGIN, window.innerWidth - PANEL_W - MARGIN) }),
    ...(openUpward
      ? { bottom: clamp(window.innerHeight - pos.y + 12, MARGIN, window.innerHeight - PANEL_H - MARGIN) }
      : { top: clamp(pos.y + BTN_SIZE + 12, MARGIN, window.innerHeight - PANEL_H - MARGIN) }),
  };

  return (
    <>
      {open && (
        <div
          className="z-[110] flex flex-col overflow-hidden rounded-3xl border shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
          style={{ ...panelStyle, background: "var(--cc-bg)", borderColor: BORDER }}
          role="dialog"
          aria-label="CareCliQ AI Assistant (demo)"
        >
          {/* Header — solid plum, no gradient */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{ background: PLUM }}
          >
            <span className="relative h-11 w-11 shrink-0">
              <span className="flex h-full w-full overflow-hidden rounded-2xl shadow-md">
                <img src={MASCOT_SRC} alt="Quill" className="h-full w-full" draggable={false} />
              </span>
              <span
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
                style={{ background: "#22C55E", borderColor: "#fff" }}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-black text-white leading-tight tracking-tight">Quill</p>
              <p className="text-[10px] font-semibold text-white/70">CareCliQ Assistant · Demo</p>
            </div>
            <div className="relative shrink-0" ref={settingsRef}>
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                aria-label="Chat settings"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15"
              >
                <Settings size={15} />
              </button>
              {settingsOpen && (
                <div
                  className="absolute right-0 top-9 z-10 w-44 rounded-xl border shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-150"
                  style={{ background: "var(--cc-bg)", borderColor: BORDER }}
                >
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-semibold text-left transition-colors hover:bg-black/5"
                    style={{ color: "#DC2626" }}
                  >
                    <Trash2 size={13} /> Clear history
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* Sidebar — conversation history */}
            <aside
              className="flex flex-col shrink-0 border-r"
              style={{ width: SIDEBAR_W, borderColor: BORDER, background: "var(--cc-soft)" }}
            >
              <div className="p-2 shrink-0">
                <button
                  type="button"
                  onClick={startNewChat}
                  className="flex w-full items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-bold transition-colors"
                  style={{ borderColor: BORDER, color: PLUM, background: "var(--cc-bg)" }}
                >
                  <Plus size={14} /> New chat
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
                {threads.length === 0 && (
                  <p className="px-1.5 py-2 text-[11px]" style={{ color: MUTED }}>
                    {threadsLoaded ? "No past conversations yet." : "Loading…"}
                  </p>
                )}
                {threads.map((t) => {
                  const active = t.thread_id === threadId;
                  return (
                    <div
                      key={t.thread_id}
                      className="group flex w-full items-center gap-0.5 rounded-lg transition-colors"
                      style={{ background: active ? "var(--cc-plum-soft, rgba(232,69,122,0.08))" : "transparent" }}
                    >
                      <button
                        type="button"
                        onClick={() => openThread(t.thread_id)}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left"
                      >
                        <span className="flex w-full items-center gap-1 text-[11.5px] font-semibold truncate" style={{ color: active ? PLUM : TEXT }}>
                          <MessageSquare size={11} className="shrink-0" />
                          <span className="truncate">{t.title || "New conversation"}</span>
                        </span>
                        <span className="text-[10px]" style={{ color: MUTED }}>{formatThreadDate(t.updated_at)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteThread(t.thread_id, e)}
                        aria-label="Delete conversation"
                        className="shrink-0 rounded-md p-1.5 mr-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/5"
                        style={{ color: MUTED }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </aside>

            {/* Main chat column */}
            <div className="flex flex-1 min-w-0 flex-col">
              {/* Messages */}
              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {/* Welcome mascot display — shown only before any user message */}
                {isFreshConversation && (
                  <div className="flex flex-col items-center pt-2 pb-3 animate-in fade-in-0 duration-300">
                    <div className="h-20 w-20 rounded-3xl overflow-hidden shadow-sm mb-2" style={{ border: `2px solid ${BORDER}` }}>
                      <img src={MASCOT_SRC} alt="Quill" className="h-full w-full" draggable={false} />
                    </div>
                    <p className="text-[11px] font-semibold text-center" style={{ color: MUTED }}>
                      Hi! I'm Quill, your NDIS care assistant.
                    </p>
                  </div>
                )}

                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-start gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {m.role === "bot" && (
                      <span className="mb-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full shadow-sm" style={{ border: `1.5px solid ${BORDER}` }}>
                        <img src={MASCOT_SRC} alt="" className="h-full w-full" draggable={false} />
                      </span>
                    )}
                    <div className={`flex flex-col gap-1.5 ${m.role === "user" ? "items-end" : "items-start"} ${m.blocks?.length ? "w-full max-w-[92%]" : "max-w-[78%]"}`}>
                      <div
                        className="rounded-2xl px-3 py-2 text-[12.5px] leading-snug"
                        style={
                          m.role === "user"
                            ? { background: CORAL, color: "#fff" }
                            : { background: "var(--cc-soft)", color: TEXT, border: `1px solid ${BORDER}` }
                        }
                      >
                        {m.role === "bot" ? <BoldText text={m.text} /> : m.text}
                      </div>
                      {m.blocks?.map((b, i) => <BlockView key={i} block={b} />)}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex items-end justify-start gap-2 animate-in fade-in-0 duration-200">
                    <span
                      className="mb-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full shadow-sm animate-bounce"
                      style={{ border: `1.5px solid ${BORDER}` }}
                    >
                      <img src={MASCOT_SRC} alt="" className="h-full w-full" draggable={false} />
                    </span>
                    <div
                      className="flex items-center rounded-2xl px-3 py-2.5"
                      style={{ background: "var(--cc-soft)", border: `1px solid ${BORDER}` }}
                    >
                      <span className="text-[11.5px] font-medium" style={{ color: MUTED }}>
                        {loadingPhrase}…
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Suggestions */}
              {isFreshConversation && (
                <div className="shrink-0 animate-in fade-in-0 duration-300 px-3 pb-2">
                  <p className="pb-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                    Try asking
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => sendMessage(s)}
                        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                        style={{ background: "transparent", color: PLUM, borderColor: BORDER }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--cc-plum-soft, rgba(232,69,122,0.08))";
                          e.currentTarget.style.borderColor = PLUM;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderColor = BORDER;
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input */}
              <div className="flex items-center gap-2 border-t px-3 py-2.5 shrink-0" style={{ borderColor: BORDER }}>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage(draft)}
                  placeholder="Ask Quill anything..."
                  className="flex-1 rounded-full border px-3.5 py-2 text-[12.5px] outline-none transition-colors focus:border-[var(--cc-plum)]"
                  style={{ borderColor: BORDER, color: TEXT, background: "var(--cc-surface)" }}
                />
                <button
                  type="button"
                  onClick={() => sendMessage(draft)}
                  disabled={!draft.trim() || sending}
                  aria-label="Send message"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
                  style={{ background: CORAL }}
                >
                  <Send size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating launcher — draggable, full circle, click to toggle */}
      <button
        type="button"
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="fixed z-[110] flex items-center justify-center shadow-xl transition-transform active:scale-95 touch-none select-none"
        style={{
          left: pos.x,
          top: pos.y,
          width: BTN_SIZE,
          height: BTN_SIZE,
          borderRadius: "50%",
          background: open ? PLUM : "var(--cc-bg)",
          border: `2px solid ${open ? PLUM : BORDER}`,
          cursor: dragState.current.dragging ? "grabbing" : "grab",
        }}
      >
        {open ? (
          <X size={22} color="#fff" />
        ) : (
          <span className="h-full w-full overflow-hidden rounded-full">
            <img src={MASCOT_SRC} alt="" className="h-full w-full" draggable={false} />
          </span>
        )}
        {!open && (
          <span
            className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full border-2"
            style={{ background: "#22C55E", borderColor: "var(--cc-bg)" }}
          />
        )}
        {!open && <GripHorizontal size={8} className="absolute bottom-1" style={{ color: BORDER }} />}
      </button>
    </>
  );
}
