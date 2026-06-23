import { useMemo } from "react";
import { Link } from "wouter";
import { Clock3 } from "lucide-react";
import { BORDER, MUTED, PLUM, STATE_STYLES, TEXT, WIDGET_SCROLL, shiftInitials } from "@/lib/shift-utils";
import type { DashboardShiftSummary } from "@/services/dashboardService";

type Props = {
  shifts: DashboardShiftSummary[];
  nextShiftId?: string | null;
};

function parseStart(value?: string) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export function DayShiftTimeline({ shifts, nextShiftId }: Props) {
  const ordered = useMemo(
    () => [...shifts].sort((a, b) => parseStart(a.scheduled_start) - parseStart(b.scheduled_start)),
    [shifts],
  );

  const dayStart = ordered.length ? parseStart(ordered[0].scheduled_start) : 0;
  const dayEnd = ordered.reduce((max, shift) => {
    const end = parseStart(shift.scheduled_end || shift.scheduled_start);
    return Math.max(max, end);
  }, dayStart + 60 * 60 * 1000);
  const span = Math.max(dayEnd - dayStart, 60 * 60 * 1000);

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <Clock3 size={18} style={{ color: PLUM }} />
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Today&apos;s Timeline
        </h2>
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-xl bg-[#F8F6FE] px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
          Your day timeline will appear when shifts are scheduled.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="relative hidden h-3 overflow-hidden rounded-full bg-[#F0EDF8] md:block">
            {ordered.map((shift) => {
              const start = parseStart(shift.scheduled_start);
              const end = parseStart(shift.scheduled_end || shift.scheduled_start);
              const left = ((start - dayStart) / span) * 100;
              const width = Math.max(8, ((end - start || 60 * 60 * 1000) / span) * 100);
              const visual = (shift.visual_state || "scheduled") as keyof typeof STATE_STYLES;
              const isNext = shift.id === nextShiftId;
              return (
                <div
                  key={shift.id}
                  className="absolute top-0 h-3 rounded-full"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: isNext ? PLUM : STATE_STYLES[visual]?.border || PLUM,
                    opacity: isNext ? 1 : 0.75,
                  }}
                />
              );
            })}
          </div>

          <div className={`space-y-3 ${WIDGET_SCROLL}`}>
            {ordered.map((shift, index) => {
              const visual = (shift.visual_state || "scheduled") as keyof typeof STATE_STYLES;
              const isNext = shift.id === nextShiftId;
              return (
                <Link key={shift.id} href={`/my-shifts/${shift.id}?focus=safety`}>
                  <div
                    className="flex items-start gap-3 rounded-xl border p-3 transition hover:bg-[#F8F6FE]"
                    style={{ borderColor: isNext ? PLUM : "#EEEAFB" }}
                  >
                    <div className="flex flex-col items-center">
                      <div
                        className="grid h-9 w-9 place-items-center rounded-full text-[10px] font-black text-white"
                        style={{ background: STATE_STYLES[visual]?.avatar || PLUM }}
                      >
                        {shiftInitials(shift.participant_name)}
                      </div>
                      {index < ordered.length - 1 && (
                        <div className="mt-1 h-8 w-px" style={{ background: "#E2DEF2" }} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black" style={{ color: TEXT }}>
                        {shift.participant_name}
                      </p>
                      <p className="text-xs font-medium" style={{ color: MUTED }}>
                        {shift.time_label}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${STATE_STYLES[visual]?.badge}`}>
                      {STATE_STYLES[visual]?.label || shift.status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
