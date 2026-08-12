/**
 * ActionQueue — unified prioritised action feed for the coordinator dashboard.
 *
 * Merges credential alerts, open incidents, flagged sessions, and workers
 * needing attention into one ranked list. Each row has a severity indicator,
 * a plain-language description, and a single deep-link action.
 *
 * Severity order: critical → high → medium → low
 */
import { useMemo } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle, BadgeCheck, ClipboardCheck,
  ShieldAlert, UserRound, ArrowRight, CheckCircle2,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getCoordinatorFlaggedSessions,
  getCoordinatorCredentialAlerts,
  type FlaggedSession,
  type CredentialAlert,
} from "@/services/coordinatorService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { CoordinatorDashboard } from "@/services/dashboardService";

// ── Token aliases ─────────────────────────────────────────────────────────────
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

// ── Severity palette ──────────────────────────────────────────────────────────
const SEV = {
  critical: { dot: "#DC2626", bg: "rgba(220,38,38,0.08)",  text: "#DC2626",  label: "Critical" },
  high:     { dot: "#EA580C", bg: "rgba(234,88,12,0.08)",  text: "#EA580C",  label: "High"     },
  medium:   { dot: "#D97706", bg: "rgba(217,119,6,0.08)",  text: "#D97706",  label: "Medium"   },
  low:      { dot: "#0369A1", bg: "rgba(3,105,161,0.08)",  text: "#0369A1",  label: "Info"     },
} as const;
type Severity = keyof typeof SEV;

