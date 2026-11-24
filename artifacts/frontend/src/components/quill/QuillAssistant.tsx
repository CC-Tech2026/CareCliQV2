import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  History,
  Maximize2,
  Minimize2,
  PanelLeft,
  RotateCcw,
  Search,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { ThreadSummary } from "@/services/chatboxService";
import { QuillBlocks, tableAsText, type QuillSize } from "./QuillBlocks";
import { QuillText, plainText } from "./QuillText";
import { QuillWordmark } from "./QuillWordmark";
import { groupThreads, useQuillChat, type QuillMessage } from "./useQuillChat";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const LINK = "var(--cc-plum)";
const CTA = "var(--cc-cta)";
const SELECTED_BG = "var(--cc-brand-purple-soft)";
const SELECTED_TEXT = "var(--cc-brand-purple)";
const DISPLAY = "var(--app-font-display)";

// The bot on its own, without the ivory tile, so it sits beside the lettering.
const MASCOT_SRC = "/carecliq-bot-quill-mark.svg";
const BTN_SIZE = 56;
const MARGIN = 16;
const PANEL_W = 420;
const PANEL_H = 680;
const MODE_KEY = "quill.full-screen";

const DIRECTOR_STARTERS = [
  "How are we tracking financially this month?",
  "What needs my attention this week?",
  "Which credentials expire in the next 30 days?",
  "Who's on shift right now?",
];

const COORDINATOR_STARTERS = [
  "Who's on shift right now?",
  "Which credentials expire in the next 30 days?",
  "How many incidents are open?",
  "What shifts are on tomorrow?",
];

const THINKING = ["Looking that up", "Checking the records", "Putting it together"];

type Mode = "closed" | "panel" | "full";

// Quill is mounted by both page shells. If a page ever renders one shell
// inside another, only the first copy shows, so there is never a second
// launcher sitting on top of the first.
let activeInstance: symbol | null = null;

function useIsActiveInstance(): boolean {
  const [id] = useState(() => Symbol("quill"));
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (activeInstance === null) {
      activeInstance = id;
      setActive(true);
    }
    return () => {
      if (activeInstance === id) activeInstance = null;
    };
  }, [id]);
  return active;
}

function useIsNarrow(): boolean {
  const query = "(max-width: 767px)";
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return narrow;
}

