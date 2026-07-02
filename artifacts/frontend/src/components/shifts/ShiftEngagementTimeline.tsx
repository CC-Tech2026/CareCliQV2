import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Activity, Coffee, MessageCircle, Clock } from "lucide-react";
import {
  getSessionActivityTimeline,
  type ShiftActivityEvent,
} from "@/services/longShiftService";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const EVENT_LABELS: Record<string, string> = {
  NOTE_SAVED: "Note saved",
  TASK_TICKED: "Task completed",
  PHOTO_ADDED: "Photo added",
  VOICE_RECORDED: "Voice note",
  CHECK_IN: "Check-in",
  BREAK_START: "Break started",
  BREAK_END: "Break ended",
  CLOCK_IN: "Clocked in",
  CLOCK_OUT: "Clocked out",
};

function formatGap(secs?: number) {
  if (!secs || secs <= 0) return null;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m gap`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m gap`;
}

type Props = {
  sessionId: string;
  title?: string;
  compact?: boolean;
};

export function ShiftEngagementTimeline({ sessionId, title = "Shift activity", compact }: Props) {
  const [events, setEvents] = useState<ShiftActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getSessionActivityTimeline(sessionId)
      .then((res) => {
        if (!cancelled) setEvents(res.events || []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load activity timeline");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return <p className="text-xs" style={{ color: MUTED }}>Loading activity…</p>;
  }
  if (error) {
    return <p className="text-xs text-amber-700">{error}</p>;
  }
  if (!events.length) {
    return <p className="text-xs" style={{ color: MUTED }}>No activity events recorded yet.</p>;
  }

  return (
    <section className={compact ? "" : "rounded-2xl border bg-cc-surface p-4"} style={compact ? undefined : { borderColor: BORDER }}>
      {!compact && (
        <div className="mb-3 flex items-center gap-2">
          <Activity size={16} style={{ color: PLUM }} />
          <h3 className="text-sm font-black" style={{ color: PLUM }}>{title}</h3>
        </div>
      )}
      <ol className="space-y-2">
        {events.map((ev) => {
          const label = EVENT_LABELS[ev.event_type] || ev.event_type.replace(/_/g, " ");
          const gap = formatGap(ev.gap_before_secs);
          const Icon =
            ev.event_type.includes("BREAK") ? Coffee
              : ev.event_type === "CHECK_IN" ? MessageCircle
                : ev.event_type.includes("CLOCK") ? Clock
                  : Activity;
          return (
            <li
              key={ev.id}
              className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: BORDER }}
            >
              <Icon size={14} className="mt-0.5 shrink-0" style={{ color: PLUM }} />
              <div className="min-w-0 flex-1">
                <p className="font-bold" style={{ color: PLUM }}>{label}</p>
                <p style={{ color: MUTED }}>
                  {format(parseISO(ev.occurred_at), "h:mm a")}
                  {gap ? ` · ${gap}` : ""}
                  {ev.is_billable === false ? " · billing paused" : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