// ── Action item shape ─────────────────────────────────────────────────────────
interface ActionItem {
  id: string;
  severity: Severity;
  /** NDIS-grounded category label */
  category:
    | "Missing credential"
    | "Documentation risk"
    | "Open incident"
    | "Worker at risk"
    | "Compliance flag";
  icon: React.ElementType;
  title: string;
  detail: string;
  actionLabel: string;
  actionUrl: string;
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeDate(v?: string | null) {
  if (!v) return "";
  try { return format(parseISO(v), "d MMM"); } catch { return v; }
}

function daysLeft(expiry?: string | null) {
  if (!expiry) return null;
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
}

// ── Builders — turn raw API shapes into ActionItems ───────────────────────────
function fromCredentials(alerts: CredentialAlert[]): ActionItem[] {
  return alerts.slice(0, 12).map((a, i) => {
    const d = daysLeft(a.expiry_date);
    const expired = d !== null && d <= 0;
    const sev: Severity = expired ? "critical" : d !== null && d <= 7 ? "high" : "medium";
    const credType = a.credential_type || a.title || "Credential";
    return {
      id: `cred-${a.credential_id ?? i}`,
      severity: sev,
      category: "Missing credential",
      icon: BadgeCheck,
      title: `${a.full_name || "Team member"} — ${credType}`,
      detail: expired
        ? `Expired ${safeDate(a.expiry_date)}`
        : `Expires in ${d} day${d !== 1 ? "s" : ""} (${safeDate(a.expiry_date)})`,
      actionLabel: "Manage credentials",
      actionUrl: "/credentials",
    };
  });
}

function fromIncidents(incidents: Array<Record<string, unknown>>): ActionItem[] {
  return incidents
    .filter((inc) => {
      const s = String(inc.status ?? "");
      return s === "open" || s === "pending";
    })
    .slice(0, 8)
    .map((inc, i) => {
      const id        = String(inc.id ?? i);
      const title     = String(inc.title ?? inc.type ?? "Incident report");
      const participant = String(inc.participant_name ?? inc.participant ?? "");
      const sev: Severity = String(inc.severity ?? "") === "critical" ? "critical" : "high";
      return {
        id: `inc-${id}`,
        severity: sev,
        category: "Open incident",
        icon: AlertTriangle,
        title: participant ? `${participant} — ${title}` : title,
        detail: `Reported ${safeDate(String(inc.created_at ?? inc.date ?? ""))} · Needs review`,
        actionLabel: "Review",
        actionUrl: id ? `/incidents/${id}` : "/incidents",
      };
    });
}

function fromFlagged(sessions: FlaggedSession[]): ActionItem[] {
  return sessions.slice(0, 8).map((s) => {
    const cs = s.compliance_score;
    const sev: Severity = cs != null && cs < 60 ? "critical" : "high";
    return {
      id: `flag-${s.id}`,
      severity: sev,
      category: "Compliance flag",
      icon: ClipboardCheck,
      title: `${s.participant_name || "Session"} — ${(s.session_type || "session").replace(/_/g, " ")}`,
      detail: `Score ${cs != null ? `${cs}%` : "unscored"} · ${safeDate(s.session_date)}${s.review_note ? ` · "${s.review_note.slice(0, 40)}…"` : ""}`,
      actionLabel: "Review session",
      actionUrl: `/sessions/${s.id}`,
    };
  });
}

function fromWorkers(
  workers: CoordinatorDashboard["workers_needing_attention"],
): ActionItem[] {
  return workers.slice(0, 8).map((w) => {
    const score = w.compliance_score ?? null;
    const sev: Severity =
      score != null && score < 60 ? "high" : "medium";
    return {
      id: `worker-${w.id}`,
      severity: sev,
      category: "Worker at risk",
      icon: UserRound,
      title: w.full_name,
      detail: w.reason || `Compliance score ${score != null ? `${score}%` : "not recorded"}`,
      actionLabel: "View profile",
      actionUrl: "/team",
    };
  });
}

function fromDocRisks(sessions: FlaggedSession[]): ActionItem[] {
  // Treat unflagged sessions (no note, compliance_score null) as documentation risk
  const noNote = sessions.filter((s) => !s.compliance_score && s.status !== "in_progress");
  return noNote.slice(0, 5).map((s) => ({
    id: `docr-${s.id}`,
    severity: "medium" as Severity,
    category: "Documentation risk",
    icon: ShieldAlert,
    title: `${s.participant_name || "Session"} — note not submitted`,
    detail: safeDate(s.session_date),
    actionLabel: "Add note",
    actionUrl: `/sessions/${s.id}`,
  }));
}

// ── Main component ─────────────────────────────────────────────────────────────
interface ActionQueueProps {
  data: CoordinatorDashboard;
}

export function ActionQueue({ data }: ActionQueueProps) {
  const { translate } = useAccessibility();

  const { data: flaggedSessions = [] } = useOrgQuery(["coordinator-flagged-sessions"], {
    queryFn: getCoordinatorFlaggedSessions,
    staleTime: 60_000,
  });

  const { data: credentialData } = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
    staleTime: 5 * 60_000,
  });

  const items = useMemo<ActionItem[]>(() => {
    const creds    = fromCredentials(credentialData?.alerts ?? (data.credential_alerts as CredentialAlert[]) ?? []);
    const incidents = fromIncidents(data.incident_alerts ?? []);
    const flagged  = fromFlagged(flaggedSessions.filter((s) => s.compliance_score != null && s.compliance_score < 85));
    const docRisks = fromDocRisks(flaggedSessions);
    const workers  = fromWorkers(data.workers_needing_attention ?? []);

    const all = [...creds, ...incidents, ...flagged, ...docRisks, ...workers];
    return all.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  }, [data, flaggedSessions, credentialData]);

  const criticalCount = items.filter((i) => i.severity === "critical").length;
  const highCount     = items.filter((i) => i.severity === "high").length;

  if (items.length === 0) {
    return (
      <section
        className="rounded-xl border bg-white px-5 py-10 flex flex-col items-center text-center"
        style={{ borderColor: BORDER }}
      >
        <CheckCircle2 size={28} className="mb-3" style={{ color: "var(--cc-status-success)" }} />
        <p className="text-sm font-black" style={{ color: TEXT }}>All clear</p>
        <p className="mt-1 text-xs max-w-xs" style={{ color: MUTED }}>
          No compliance flags, pending credentials, or open incidents today.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border bg-white overflow-hidden"
      style={{ borderColor: BORDER }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{ borderColor: BORDER }}
      >
        <div className="flex items-center gap-2.5">
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
            Needs attention
          </h2>
          {(criticalCount > 0 || highCount > 0) && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-full"
              style={{
                background: criticalCount > 0 ? "rgba(220,38,38,0.1)" : "rgba(234,88,12,0.1)",
                color: criticalCount > 0 ? "#DC2626" : "#EA580C",
              }}
            >
              <AlertTriangle size={10} />
              {criticalCount > 0 ? `${criticalCount} critical` : `${highCount} high priority`}
            </span>
          )}
        </div>
        <span className="text-[12px] font-semibold" style={{ color: MUTED }}>
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Action rows */}
      <div className="divide-y" style={{ borderColor: BORDER }}>
        {items.slice(0, 10).map((item) => {
          const palette = SEV[item.severity];
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--cc-soft)] transition-colors"
            >
              {/* Severity dot + icon */}
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: palette.bg }}
              >
                <Icon size={14} style={{ color: palette.text }} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="text-[13px] font-bold truncate" style={{ color: TEXT }}>
                    {item.title}
                  </p>
                  <span
                    className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: palette.bg, color: palette.text }}
                  >
                    {item.category}
                  </span>
                </div>
                <p className="text-[11px] truncate" style={{ color: MUTED }}>
                  {item.detail}
                </p>
              </div>

              {/* Action */}
              <Link href={item.actionUrl}>
                <span
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-black px-3 py-1.5 rounded-lg whitespace-nowrap transition hover:opacity-80"
                  style={{ background: "var(--cc-active-bg)", color: "var(--cc-plum)" }}
                >
                  {item.actionLabel} <ArrowRight size={10} />
                </span>
              </Link>
            </div>
          );
        })}
      </div>

      {/* Footer — show more */}
      {items.length > 10 && (
        <div
          className="px-5 py-3 border-t text-center"
          style={{ borderColor: BORDER }}
        >
          <Link href="/compliance">
            <span className="text-[12px] font-black hover:opacity-75 transition" style={{ color: "var(--cc-plum)" }}>
              View all {items.length} items →
            </span>
          </Link>
        </div>
      )}
    </section>
  );
}
