import { useEffect, useRef, useState } from "react";
import { X, Send, GripHorizontal } from "lucide-react";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT  = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const MASCOT_SRC = "/carecliq-bot-quill-animated.svg";
const BTN_SIZE = 60;
const PANEL_W = 340;
const PANEL_H = 460;
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the input each time the panel opens, so a coordinator can start typing immediately.
  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

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
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15"
            >
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {/* Welcome mascot display — shown only before any user message */}
            {messages.length === 1 && (
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
                className={`flex items-end gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "bot" && (
                  <span className="mb-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full shadow-sm" style={{ border: `1.5px solid ${BORDER}` }}>
                    <img src={MASCOT_SRC} alt="" className="h-full w-full" draggable={false} />
                  </span>
                )}
                <div
                  className="max-w-[78%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug"
                  style={
                    m.role === "user"
                      ? { background: CORAL, color: "#fff" }
                      : { background: "var(--cc-soft)", color: TEXT, border: `1px solid ${BORDER}` }
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex items-end justify-start gap-2 animate-in fade-in-0 duration-200">
                <span className="mb-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full shadow-sm" style={{ border: `1.5px solid ${BORDER}` }}>
                  <img src={MASCOT_SRC} alt="" className="h-full w-full" draggable={false} />
                </span>
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
                    className="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:text-white"
                    style={{ background: "var(--cc-soft)", color: PLUM, borderColor: BORDER }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = PLUM; e.currentTarget.style.borderColor = PLUM; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--cc-soft)"; e.currentTarget.style.borderColor = BORDER; }}
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
