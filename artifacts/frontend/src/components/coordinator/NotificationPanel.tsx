import { useState, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  Bell, X, CheckCheck, AlertTriangle, Calendar, CheckCircle2,
  MessageSquare, Clock, Search, Filter, UserPlus,
} from "lucide-react";
import {
  getCoordinatorNotifications, markNotificationRead, markAllNotificationsRead,
  type CoordinatorAlert,
} from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const SEVERITY_LEVELS: Record<string, { color: string; labelKey: string; bg: string }> = {
  critical: { color: "#DC2626", labelKey: "coordinator.notifications.severity.critical", bg: "#FEE2E2" },
  high: { color: "#F97316", labelKey: "coordinator.notifications.severity.high", bg: "#FFF7ED" },
  medium: { color: "#3B82F6", labelKey: "coordinator.notifications.severity.medium", bg: "#EFF6FF" },
  low: { color: "#10B981", labelKey: "coordinator.notifications.severity.low", bg: "#F0FDF4" },
};

function relativeTime(iso: string | undefined, translate: (k: string) => string, translateParams: (k: string, p: Record<string, string>) => string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return translate("coordinator.notifications.time.justNow");
  if (mins < 60) return translateParams("coordinator.notifications.time.minsAgo", { mins: String(mins) });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return translateParams("coordinator.notifications.time.hrsAgo", { hrs: String(hrs) });
  return translateParams("coordinator.notifications.time.daysAgo", { days: String(Math.floor(hrs / 24)) });
}

const ALERT_META: Record<string, { icon: React.ReactNode; color: string; bg: string; severity: string }> = {
  emergency:          { icon: <AlertTriangle size={14} />, color: CORAL,    bg: "#FEE2E2", severity: "critical" },
  coordinator_flag:   { icon: <AlertTriangle size={14} />, color: "#D97706", bg: "#FFFBEB", severity: "high" },
  no_session_started: { icon: <Clock size={14} />,         color: "#D97706", bg: "#FFFBEB", severity: "high" },
  no_notes_recorded:  { icon: <Clock size={14} />,         color: "#3B82F6", bg: "#EFF6FF", severity: "medium" },
  shift_assigned:     { icon: <Calendar size={14} />,      color: PLUM,     bg: SOFT,      severity: "low" },
  feedback_received:  { icon: <MessageSquare size={14} />, color: "#059669", bg: "#ECFDF5", severity: "low" },
  session_completed:  { icon: <CheckCircle2 size={14} />,  color: "#059669", bg: "#ECFDF5", severity: "low" },
  invite_request:     { icon: <UserPlus size={14} />,      color: PLUM,     bg: SOFT,      severity: "medium" },
};

function alertMeta(alertType?: string) {
  return alertType
    ? (ALERT_META[alertType] ?? { icon: <Bell size={14} />, color: MUTED, bg: SOFT, severity: "low" })
    : { icon: <Bell size={14} />, color: MUTED, bg: SOFT, severity: "low" };
}

function AlertRow({
  alert,
  onRead,
}: {
  alert: CoordinatorAlert;
  onRead: (id: string) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const meta = alertMeta(alert.alert_type);

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 cursor-pointer"
      style={{ opacity: alert.is_read ? 0.6 : 1 }}
      onClick={() => !alert.is_read && onRead(alert.id)}
    >
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: meta.bg, color: meta.color }}
      >
        {meta.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug" style={{ color: TEXT, fontWeight: alert.is_read ? 400 : 600 }}>
          {alert.message ?? translate("coordinator.notifications.default")}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-[10px] font-semibold uppercase"
            style={{ color: meta.color }}
          >
            {(alert.alert_type ?? "alert").replace(/_/g, " ")}
          </span>
          <span className="text-[10px]" style={{ color: MUTED }}>
            {relativeTime(alert.created_at, translate, translateParams)}
          </span>
        </div>
      </div>

      {/* Unread dot */}
      {!alert.is_read && (
        <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: PLUM }} />
      )}
    </div>
  );
}

