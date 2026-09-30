import { useMemo } from "react";
import { appLocalDateKey, appMinutesOfDay, formatAppTime } from "@/lib/datetime";
import type { CoordinatorShiftRecord, WorkerStats } from "@/services/coordinatorService";
import { ShiftHoverCard, shiftLiveStatus } from "./ShiftHoverCard";

const UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const UNASSIGNED_ROW = "__unassigned__";

// Same palette as RosterBoard's avatars, so a worker keeps their colour.
const PALETTE = [
  { bg: "#F3E8FF", fg: "#7C3AED" },
  { bg: "#FCE3EB", fg: "#DB2777" },
  { bg: "#DBEAFE", fg: "#1D4ED8" },
  { bg: "#DCFCE7", fg: "#15803D" },
  { bg: "#FEF3C7", fg: "#B45309" },
  { bg: "#E0F2FE", fg: "#0369A1" },
];
function colourFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
}

interface Block {
  shift: CoordinatorShiftRecord;
  startMin: number;
  endMin: number;
}

/** Hour range to draw: 6am–8pm, widened to fit any earlier/later shift. */
export function timelineBounds(blocks: Block[]): { from: number; to: number } {
  let from = 6 * 60;
  let to = 20 * 60;
  for (const b of blocks) {
    from = Math.min(from, Math.floor(b.startMin / 60) * 60);
    to = Math.max(to, Math.ceil(b.endMin / 60) * 60);
  }
  return { from, to: Math.min(to, 24 * 60) };
}

export function DayTimeline({
  dayKey,
  shifts,
  workers,
  onSelect,
}: {
  /** yyyy-MM-dd, the day on screen */
  dayKey: string;
  shifts: CoordinatorShiftRecord[];
  workers: WorkerStats[];
  onSelect?: (shift: CoordinatorShiftRecord) => void;
}) {
  const rows = useMemo(() => {
    const byRow = new Map<string, Block[]>();
    for (const s of shifts) {
      if (!s.scheduled_start) continue;
      if (appLocalDateKey(s.scheduled_start, s.timezone) !== dayKey) continue;
      const startMin = appMinutesOfDay(s.scheduled_start, s.timezone);
      let endMin = s.scheduled_end ? appMinutesOfDay(s.scheduled_end, s.timezone) : startMin + 60;
      // Overnight shifts run to the end of this day's track.
      if (endMin <= startMin) endMin = 24 * 60;
      const row = !s.worker_id || s.worker_id === UNASSIGNED_PLACEHOLDER_ID ? UNASSIGNED_ROW : s.worker_id;
      byRow.set(row, [...(byRow.get(row) ?? []), { shift: s, startMin, endMin }]);
    }
    const names = new Map(workers.map((w) => [w.id, w.full_name]));
    for (const blocks of byRow.values()) {
      for (const b of blocks) {
        if (b.shift.worker_id && !names.has(b.shift.worker_id)) names.set(b.shift.worker_id, b.shift.worker_name || "Worker");
      }
    }
    const ids = [...new Set([...workers.map((w) => w.id), ...byRow.keys()])].filter((id) => id !== UNASSIGNED_ROW);
    const out = ids
      .map((id) => ({ id, name: names.get(id) ?? "Worker", blocks: byRow.get(id) ?? [] }))
      .sort((a, b) => Number(b.blocks.length > 0) - Number(a.blocks.length > 0) || a.name.localeCompare(b.name));
    if (byRow.has(UNASSIGNED_ROW)) out.unshift({ id: UNASSIGNED_ROW, name: "Unassigned", blocks: byRow.get(UNASSIGNED_ROW)! });
    return out;
  }, [shifts, workers, dayKey]);

  const { from, to } = timelineBounds(rows.flatMap((r) => r.blocks));
  const span = to - from;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => from + i * 60);
  const pct = (min: number) => `${((Math.max(from, Math.min(to, min)) - from) / span) * 100}%`;
  const hourLabel = (min: number) => {
    const h = Math.floor(min / 60) % 24;
    return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
  };

  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--cc-border)", background: "var(--cc-surface)" }}>
      <div className="min-w-[760px]">
        <div className="flex border-b" style={{ borderColor: "var(--cc-border)" }}>
          <div className="w-[180px] shrink-0" />
          <div className="relative h-8 flex-1">
            {hours.map((m) => (
              <span
                key={m}
                className="absolute top-2 -translate-x-1/2 text-[10px] font-semibold"
                style={{ left: pct(m), color: "var(--cc-muted)" }}
              >
                {hourLabel(m)}
              </span>
            ))}
          </div>
        </div>
        {rows.length === 0 && (
          <p className="py-12 text-center text-sm" style={{ color: "var(--cc-muted)" }}>No shifts on this day.</p>
        )}
        {rows.map((row) => {
          const colour = row.id === UNASSIGNED_ROW ? { bg: "var(--cc-status-warning-bg)", fg: "var(--cc-status-warning)" } : colourFor(row.name);
          return (
            <div key={row.id} className="flex border-b last:border-b-0" style={{ borderColor: "var(--cc-border)" }}>
              <div className="flex w-[180px] shrink-0 items-center gap-2.5 px-3 py-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: colour.bg, color: colour.fg }}
                >
                  {row.id === UNASSIGNED_ROW ? "?" : initials(row.name)}
                </span>
                <span className="truncate text-[12px] font-bold" style={{ color: "var(--cc-text)" }}>{row.name}</span>
              </div>
              <div className="relative min-h-[56px] flex-1">
                {hours.map((m) => (
                  <span key={m} aria-hidden className="absolute inset-y-0 w-px" style={{ left: pct(m), background: "var(--cc-border)", opacity: 0.6 }} />
                ))}
                {row.blocks.map(({ shift, startMin, endMin }) => {
                  const live = shiftLiveStatus(shift);
                  return (
                    <ShiftHoverCard key={shift.id} shift={shift}>
                      <button
                        type="button"
                        onClick={() => onSelect?.(shift)}
                        aria-label={`${shift.participant_name ?? "Shift"}, ${formatAppTime(shift.scheduled_start!, shift.timezone)}`}
                        className="absolute top-2 bottom-2 overflow-hidden rounded-lg px-2 py-1 text-left transition-shadow hover:shadow-md"
                        style={{
                          left: pct(startMin),
                          width: `calc(${pct(endMin)} - ${pct(startMin)})`,
                          minWidth: 44,
                          background: colour.bg,
                          opacity: live === "cancelled" ? 0.5 : 1,
                          boxShadow: live === "on_shift" ? `inset 0 0 0 1.5px ${colour.fg}` : undefined,
                        }}
                      >
                        <span className="block truncate text-[11px] font-bold" style={{ color: "var(--cc-text)" }}>
                          {formatAppTime(shift.scheduled_start!, shift.timezone)}
                          {shift.scheduled_end ? ` – ${formatAppTime(shift.scheduled_end, shift.timezone)}` : ""}
                        </span>
                        <span className="block truncate text-[10.5px]" style={{ color: colour.fg }}>
                          {shift.participant_name || "Participant"}
                        </span>
                      </button>
                    </ShiftHoverCard>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
