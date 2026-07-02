import { useEffect, useState } from "react";
import { Activity, WifiOff } from "lucide-react";
import {
  getWorkerActivitySummary,
  type WorkerActivitySummary,
} from "@/services/longShiftService";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function formatHours(secs?: number | null) {
  if (secs == null) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type Props = {
  sessionId: string;
  refreshKey?: number;
};

/** Q5: neutral activity summary for workers — no engagement score. */
export function LongShiftActivitySummary({ sessionId, refreshKey = 0 }: Props) {
  const [summary, setSummary] = useState<WorkerActivitySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getWorkerActivitySummary(sessionId)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (!summary?.is_long_shift) return null;

  return (
    <section
      className="rounded-2xl border bg-cc-surface p-4"
      style={{ borderColor: BORDER }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Activity size={16} style={{ color: PLUM }} />
        <h3 className="text-sm font-black" style={{ color: PLUM }}>Shift activity</h3>
        {summary.offline && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
            <WifiOff size={10} /> Offline — gap timer paused
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: BORDER }}>
          <p style={{ color: MUTED }}>Last activity</p>
          <p className="font-bold" style={{ color: PLUM }}>
            {summary.minutes_since_activity ?? 0} min ago
          </p>
        </div>
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: BORDER }}>
          <p style={{ color: MUTED }}>Check-ins</p>
          <p className="font-bold" style={{ color: PLUM }}>{summary.checkins_completed ?? 0}</p>
        </div>
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: BORDER }}>
          <p style={{ color: MUTED }}>Billable time</p>
          <p className="font-bold" style={{ color: PLUM }}>
            {formatHours(summary.billable_duration_secs)}
          </p>
        </div>
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: BORDER }}>
          <p style={{ color: MUTED }}>Break time</p>
          <p className="font-bold" style={{ color: PLUM }}>
            {formatHours(summary.break_duration_secs)}
          </p>
        </div>
      </div>
    </section>
  );
}