// ── Main panel with filters and search ──────────────────────────────────────────
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data: alerts = [], isLoading } = useOrgQuery<CoordinatorAlert[]>(["coordinator-notifications", orgId], { queryFn: () => getCoordinatorNotifications({ limit: 80 }), refetchInterval: 45_000 });

  const filteredAlerts = useMemo(() => {
    let result = alerts;

    // Filter by severity
    if (severityFilter) {
      result = result.filter((a) => alertMeta(a.alert_type).severity === severityFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((a) =>
        (a.message?.toLowerCase() ?? "").includes(query) ||
        (a.alert_type?.toLowerCase() ?? "").includes(query)
      );
    }

    return result;
  }, [alerts, searchQuery, severityFilter]);

  const unread = filteredAlerts.filter((a) => !a.is_read).length;

  const readMut = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coordinator-notifications", orgId] }),
  });

  const readAllMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coordinator-notifications", orgId] }),
  });

  return (
    <div
      className="fixed top-0 right-0 h-full w-[420px] max-w-full z-50 flex flex-col shadow-2xl"
      style={{ background: "var(--cc-bg)", borderLeft: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Bell size={18} style={{ color: PLUM }} />
            <h2 className="text-[15px] font-black" style={{ color: TEXT }}>{translate("coordinator.notifications.title")}</h2>
            {unread > 0 && (
              <span
                className="min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black flex items-center justify-center"
                style={{ background: CORAL, color: "#fff" }}
              >
                {unread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-75 transition"
                style={{ color: MUTED }}
                onClick={() => readAllMut.mutate()}
              >
                <CheckCheck size={13} /> {translate("coordinator.notifications.markAllRead")}
              </button>
            )}
            <button
              aria-label={translate("coordinator.notifications.close")}
              className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
              onClick={onClose}
            >
              <X size={16} style={{ color: MUTED }} />
            </button>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-2.5" style={{ color: MUTED }} />
            <input
              type="text"
              placeholder={translate("coordinator.notifications.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: BORDER, "--tw-ring-color": `${PLUM}20` } as any}
            />
          </div>
          <button
            className="p-2 rounded-lg border transition-colors"
            style={{ borderColor: BORDER, background: showFilters ? SOFT : "transparent" }}
            onClick={() => setShowFilters(!showFilters)}
            title={translate("coordinator.notifications.filterSeverity")}
          >
            <Filter size={14} style={{ color: PLUM }} />
          </button>
        </div>

        {/* Severity Filter Tags */}
        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setSeverityFilter(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                severityFilter === null ? "ring-2" : "opacity-60 hover:opacity-100"
              }`}
              style={{
                color: TEXT,
                background: SOFT,
                ...(severityFilter === null && { "--tw-ring-color": PLUM, "--tw-ring-width": "2px" } as any),
              }}
            >
              All
            </button>
            {Object.entries(SEVERITY_LEVELS).map(([level, config]) => (
              <button
                key={level}
                onClick={() => setSeverityFilter(level)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  severityFilter === level ? "ring-2" : "opacity-60 hover:opacity-100"
                }`}
                style={{
                  color: config.color,
                  background: config.bg,
                  ...(severityFilter === level && { "--tw-ring-color": config.color, "--tw-ring-width": "2px" } as any),
                }}
              >
                {translate(config.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: PLUM }} />
          </div>
        )}

        {!isLoading && filteredAlerts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Bell size={32} style={{ color: BORDER }} />
            <p className="text-[13px] font-semibold" style={{ color: MUTED }}>
              {alerts.length === 0 ? translate("coordinator.notifications.allCaughtUp") : translate("coordinator.notifications.noMatch")}
            </p>
          </div>
        )}

        {!isLoading &&
          filteredAlerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onRead={(id) => readMut.mutate(id)}
            />
          ))}
      </div>
    </div>
  );
}

// ── Bell icon with badge (used in AppLayout header) ───────────────────────────
export function NotificationBell({ onClick }: { onClick: () => void }) {
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: alerts = [] } = useOrgQuery<CoordinatorAlert[]>(["coordinator-notifications", orgId], { queryFn: () => getCoordinatorNotifications({ limit: 80, unread_only: true }), refetchInterval: 60_000, enabled: !!user });

  const unread = alerts.length;

  return (
    <button
      className="relative p-2 rounded-full hover:bg-black/5 transition-colors"
      onClick={onClick}
      title={translate("coordinator.notifications.title")}
    >
      <Bell size={20} style={{ color: MUTED }} />
      {unread > 0 && (
        <span
          className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center"
          style={{ background: CORAL, color: "#fff" }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
