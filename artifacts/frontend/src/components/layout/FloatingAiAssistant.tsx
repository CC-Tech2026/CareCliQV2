import { useEffect, useId, useRef, useState } from "react";
import { X, Send, Sparkles, GripHorizontal } from "lucide-react";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const BTN_SIZE = 56;
const PANEL_W = 340;
const PANEL_H = 440;
const MARGIN = 16;

type ChatMessage = { id: string; role: "bot" | "user"; text: string };

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

const DEMO_REPLY = "Thanks — I'm still a demo preview, so I can't pull live data or take actions yet. This is here to show how the assistant will fit into your day-to-day workflow.";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * CareCliQ's own mascot mark — the small smiling, circuit-node head from the
 * brand logo, redrawn as a standalone glyph so the assistant reads as
 * "CareCliQ's bot" rather than a generic chat-bubble/robot icon.
 */
function CareCliQBotMark({ size = 28 }: { size?: number }) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="5" y1="6" x2="27" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--cc-plum)" }} />
          <stop offset="1" style={{ stopColor: "var(--cc-coral)" }} />
        </linearGradient>
      </defs>
      {/* circuit-node "ears", echoing the shoulder nodes in the CareCliQ wordmark */}
      <path d="M8 12.5 L12.5 16.5" stroke={`url(#${gid})`} strokeWidth="2.1" strokeLinecap="round" />
      <path d="M24 12.5 L19.5 16.5" stroke={`url(#${gid})`} strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="6.8" cy="11" r="2.1" fill={`url(#${gid})`} />
      <circle cx="25.2" cy="11" r="2.1" fill={`url(#${gid})`} />
      {/* head */}
      <circle cx="16" cy="18.5" r="9.2" fill={`url(#${gid})`} />
      {/* face */}
      <circle cx="12.6" cy="17.5" r="1.5" fill="white" />
      <circle cx="19.4" cy="17.5" r="1.5" fill="white" />
      <path d="M12 22 Q16 25 20 22" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function FloatingAiAssistant() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const dragState = useRef<{ dragging: boolean; moved: boolean; offsetX: number; offsetY: number }>({
    dragging: false, moved: false, offsetX: 0, offsetY: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

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

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: trimmed }]);
    setDraft("");
    setSending(true);
    setTimeout(() => {
      setMessages((prev) => [...prev, { id: `b-${Date.now()}`, role: "bot", text: DEMO_REPLY }]);
      setSending(false);
    }, 700);
  }

  if (!pos) return null;

  const openUpward = pos.y > window.innerHeight / 2;
  const openLeftward = pos.x > window.innerWidth / 2;

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
          className="z-[110] flex flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{ ...panelStyle, background: "var(--cc-bg)", borderColor: BORDER }}
          role="dialog"
          aria-label="CareCliQ AI Assistant (demo)"
        >
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 shrink-0"
            style={{ background: "linear-gradient(135deg, var(--cc-plum), var(--cc-coral))" }}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white">
              <CareCliQBotMark size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-black text-white leading-tight">CareCliQ Assistant</p>
              <p className="flex items-center gap-1 text-[10px] font-semibold text-white/80">
                <Sparkles size={10} /> Demo preview
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/15"
            >
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug"
                  style={
                    m.role === "user"
                      ? { background: "var(--cc-cta)", color: "#fff" }
                      : { background: "var(--cc-soft)", color: TEXT, border: `1px solid ${BORDER}` }
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div
                  className="flex items-center gap-1 rounded-2xl px-3 py-2.5"
                  style={{ background: "var(--cc-soft)", border: `1px solid ${BORDER}` }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full animate-bounce"
                      style={{ background: MUTED, animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2 shrink-0">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
                  style={{ background: "var(--cc-soft)", color: PLUM, border: `1px solid ${BORDER}` }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 border-t px-3 py-2.5 shrink-0" style={{ borderColor: BORDER }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage(draft)}
              placeholder="Ask me anything…"
              className="flex-1 rounded-xl border px-3 py-2 text-[12.5px] outline-none"
              style={{ borderColor: BORDER, color: TEXT, background: "var(--cc-surface)" }}
            />
            <button
              type="button"
              onClick={() => sendMessage(draft)}
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition-opacity disabled:opacity-40"
              style={{ background: "var(--cc-cta)" }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Floating launcher — draggable, click to toggle */}
      <button
        type="button"
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="fixed z-[110] flex items-center justify-center rounded-full border shadow-xl transition-transform active:scale-95 touch-none select-none"
        style={{
          left: pos.x,
          top: pos.y,
          width: BTN_SIZE,
          height: BTN_SIZE,
          background: "var(--cc-bg)",
          borderColor: BORDER,
          cursor: dragState.current.dragging ? "grabbing" : "grab",
        }}
      >
        {open ? <X size={22} style={{ color: PLUM }} /> : <CareCliQBotMark size={34} />}
        {!open && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2"
            style={{ background: "#22C55E", borderColor: "var(--cc-bg)" }}
          />
        )}
        <GripHorizontal size={9} className="absolute bottom-1" style={{ color: BORDER }} />
      </button>
    </>
  );
}
