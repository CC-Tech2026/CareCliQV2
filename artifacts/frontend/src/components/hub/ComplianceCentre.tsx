import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, ShieldAlert } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getHubComplianceAlerts, type HubComplianceAlert } from "@/services/hubService";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";
const PLUM   = "#5533CC";

type Severity = "critical" | "high" | "medium" | "info" | "positive";

const now = new Date();

const SEVERITY_CONFIG: Record<
  Severity,
  {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    color: string;
    chip: string;
  }
> = {
  critical: { icon: ShieldAlert,   label: "Critical", color: "#EF4444", chip: "bg-red-50 text-red-700" },
  high:     { icon: AlertTriangle, label: "High",     color: "#F97316", chip: "bg-orange-50 text-orange-700" },
  medium:   { icon: Clock,         label: "Medium",   color: "#F59E0B", chip: "bg-amber-50 text-amber-700" },
  info:     { icon: Info,          label: "Info",     color: "#3B82F6", chip: "bg-blue-50 text-blue-700" },
  positive: { icon: CheckCircle2,  label: "Clear",    color: "#10B981", chip: "bg-emerald-50 text-emerald-700" },
};

function AlertRow({ alert }: { alert: HubComplianceAlert }) {
  const cfg     = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
  const Icon    = cfg.icon;
  const dueDate = alert.due_date ? parseISO(alert.due_date) : null;
  const isOverdue = dueDate ? dueDate < now : false;

  return (
    <div
      className="flex items-start gap-3 py-3"
      style={{ borderBottom: `1px solid ${BORDER}` }}
    >
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: SOFT, color: cfg.color }}
      >
        <Icon size={12} strokeWidth={2} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-bold leading-snug" style={{ color: TEXT }}>
          {alert.title}
        </p>
        <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>
          {alert.detail}
        </p>
        {dueDate && (
          <p
            className="mt-0.5 text-[10px] font-semibold"
            style={{ color: isOverdue ? "#EF4444" : MUTED }}
          >
            {isOverdue ? "Overdue — " : "Due "}{format(dueDate, "d MMM yyyy")}
          </p>
        )}
      </div>

      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${cfg.chip}`}>
        {cfg.label}
      </span>
    </div>
  );
}

export function ComplianceCentre() {
  const [alerts,  setAlerts]  = useState<HubComplianceAlert[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getHubComplianceAlerts()
      .then((data) => { if (!cancelled) setAlerts(data); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const displayAlerts = alerts ?? [];
  const critical = displayAlerts.filter((a) => a.severity === "critical").length;
  const high     = displayAlerts.filter((a) => a.severity === "high").length;

  return (
    <div className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>
          Compliance
        </p>
        <div className="flex gap-1.5">
          {loading && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-400 animate-pulse">
              …
            </span>
          )}
          {!loading && !error && critical > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-black text-red-700">
              {critical} critical
            </span>
          )}
          {!loading && !error && high > 0 && (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-black text-orange-700">
              {high} high
            </span>
          )}
          {!loading && !error && critical === 0 && high === 0 && displayAlerts.length === 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
              All clear
            </span>
          )}
        </div>
      </div>

      <div className="px-5">
        {loading ? (
          <div className="py-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-7 w-7 animate-pulse rounded-lg" style={{ background: SOFT }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-36 animate-pulse rounded" style={{ background: SOFT }} />
                  <div className="h-2.5 w-24 animate-pulse rounded" style={{ background: SOFT }} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="py-6 text-center">
            <AlertTriangle size={18} className="mx-auto mb-2" style={{ color: "#F97316" }} />
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>Could not load compliance data</p>
          </div>
        ) : displayAlerts.length === 0 ? (
          <div className="py-6 text-center">
            <CheckCircle2 size={18} className="mx-auto mb-2" style={{ color: "#10B981" }} />
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>All credentials are current</p>
            <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>No issues to report.</p>
          </div>
        ) : (
          <div>
            {displayAlerts.slice(0, 5).map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
            {displayAlerts.length > 5 && (
              <p className="py-3 text-[11px] font-bold" style={{ color: PLUM }}>
                +{displayAlerts.length - 5} more alerts
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
