import { useEffect, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Activity, AlertTriangle, Radio } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getMonitorLive,
  getEngagementSummary,
  type LiveLongShift,
} from "@/services/longShiftService";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function statusColour(status: string) {
  if (status === "RED") return { bg: "#FEE2E2", text: "#DC2626" };
  if (status === "AMBER") return { bg: "#FEF3C7", text: "#D97706" };
  return { bg: "#DCFCE7", text: "#16A34A" };
}

function scoreBand(score?: number | null) {
  if (score == null) return "N/A";
  if (score >= 80) return "Fully engaged";
  if (score >= 60) return "Mostly engaged";
  if (score >= 40) return "Low engagement";
  return "Review required";
}

function ShiftCard({ shift }: { shift: LiveLongShift }) {
  const colours = statusColour(shift.status);
  const gapMins = Math.floor((shift.current_gap_secs ?? 0) / 60);
  return (
    <article className="rounded-2xl border bg-white p-4" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black" style={{ color: PLUM }}>
            {shift.participant_name || "Participant"}
          </p>
          <p className="text-xs" style={{ color: MUTED }}>{shift.worker_name || "Worker"}</p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: colours.bg, color: colours.text }}
        >
          {shift.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p style={{ color: MUTED }}>Gap</p>
          <p className="font-bold" style={{ color: PLUM }}>{gapMins} min</p>
        </div>
        <div>
          <p style={{ color: MUTED }}>Check-ins</p>
          <p className="font-bold" style={{ color: PLUM }}>
            {shift.checkins_completed ?? 0}/{shift.checkins_required ?? 0}
          </p>
        </div>
        <div>
          <p style={{ color: MUTED }}>Score</p>
          <p className="font-bold" style={{ color: PLUM }}>
            {shift.engagement_score ?? "N/A"} · {scoreBand(shift.engagement_score)}
          </p>
        </div>
        <div>
          <p style={{ color: MUTED }}>Break</p>
          <p className="font-bold" style={{ color: PLUM }}>
            {shift.on_break ? "On break" : shift.break_logged ? "Logged" : "None"}
          </p>
        </div>
      </div>
      {shift.last_activity_at && (
        <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
          Last {shift.last_activity_type?.replace(/_/g, " ").toLowerCase() || "activity"}{" "}
          {formatDistanceToNow(parseISO(shift.last_activity_at), { addSuffix: true })}
        </p>
      )}
      {shift.coordinator_alerted && (
        <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-amber-700">
          <AlertTriangle size={12} /> Coordinator alerted
        </p>
      )}
    </article>
  );
}

export default function CoordinatorMonitorPage() {
  const [live, setLive] = useState<Awaited<ReturnType<typeof getMonitorLive>> | null>(null);

  const heatmap = useOrgQuery(["coordinator", "engagement-summary"], {
    queryFn: () => getEngagementSummary(),
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getMonitorLive();
        if (!cancelled) setLive(data);
      } catch {
        if (!cancelled) setLive(null);
      }
    };
    void load();
    const poll = setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  const summary = live?.summary;
  const shifts = live?.active_long_shifts ?? [];
  const dist = heatmap.data?.distribution ?? {};

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: MUTED }}>
          Check 16
        </p>
        <h1 className="flex items-center gap-2 text-xl font-black" style={{ color: "var(--cc-text)" }}>
          <Radio size={22} /> Long shift monitor
        </h1>
        <p className="mt-1 text-sm" style={{ color: MUTED }}>
          Live engagement for shifts ≥ 4 hours. Refreshes every 30 seconds.
        </p>
      </div>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Active", value: summary.total_active },
            { label: "Green", value: summary.green_count },
            { label: "Amber", value: summary.amber_count },
            { label: "Red", value: summary.red_count },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border bg-white p-4 text-center" style={{ borderColor: BORDER }}>
              <p className="text-2xl font-black" style={{ color: PLUM }}>{value}</p>
              <p className="text-xs font-bold" style={{ color: MUTED }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {heatmap.data && (
        <section className="rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <div className="mb-3 flex items-center gap-2">
            <Activity size={18} style={{ color: PLUM }} />
            <h2 className="text-sm font-black" style={{ color: PLUM }}>Engagement heatmap</h2>
          </div>
          <p className="mb-3 text-xs" style={{ color: MUTED }}>
            {heatmap.data.passed_check16} of {heatmap.data.total_long_shifts} long shifts passed Check 16
            ({heatmap.data.pass_rate_pct}%)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: "80_100", label: "80–100 Fully engaged", colour: "#16A34A" },
              { key: "60_79", label: "60–79 Mostly engaged", colour: "#D97706" },
              { key: "40_59", label: "40–59 Low engagement", colour: "#DC2626" },
              { key: "below_40", label: "<40 Review required", colour: "#7F1D1D" },
            ].map(({ key, label, colour }) => (
              <div key={key} className="rounded-lg border p-3" style={{ borderColor: BORDER }}>
                <p className="text-lg font-black" style={{ color: colour }}>
                  {dist[key] ?? 0}
                </p>
                <p className="text-[10px] font-bold" style={{ color: MUTED }}>{label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: PLUM }}>
          Active long shifts
        </h2>
        {shifts.length === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>No active long shifts right now.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shifts.map((s) => (
              <ShiftCard key={s.session_id || s.shift_id} shift={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