function readFullScreenPreference(): boolean {
  try {
    return window.localStorage.getItem(MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFullScreenPreference(full: boolean) {
  try {
    window.localStorage.setItem(MODE_KEY, full ? "1" : "0");
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}

function greeting(name: string | undefined, now = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = (name || "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function QuillAssistant() {
  const { user } = useAuth();
  const isDirector = user?.role === "managing_director";
  const starters = isDirector ? DIRECTOR_STARTERS : COORDINATOR_STARTERS;
  const isActiveInstance = useIsActiveInstance();
  const narrow = useIsNarrow();
  const chat = useQuillChat();

  const [mode, setMode] = useState<Mode>("closed");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false); // the panel's history list, and the full screen's sidebar on phones
  const [sidebarOpen, setSidebarOpen] = useState(true); // the full screen's sidebar on wider screens
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const drag = useRef({ dragging: false, moved: false, offsetX: 0, offsetY: 0 });

  // On a phone the panel would be too small to read, so Quill opens full screen there.
  const view: Mode = mode === "panel" && narrow ? "full" : mode;
  const size: QuillSize = view === "full" && !narrow ? "full" : "compact";

  useEffect(() => {
    setPos({
      x: window.innerWidth - BTN_SIZE - MARGIN,
      y: window.innerHeight - BTN_SIZE - MARGIN - (window.innerWidth < 768 ? 74 : 0),
    });
  }, []);

  const { loadThreads, threadsState } = chat;
  useEffect(() => {
    if (view !== "closed" && threadsState === "idle") void loadThreads();
  }, [view, threadsState, loadThreads]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (view !== "closed") focusInput();
  }, [view, focusInput]);

  const close = useCallback(() => {
    setMode("closed");
    setHistoryOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  const setFullScreen = useCallback((full: boolean) => {
    writeFullScreenPreference(full);
    setHistoryOpen(false);
    setMode(full ? "full" : "panel");
  }, []);

  // Esc steps back: out of full screen to the panel, then closed.
  useEffect(() => {
    if (view === "closed") return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (historyOpen) setHistoryOpen(false);
      else if (view === "full" && !narrow) setFullScreen(false);
      else close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, narrow, historyOpen, close, setFullScreen]);

  // The page behind a full-screen Quill shouldn't scroll.
  useEffect(() => {
    if (view !== "full") return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [view]);

  function toggleFromLauncher() {
    if (mode === "closed") setMode(readFullScreenPreference() ? "full" : "panel");
    else close();
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!pos) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { dragging: true, moved: false, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag.current.dragging) return;
    const x = e.clientX - drag.current.offsetX;
    const y = e.clientY - drag.current.offsetY;
    if (pos && Math.abs(x - pos.x) + Math.abs(y - pos.y) > 3) drag.current.moved = true;
    setPos({
      x: clamp(x, MARGIN, window.innerWidth - BTN_SIZE - MARGIN),
      y: clamp(y, MARGIN, window.innerHeight - BTN_SIZE - MARGIN),
    });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag.current.dragging) return;
    const wasDrag = drag.current.moved;
    drag.current.dragging = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!wasDrag) toggleFromLauncher();
  }

  function submit(text: string) {
    if (!text.trim() || chat.pending) return;
    chat.send(text);
    setDraft("");
    focusInput();
  }

  function startNewChat() {
    chat.newChat();
    setDraft("");
    setHistoryOpen(false);
    focusInput();
  }

  function openThread(id: string) {
    void chat.openThread(id);
    setHistoryOpen(false);
    focusInput();
  }

  function deleteThread(id: string) {
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    void chat.deleteThread(id);
  }

  function clearAll() {
    if (!window.confirm("Delete every past conversation? This can't be undone.")) return;
    void chat.clearAll();
  }

  const title = useMemo(() => {
    const listed = chat.threads.find((t) => t.thread_id === chat.threadId)?.title;
    if (listed) return listed;
    const firstQuestion = chat.messages.find((m) => m.role === "user")?.text;
    return firstQuestion || "New conversation";
  }, [chat.threads, chat.threadId, chat.messages]);

  if (!pos || !isActiveInstance) return null;

  const history = (
    <HistoryList
      threads={chat.threads}
      state={chat.threadsState}
      activeId={chat.threadId}
      onOpen={openThread}
      onDelete={deleteThread}
      onRetry={() => void chat.loadThreads()}
    />
  );

  const conversation = (
    <Conversation
      messages={chat.messages}
      pending={chat.pending}
      opening={chat.openingThread}
      size={size}
      greeting={greeting(user?.full_name)}
      isDirector={isDirector}
      starters={starters}
      onAsk={submit}
      onRetry={chat.retry}
    />
  );

  const composer = (
    <Composer
      inputRef={inputRef}
      value={draft}
      onChange={setDraft}
      onSubmit={() => submit(draft)}
      onStop={chat.stop}
      pending={chat.pending}
      size={size}
    />
  );

  return (
    <>
      {view === "panel" && (
        <div
          role="dialog"
          aria-label="Quill, the CareCliQ assistant"
          className="fixed z-[110] flex flex-col overflow-hidden rounded-2xl border animate-in fade-in-0 zoom-in-95 duration-150"
          style={{ ...panelPosition(pos), background: SURFACE, borderColor: BORDER, boxShadow: "0 12px 40px rgba(26,26,46,0.16)" }}
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: BORDER }}>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Mascot size={34} />
              <span className="shrink-0" style={{ color: TEXT }}>
                <QuillWordmark height={22} />
              </span>
              <span className="mx-1.5 h-4 w-px shrink-0" style={{ background: BORDER }} aria-hidden="true" />
              <p className="min-w-0 truncate text-[12px]" style={{ color: MUTED }}>
                {historyOpen ? "Past conversations" : title}
              </p>
            </div>
            <HeaderButton label={historyOpen ? "Back to the conversation" : "Past conversations"} active={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
              <History size={16} />
            </HeaderButton>
            <HeaderButton label="New chat" onClick={startNewChat}>
              <SquarePen size={16} />
            </HeaderButton>
            <HeaderButton label="Full screen" onClick={() => setFullScreen(true)}>
              <Maximize2 size={15} />
            </HeaderButton>
            <HeaderButton label="Close Quill" onClick={close}>
              <X size={17} />
            </HeaderButton>
          </header>
          {historyOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {history}
              <ClearAllButton onClick={clearAll} disabled={!chat.threads.length} />
            </div>
          ) : (
            <>
              {conversation}
              {composer}
            </>
          )}
        </div>
      )}

      {view === "full" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quill, the CareCliQ assistant"
          className="fixed inset-0 z-[120] flex animate-in fade-in-0 duration-150"
          style={{ background: SURFACE }}
        >
          {/* Sidebar: always beside the conversation on wide screens, a drawer on phones. */}
          {(narrow ? historyOpen : sidebarOpen) && (
            <>
              {narrow && (
                <button
                  type="button"
                  aria-label="Close past conversations"
                  className="fixed inset-0 z-[1] cursor-default"
                  style={{ background: "rgba(26,26,46,0.35)" }}
                  onClick={() => setHistoryOpen(false)}
                />
              )}
              <aside
                className={`flex w-[272px] shrink-0 flex-col border-r ${narrow ? "fixed inset-y-0 left-0 z-[2]" : ""}`}
                style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
                aria-label="Past conversations"
              >
                <div className="flex h-14 items-center gap-2 px-3">
                  <span className="flex flex-1 items-center gap-1.5" style={{ color: TEXT }}>
                    <Mascot size={38} />
                    <QuillWordmark height={26} />
                  </span>
                  <HeaderButton
                    label="Hide past conversations"
                    onClick={() => (narrow ? setHistoryOpen(false) : setSidebarOpen(false))}
                  >
                    <PanelLeft size={16} />
                  </HeaderButton>
                </div>
                <div className="px-3 pb-2">
                  <button
                    type="button"
                    onClick={startNewChat}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: CTA }}
                  >
                    <SquarePen size={15} /> New chat
                  </button>
                </div>
                {history}
                <ClearAllButton onClick={clearAll} disabled={!chat.threads.length} />
              </aside>
            </>
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4" style={{ borderColor: BORDER }}>
              {(narrow || !sidebarOpen) && (
                <HeaderButton
                  label="Show past conversations"
                  onClick={() => (narrow ? setHistoryOpen(true) : setSidebarOpen(true))}
                >
                  <PanelLeft size={16} />
                </HeaderButton>
              )}
              {(narrow || !sidebarOpen) && (
                <HeaderButton label="New chat" onClick={startNewChat}>
                  <SquarePen size={16} />
                </HeaderButton>
              )}
              <p className="min-w-0 flex-1 truncate px-1 text-[14px] font-semibold" style={{ color: TEXT, fontFamily: DISPLAY }}>
                {title}
              </p>
              {!narrow && (
                <HeaderButton label="Exit full screen" onClick={() => setFullScreen(false)}>
                  <Minimize2 size={15} />
                </HeaderButton>
              )}
              <HeaderButton label="Close Quill" onClick={close}>
                <X size={17} />
              </HeaderButton>
            </header>
            {conversation}
            {composer}
          </main>
        </div>
      )}

      {view !== "full" && (
        <button
          ref={launcherRef}
          type="button"
          aria-label={view === "closed" ? "Open AI assistant" : "Close AI assistant"}
          aria-expanded={view !== "closed"}
          title="Quill. Drag to move."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleFromLauncher();
            }
          }}
          className="fixed z-[110] flex touch-none select-none items-center justify-center rounded-full border transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            left: pos.x,
            top: pos.y,
            width: BTN_SIZE,
            height: BTN_SIZE,
            background: view === "closed" ? SURFACE : CTA,
            borderColor: view === "closed" ? BORDER : CTA,
            boxShadow: "0 6px 20px rgba(26,26,46,0.18)",
            cursor: drag.current.dragging ? "grabbing" : "grab",
            ["--tw-ring-color" as string]: LINK,
          }}
        >
          {view === "closed" ? (
            <img src={MASCOT_SRC} alt="" className="block h-[44px] w-[44px]" draggable={false} />
          ) : (
            <X size={22} color="#fff" />
          )}
        </button>
      )}
    </>
  );
}

