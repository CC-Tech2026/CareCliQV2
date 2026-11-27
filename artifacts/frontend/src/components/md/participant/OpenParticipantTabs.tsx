import { useEffect, useState } from "react";
import { X } from "lucide-react";

// Participants the director has open, as tabs above the list and profiles,
// so they can move between people without going back to the list each time.
// Kept for this browser tab only; a fresh visit starts with just the list.

const KEY = "ccq_md_open_participants";
const MAX_OPEN = 5;

function readOpen(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeOpen(ids: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* only a convenience */
  }
}

export function OpenParticipantTabs({
  activeId,
  participants,
  onShowList,
  onOpen,
}: {
  /** The intake open now, or null on the list. */
  activeId: string | null;
  /** Names for the open tabs, by intake id. */
  participants: { id: string; name: string }[];
  onShowList: () => void;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState<string[]>(readOpen);
  const names = new Map(participants.map((p) => [p.id, p.name]));

  // Opening a profile adds its tab, newest last, dropping the oldest past five.
  useEffect(() => {
    if (!activeId) return;
    setOpen((current) => {
      if (current.includes(activeId)) return current;
      const next = [...current, activeId].slice(-MAX_OPEN);
      writeOpen(next);
      return next;
    });
  }, [activeId]);

  // Tabs for participants no longer on the list (ended, removed) drop away.
  const shown = participants.length ? open.filter((id) => names.has(id)) : open;

  function close(id: string) {
    const index = shown.indexOf(id);
    const next = open.filter((v) => v !== id);
    setOpen(next);
    writeOpen(next);
    if (id === activeId) {
      const remaining = shown.filter((v) => v !== id);
      const neighbour = remaining[Math.min(index, remaining.length - 1)];
      if (neighbour) onOpen(neighbour);
      else onShowList();
    }
  }

  // Until someone is opened the bar would only hold "All participants", so it
  // stays out of the way and the list starts higher.
  if (shown.length === 0 && activeId === null) return null;

  const tabClass = (active: boolean) =>
    "relative inline-flex min-h-10 md:min-h-8 shrink-0 items-center gap-2 rounded-t-2xl border border-b-0 px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum " +
    (active ? "bg-cc-surface text-cc-text" : "border-transparent text-cc-muted hover:bg-cc-surface/60 hover:text-cc-text");

  return (
    <nav aria-label="Open participants" className="-mx-1 flex items-end gap-1 overflow-x-auto border-b border-cc-border px-1">
      <button
        type="button"
        onClick={onShowList}
        aria-current={activeId === null ? "page" : undefined}
        className={tabClass(activeId === null)}
        style={activeId === null ? { borderColor: "var(--cc-border)", boxShadow: "inset 0 3px 0 var(--cc-plum)" } : undefined}
      >
        All participants
      </button>
      {shown.map((id) => {
        const active = id === activeId;
        const name = names.get(id) ?? "Participant";
        return (
          <div
            key={id}
            className={tabClass(active)}
            style={active ? { borderColor: "var(--cc-border)", boxShadow: "inset 0 3px 0 var(--cc-plum)" } : undefined}
          >
            <button
              type="button"
              onClick={() => onOpen(id)}
              aria-current={active ? "page" : undefined}
              className="max-w-[12rem] truncate"
            >
              {name}
            </button>
            <button
              type="button"
              onClick={() => close(id)}
              aria-label={`Close ${name}`}
              className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full hover:bg-cc-soft"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
