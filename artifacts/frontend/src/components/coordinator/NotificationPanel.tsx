import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import {
  Bell, X, CheckCheck, AlertTriangle, Calendar, CheckCircle2,
  MessageSquare, Clock,
} from "lucide-react";
import {
  getCoordinatorNotifications, markNotificationRead, markAllNotificationsRead,
  type CoordinatorAlert,
} from "@/services/coordinatorService";

const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

function relativeTime(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ALERT_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  emergency:          { icon: <AlertTriangle size={14} />, color: CORAL,    bg: "#FEF2F2" },
  coordinator_flag:   { icon: <AlertTriangle size={14} />, color: "#D97706", bg: "#FFFBEB" },
  no_session_started: { icon: <Clock size={14} />,         color: "#D97706", bg: "#FFFBEB" },
  no_notes_recorded:  { icon: <Clock size={14} />,         color: "#3B82F6", bg: "#EFF6FF" },
  shift_assigned:     { icon: <Calendar size={14} />,      color: PLUM,     bg: SOFT      },
  feedback_received:  { icon: <MessageSquare size={14} />, color: "#059669", bg: "#ECFDF5" },
  session_completed:  { icon: <CheckCircle2 size={14} />,  color: "#059669", bg: "#ECFDF5" },
};

function alertMeta(alertType?: string) {
  return alertType
    ? (ALERT_META[alertType] ?? { icon: <Bell size={14} />, color: MUTED, bg: SOFT })
    : { icon: <Bell size={14} />, color: MUTED, bg: SOFT };
}

function AlertRow({
  alert,
  onRead,
}: {
  alert: CoordinatorAlert;
  onRead: (id: string) => void;
}) {
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
          {alert.message ?? "Notification"}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-[10px] font-semibold uppercase"
            style={{ color: meta.color }}
          >
            {(alert.alert_type ?? "alert").replace(/_/g, " ")}
          </span>
          <span className="text-[10px]" style={{ color: MUTED }}>
            {relativeTime(alert.created_at)}
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

// ── Main panel ─────────────────────────────────────────────────────────────────
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();

  const { data: alerts = [], isLoading } = useOrgQuery<CoordinatorAlert[]>(["coordinator-notifications", orgId], { queryFn: () => getCoordinatorNotifications({ limit: 80 }), refetchInterval: 15000 });

  const unread = alerts.filter((a) => !a.is_read).length;

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
      className="fixed top-0 right-0 h-full w-[380px] max-w-full z-50 flex flex-col shadow-2xl"
      style={{ background: "#fff", borderLeft: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2.5">
          <Bell size={18} style={{ color: PLUM }} />
          <h2 className="text-[15px] font-black" style={{ color: TEXT }}>Notifications</h2>
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
              className="text-[11px] font-semibold flex items-center gap-1"
              style={{ color: MUTED }}
              onClick={() => readAllMut.mutate()}
            >
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
          <button
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
            onClick={onClose}
          >
            <X size={16} style={{ color: MUTED }} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: PLUM }} />
          </div>
        )}

        {!isLoading && alerts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Bell size={32} style={{ color: BORDER }} />
            <p className="text-[13px] font-semibold" style={{ color: MUTED }}>All caught up</p>
          </div>
        )}

        {!isLoading &&
          alerts.map((alert) => (
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
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: alerts = [] } = useOrgQuery<CoordinatorAlert[]>(["coordinator-notifications", orgId], { queryFn: () => getCoordinatorNotifications({ limit: 80, unread_only: true }), refetchInterval: 30000, enabled: !!user });

  const unread = alerts.length;

  return (
    <button
      className="relative p-2 rounded-full hover:bg-black/5 transition-colors"
      onClick={onClick}
      title="Notifications"
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