/** Opens beside the launcher, towards whichever side of the screen has room. */
function panelPosition(pos: { x: number; y: number }): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_W, vw - MARGIN * 2);
  const height = Math.min(PANEL_H, vh - MARGIN * 2);
  const openLeft = pos.x > vw / 2;
  const openUp = pos.y > vh / 2;
  return {
    width,
    height,
    ...(openLeft
      ? { right: clamp(vw - pos.x - BTN_SIZE, MARGIN, vw - width - MARGIN) }
      : { left: clamp(pos.x, MARGIN, vw - width - MARGIN) }),
    ...(openUp
      ? { bottom: clamp(vh - pos.y + 12, MARGIN, vh - height - MARGIN) }
      : { top: clamp(pos.y + BTN_SIZE + 12, MARGIN, vh - height - MARGIN) }),
  };
}

function Mascot({ size }: { size: number }) {
  return (
    <img
      src={MASCOT_SRC}
      alt=""
      width={size}
      height={size}
      className="block shrink-0"
      style={{ width: size, height: size, minWidth: size }}
      draggable={false}
    />
  );
}

function HeaderButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--cc-soft)] focus-visible:outline-none focus-visible:ring-2"
      style={{
        color: active ? SELECTED_TEXT : MUTED,
        background: active ? SELECTED_BG : undefined,
        ["--tw-ring-color" as string]: LINK,
      }}
    >
      {children}
    </button>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

