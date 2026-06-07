import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, ShieldAlert } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getHubComplianceAlerts, type HubComplianceAlert } from "@/services/hubService";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

type Severity = "critical" | "high" | "medium" | "info" | "positive";

const now = new Date();

const SEVERITY_CONFIG: Record<
  Severity,
  {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    bar: string;
    badge: string;
  }
> = {
  critical: {
    icon:  ShieldAlert,
    label: "Critical",
    bar:   "#EF4444",
    badge: "bg-red-50 text-red-700 border border-red-200",
  },
  high: {
    icon:  AlertTriangle,
    label: "High",
    bar:   "#F97316",
    badge: "bg-orange-50 text-orange-700 border border-orange-200",
  },
  medium: {
    icon:  Clock,
    label: "Medium",
    bar:   "#F59E0B",
    badge: "bg-amber-50 text-amber-700 border border-amber-200",
  },
  info: {
    icon:  Info,
    label: "Info",
    bar:   "#3B82F6",
    badge: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  positive: {
    icon:  CheckCircle2,
    label: "Positive",
    bar:   "#10B981",
    badge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
};

function AlertCard({ alert }: { alert: HubComplianceAlert }) {
  const cfg     = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
  const Icon    = cfg.icon;
  const dueDate = alert.due_date ? parseISO(alert.due_date) : null;
  const isOverdue = dueDate ? dueDate < now : false;

  return (
    <div
      className="flex gap-4 rounded-xl border p-4"
      style={{
        borderLeftColor: cfg.bar,
        borderTopColor: BORDER,
        borderRightColor: BORDER,
        borderBottomColor: BORDER,
        borderLeftWidth: 3,
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderStyle: "solid",
      }}
    >
      <div
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: SOFT, color: cfg.bar }}
      >
        <Icon size={15} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${cfg.badge}`}>
            {cfg.label}
          </span>
          {dueDate && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                isOverdue ? "bg-red-50 text-red-600 border border-red-200" : "text-[#7A6A9E] bg-[#F5F3FC]"
              }`}
            >
              {isOverdue ? "Overdue — " : "Due "}
              {format(dueDate, "d MMM yyyy")}
            </span>
          )}
        </div>
        <h3 className="mt-1.5 text-[13px] font-bold" style={{ color: TEXT }}>
          {alert.title}
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: MUTED }}>
          {alert.detail}
        </p>
        {alert.affected_staff && alert.affected_staff.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {alert.affected_staff.map((name) => (
              <span
                key={name}
                className="rounded-full px-2.5 py-0.5 text-[10px] font-black"
                style={{ background: "#EEEAFB", color: "#5533CC" }}
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
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
    <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div
        className="flex items-start justify-between gap-3 px-6 py-4"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
            Compliance Centre
          </h2>
          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
            Live credential expiry and NDIS obligations
          </p>
        </div>
        <div className="flex gap-2">
          {loading && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold text-gray-400 animate-pulse">
              Loading…
            </span>
          )}
          {!loading && !error && critical > 0 && (
            <span className="rounded-full bg-red-50 px-3 py-1 text-[10px] font-black text-red-700 border border-red-200">
              {critical} Critical
            </span>
          )}
          {!loading && !error && high > 0 && (
            <span className="rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black text-orange-700 border border-orange-200">
              {high} High
            </span>
          )}
        </div>
      </div>

      <div className="px-6 py-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl" style={{ background: SOFT }} />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: BORDER }}>
            <AlertTriangle size={22} className="mx-auto mb-2" style={{ color: "#F97316" }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>Could not load compliance data</p>
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>Check your connection and try again.</p>
          </div>
        ) : displayAlerts.length === 0 ? (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: BORDER }}>
            <CheckCircle2 size={22} className="mx-auto mb-2" style={{ color: "#10B981" }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>All credentials are current</p>
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
              No expiring or expired credentials found for your team.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
