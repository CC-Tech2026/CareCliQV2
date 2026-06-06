import { AlertTriangle, CheckCircle2, Clock, Info, ShieldAlert } from "lucide-react";
import { format, addDays } from "date-fns";

const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

type Severity = "critical" | "high" | "medium" | "info" | "positive";

interface ComplianceAlert {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  dueDate?: Date;
  affectedStaff?: string[];
  actionLabel: string;
}

const now = new Date();

const COMPLIANCE_ALERTS: ComplianceAlert[] = [
  {
    id: "c1",
    title: "First Aid Certificates Expiring",
    detail: "3 staff members have First Aid certifications expiring within 14 days. Renewal must be completed to maintain NDIS provider registration.",
    severity: "critical",
    dueDate: addDays(now, 10),
    affectedStaff: ["Mia Chen", "James Walker", "Priya Sharma"],
    actionLabel: "Review Credentials",
  },
  {
    id: "c2",
    title: "WWCC Renewal Overdue",
    detail: "One support worker's Working With Children Check expired 5 days ago. This worker must not provide services until renewed.",
    severity: "critical",
    dueDate: addDays(now, -5),
    affectedStaff: ["Daniel Okonkwo"],
    actionLabel: "View Worker",
  },
  {
    id: "c3",
    title: "Mandatory Safeguarding Training Overdue",
    detail: "2 staff members have not completed the annual Mandatory Safeguarding and Reporting training. This is required under NDIS Practice Standards.",
    severity: "high",
    dueDate: addDays(now, 3),
    affectedStaff: ["Rachel Torres", "Ben Kim"],
    actionLabel: "Assign Training",
  },
  {
    id: "c4",
    title: "Policy Acknowledgement Required",
    detail: "All staff must acknowledge the updated Restrictive Practices Policy (RPP-2025-v4) before 30 June 2026. 8 acknowledgements still pending.",
    severity: "high",
    dueDate: addDays(now, 14),
    actionLabel: "Send Reminder",
  },
  {
    id: "c5",
    title: "Manual Handling Refresher Due",
    detail: "5 support workers are due for their annual manual handling and safe client transfer refresher training this month.",
    severity: "medium",
    dueDate: addDays(now, 24),
    actionLabel: "Schedule Training",
  },
  {
    id: "c6",
    title: "Incident Register Up to Date",
    detail: "All incidents logged in the past 90 days have been reviewed, actioned, and formally closed. No overdue incident reviews.",
    severity: "positive",
    actionLabel: "View Register",
  },
  {
    id: "c7",
    title: "NDIS Quality Indicator Self-Assessment",
    detail: "Annual self-assessment against NDIS Practice Standards is due in Q3. Begin preparation 6 weeks prior.",
    severity: "info",
    dueDate: addDays(now, 45),
    actionLabel: "View Checklist",
  },
];

const SEVERITY_CONFIG: Record<
  Severity,
  {
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    bar: string;
    badge: string;
    border: string;
  }
> = {
  critical: {
    icon: ShieldAlert,
    label: "Critical",
    bar: "#EF4444",
    badge: "bg-red-50 text-red-700 border border-red-200",
    border: "#FCA5A5",
  },
  high: {
    icon: AlertTriangle,
    label: "High",
    bar: "#F97316",
    badge: "bg-orange-50 text-orange-700 border border-orange-200",
    border: "#FDBA74",
  },
  medium: {
    icon: Clock,
    label: "Medium",
    bar: "#F59E0B",
    badge: "bg-amber-50 text-amber-700 border border-amber-200",
    border: "#FCD34D",
  },
  info: {
    icon: Info,
    label: "Info",
    bar: "#3B82F6",
    badge: "bg-blue-50 text-blue-700 border border-blue-200",
    border: "#93C5FD",
  },
  positive: {
    icon: CheckCircle2,
    label: "Positive",
    bar: "#10B981",
    badge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    border: "#6EE7B7",
  },
};

export function ComplianceCentre() {
  const critical = COMPLIANCE_ALERTS.filter((a) => a.severity === "critical").length;
  const high = COMPLIANCE_ALERTS.filter((a) => a.severity === "high").length;

  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            Compliance Centre
          </h2>
          <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
            Credentials, training, and NDIS obligations
          </p>
        </div>
        <div className="flex gap-2">
          {critical > 0 && (
            <span className="rounded-full bg-red-100 px-3 py-1 text-[11px] font-black text-red-700">
              {critical} Critical
            </span>
          )}
          {high > 0 && (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-black text-orange-700">
              {high} High
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {COMPLIANCE_ALERTS.map((alert) => {
          const cfg = SEVERITY_CONFIG[alert.severity];
          const Icon = cfg.icon;
          const isOverdue = alert.dueDate && alert.dueDate < now;

          return (
            <div
              key={alert.id}
              className="flex gap-4 rounded-xl border-l-4 border-t border-r border-b p-4"
              style={{ borderLeftColor: cfg.bar, borderTopColor: BORDER, borderRightColor: BORDER, borderBottomColor: BORDER }}
            >
              <div
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: SOFT, color: cfg.bar }}
              >
                <Icon size={16} strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${cfg.badge}`}>
                    {cfg.label}
                  </span>
                  {alert.dueDate && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        isOverdue ? "bg-red-50 text-red-600" : "text-[#7A6A9E] bg-[#F5F3FC]"
                      }`}
                    >
                      {isOverdue ? "Overdue — " : "Due "}
                      {format(alert.dueDate, "d MMM yyyy")}
                    </span>
                  )}
                </div>
                <h3 className="mt-1.5 text-[13px] font-black" style={{ color: TEXT }}>
                  {alert.title}
                </h3>
                <p className="mt-1 text-[12px] font-medium leading-relaxed" style={{ color: MUTED }}>
                  {alert.detail}
                </p>
                {alert.affectedStaff && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {alert.affectedStaff.map((name) => (
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
        })}
      </div>
    </section>
  );
}