function HistoryList({
  threads,
  state,
  activeId,
  onOpen,
  onDelete,
  onRetry,
}: {
  threads: ThreadSummary[];
  state: "idle" | "loading" | "ready" | "error";
  activeId?: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? threads.filter((t) => (t.title || "").toLowerCase().includes(q)) : threads;
  }, [threads, query]);
  const groups = useMemo(() => groupThreads(filtered), [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-1">
        <label className="flex h-9 items-center gap-2 rounded-lg border px-2.5" style={{ borderColor: BORDER, background: SURFACE }}>
          <Search size={14} style={{ color: MUTED }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
            style={{ color: TEXT }}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {state === "loading" && !threads.length && (
          <p className="px-2 py-3 text-[12px]" style={{ color: MUTED }}>
            Loading conversations...
          </p>
        )}
        {state === "error" && (
          <p className="px-2 py-3 text-[12px]" style={{ color: MUTED }}>
            Couldn't load past conversations.{" "}
            <button type="button" onClick={onRetry} className="font-semibold hover:underline" style={{ color: LINK }}>
              Try again
            </button>
          </p>
        )}
        {state === "ready" && !threads.length && (
          <p className="px-2 py-3 text-[12px]" style={{ color: MUTED }}>
            Your conversations with Quill will appear here.
          </p>
        )}
        {state === "ready" && threads.length > 0 && !filtered.length && (
          <p className="px-2 py-3 text-[12px]" style={{ color: MUTED }}>
            No conversations match "{query.trim()}".
          </p>
        )}
        {groups.map((g) => (
          <section key={g.label} className="mb-2">
            <h3 className="px-2 pb-1 pt-2 text-[11px] font-semibold" style={{ color: MUTED }}>
              {g.label}
            </h3>
            <ul>
              {g.threads.map((t) => {
                const active = t.thread_id === activeId;
                return (
                  <li key={t.thread_id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onOpen(t.thread_id)}
                      aria-current={active ? "true" : undefined}
                      className="block w-full truncate rounded-lg py-2 pl-2.5 pr-9 text-left text-[12.5px] transition-colors hover:bg-[var(--cc-soft)]"
                      style={{ color: active ? SELECTED_TEXT : TEXT, background: active ? SELECTED_BG : undefined, fontWeight: active ? 600 : 400 }}
                      title={t.title || "New conversation"}
                    >
                      {t.title || "New conversation"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(t.thread_id)}
                      aria-label={`Delete "${t.title || "conversation"}"`}
                      className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-black/5 focus-visible:opacity-100 group-hover:opacity-100"
                      style={{ color: MUTED }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ClearAllButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <div className="border-t px-3 py-2" style={{ borderColor: BORDER }}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md px-1 py-1 text-[12px] font-medium transition-opacity hover:underline disabled:opacity-40 disabled:no-underline"
        style={{ color: "var(--cc-danger-text)" }}
      >
        <Trash2 size={13} /> Delete all conversations
      </button>
    </div>
  );
}

// ── Conversation ─────────────────────────────────────────────────────────────

function Conversation({
  messages,
  pending,
  opening,
  size,
  greeting: hello,
  isDirector,
  starters,
  onAsk,
  onRetry,
}: {
  messages: QuillMessage[];
  pending: boolean;
  opening: boolean;
  size: QuillSize;
  greeting: string;
  isDirector: boolean;
  starters: string[];
  onAsk: (text: string) => void;
  onRetry: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const full = size === "full";

  useEffect(() => {
    const el = scrollRef.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, opening]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className={`mx-auto w-full ${full ? "max-w-[768px] px-6 py-8" : "px-4 py-4"}`}>
        {opening && (
          <p className="py-6 text-center text-[12.5px]" style={{ color: MUTED }}>
            Opening conversation...
          </p>
        )}

        {!opening && !messages.length && (
          <EmptyState full={full} hello={hello} isDirector={isDirector} starters={starters} onAsk={onAsk} />
        )}

        <div className={full ? "space-y-7" : "space-y-5"} aria-live="polite">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2 ${full ? "text-[14.5px]" : "text-[13px]"} leading-relaxed`}
                  style={{ background: SOFT, color: TEXT }}
                >
                  {m.text}
                </div>
              </div>
            ) : (
              <AnswerView
                key={m.id}
                message={m}
                size={size}
                showFollowUps={m === lastAssistant && !pending}
                onAsk={onAsk}
                onRetry={onRetry}
              />
            ),
          )}
          {pending && <Thinking />}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  full,
  hello,
  isDirector,
  starters,
  onAsk,
}: {
  full: boolean;
  hello: string;
  isDirector: boolean;
  starters: string[];
  onAsk: (text: string) => void;
}) {
  return (
    <div className={full ? "pt-[8vh]" : "pt-2"}>
      <Mascot size={full ? 64 : 52} />
      <h2
        className={`mt-3 font-semibold ${full ? "text-[26px]" : "text-[19px]"} leading-tight`}
        style={{ color: TEXT, fontFamily: DISPLAY }}
      >
        {hello}
      </h2>
      <p className={`mt-1.5 ${full ? "text-[14.5px]" : "text-[13px]"} leading-relaxed`} style={{ color: MUTED }}>
        {isDirector
          ? "Ask me how the organisation is going: finances, participants and their funding, the roster, compliance, credentials and incidents. I look up the live figures for you. I can read your data but I can't change anything."
          : "Ask me about your participants, the roster, compliance, credentials and incidents, and I'll look up the live figures. I can read your data but I can't change anything."}
      </p>
      <p className="mb-1.5 mt-5 text-[11.5px] font-semibold" style={{ color: MUTED }}>
        Try asking
      </p>
      <ul className="divide-y overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
        {starters.map((s) => (
          <li key={s} style={{ borderColor: BORDER }}>
            <button
              type="button"
              onClick={() => onAsk(s)}
              className={`group flex w-full items-center gap-3 px-3.5 text-left transition-colors hover:bg-[var(--cc-soft)] ${full ? "py-3 text-[14px]" : "py-2.5 text-[13px]"}`}
              style={{ color: TEXT }}
            >
              <span className="flex-1">{s}</span>
              <ArrowUpRight size={15} className="shrink-0 transition-colors group-hover:text-[var(--cc-plum)]" style={{ color: MUTED }} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerView({
  message,
  size,
  showFollowUps,
  onAsk,
  onRetry,
}: {
  message: QuillMessage;
  size: QuillSize;
  showFollowUps: boolean;
  onAsk: (text: string) => void;
  onRetry: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const full = size === "full";

  async function copy() {
    const tables = (message.blocks ?? []).flatMap((b) => (b.type === "table" ? [tableAsText(b)] : []));
    try {
      await navigator.clipboard.writeText([plainText(message.text), ...tables].join("\n\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex gap-3">
      <div className="pt-0.5">
        <Mascot size={full ? 32 : 28} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div
          className={`${full ? "text-[14.5px]" : "text-[13px]"} leading-relaxed`}
          style={{ color: message.status === "stopped" ? MUTED : TEXT }}
        >
          <QuillText text={message.text} />
        </div>

        {message.blocks && message.blocks.length > 0 && <QuillBlocks blocks={message.blocks} size={size} />}

        <div className="flex flex-wrap items-center gap-1" style={{ color: MUTED }}>
          {message.status && message.question ? (
            <button
              type="button"
              onClick={() => onRetry(message.id)}
              className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors hover:bg-[var(--cc-soft)]"
              style={{ borderColor: BORDER, color: TEXT }}
            >
              <RotateCcw size={13} /> Try again
            </button>
          ) : (
            !message.status && (
              <button
                type="button"
                onClick={copy}
                aria-label={copied ? "Copied" : "Copy answer"}
                title={copied ? "Copied" : "Copy answer"}
                className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] transition-colors hover:bg-[var(--cc-soft)]"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied && <span>Copied</span>}
              </button>
            )
          )}
        </div>

        {showFollowUps && message.suggestions && message.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onAsk(s)}
                className="rounded-full border px-3 py-1.5 text-[12px] transition-colors hover:border-[var(--cc-plum)] hover:text-[var(--cc-plum)]"
                style={{ borderColor: BORDER, color: TEXT, background: SURFACE }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % THINKING.length), 1800);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-3" role="status">
      <Mascot size={28} />
      <span className="flex items-center gap-2 text-[12.5px]" style={{ color: MUTED }}>
        {THINKING[i]}
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="h-1.5 w-1.5 animate-bounce rounded-full"
              style={{ background: MUTED, animationDelay: `${d * 150}ms` }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  inputRef,
  value,
  onChange,
  onSubmit,
  onStop,
  pending,
  size,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  pending: boolean;
  size: QuillSize;
}) {
  const full = size === "full";

  // Grow with the text up to about six lines, then scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value, inputRef]);

  return (
    <div className={`shrink-0 ${full ? "px-6 pb-5" : "border-t px-3 pb-3 pt-3"}`} style={{ borderColor: BORDER }}>
      <form
        className={`mx-auto w-full ${full ? "max-w-[768px]" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div
          className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-shadow focus-within:ring-2"
          style={{ borderColor: BORDER, background: SURFACE, ["--tw-ring-color" as string]: "var(--cc-plum-ring)" }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Ask Quill about your organisation"
            aria-label="Message Quill"
            className={`max-h-[168px] min-h-[24px] flex-1 resize-none bg-transparent py-1 leading-relaxed outline-none ${full ? "text-[14.5px]" : "text-[13px]"}`}
            style={{ color: TEXT }}
          />
          {pending ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop answering"
              title="Stop answering"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: CTA }}
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="Send message"
              title="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-30"
              style={{ background: CTA }}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px]" style={{ color: MUTED }}>
          {full
            ? "Enter to send, Shift + Enter for a new line. Quill can make mistakes, so check important figures where they come from."
            : "Quill can make mistakes. Check important figures where they come from."}
        </p>
      </form>
    </div>
  );
}
