import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { isSupabaseRealtimeConfigured } from "@/lib/supabase";
import { X, AlertTriangle, Info, ChevronRight, ChevronDown } from "lucide-react";
import {
  acknowledgeNotification,
  dismissNotification,
  fetchNotifications,
  type UserNotification,
} from "@/services/notificationService";
import { isActiveBanner, shouldDismissBannerOnView, shouldShowStickyBannerStack } from "@/lib/notification-display";
import { resolveNotificationPath } from "@/lib/worker-notification-presenter";
import { useAccessibility } from "@/contexts/AccessibilityContext";

/** Sticky banner stack — see notification-display.ts (A ticket strict, B view = dismiss). */
const BANNER_STYLES = {
  red: {
    accent: "var(--cc-status-danger)",
    bg: "var(--cc-status-danger-bg)",
    border: "color-mix(in srgb, var(--cc-status-danger) 35%, transparent)",
    text: "var(--cc-status-danger)",
    muted: "var(--cc-muted)",
  },
  orange: {
    accent: "var(--cc-status-warning)",
    bg: "var(--cc-status-warning-bg)",
    border: "color-mix(in srgb, var(--cc-status-warning) 35%, transparent)",
    text: "var(--cc-status-warning)",
    muted: "var(--cc-muted)",
  },
  yellow: {
    accent: "var(--cc-amber)",
    bg: "var(--cc-amber-tint)",
    border: "color-mix(in srgb, var(--cc-amber) 35%, transparent)",
    text: "var(--cc-status-warning)",
    muted: "var(--cc-muted)",
  },
};

function BannerItem({
  notification,
  onDismiss,
  onAck,
  onViewDetails,
  translate,
}: {
  translate: (key: string) => string;
  notification: UserNotification;
  onDismiss: () => void;
  onAck: () => void;
  onViewDetails: () => void;
}) {
  const [, navigate] = useLocation();
  const style =
    BANNER_STYLES[notification.banner_style as keyof typeof BANNER_STYLES] ??
    BANNER_STYLES.orange;
  const Icon = notification.banner_style === "red" ? AlertTriangle : Info;
  const path = resolveNotificationPath(notification);
  const needsAck = notification.requires_ack && !notification.acknowledged_at;

  return (
    <article
      className="overflow-hidden rounded-2xl border shadow-sm"
      style={{
        background: style.bg,
        borderColor: style.border,
        boxShadow: "0 4px 14px rgba(30, 22, 64, 0.06)",
      }}
    >
      <div className="flex gap-0">
        <div className="w-1.5 shrink-0" style={{ background: style.accent }} />
        <div className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5">
          <div
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{ background: `${style.accent}18`, color: style.accent }}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black tracking-tight" style={{ color: style.text }}>
              {notification.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: style.muted }}>
              {notification.body}
            </p>
            {path && (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs font-bold underline-offset-2 hover:underline"
                style={{ color: style.accent }}
                onClick={() => {
                  if (shouldDismissBannerOnView(notification)) {
                    onViewDetails();
                  }
                  navigate(path);
                }}
              >
{translate("worker.notification.viewDetails")}
                <ChevronRight size={14} />
              </button>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {needsAck ? (
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-sm cursor-pointer"
                style={{ background: style.accent }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAck();
                }}
              >
{translate("worker.notification.acknowledged")}
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg p-1.5 transition hover:bg-black/5 dark:hover:bg-white/10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDismiss();
                }}
aria-label={translate("worker.notification.dismiss")}
              >
                <X size={16} style={{ color: style.text }} />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function GroupedBannerItem({
  title,
  notifications,
  expanded,
  onToggle,
  onDismiss,
  onAck,
  onViewDetails,
  translate,
}: {
  title: string;
  notifications: UserNotification[];
  expanded: boolean;
  onToggle: () => void;
  onDismiss: (id: string) => void;
  onAck: (id: string) => void;
  onViewDetails: (id: string) => void;
  translate: (key: string) => string;
}) {
  const first = notifications[0];
  const style =
    BANNER_STYLES[first.banner_style as keyof typeof BANNER_STYLES] ?? BANNER_STYLES.orange;
  const Icon = first.banner_style === "red" ? AlertTriangle : Info;
  const anyNeedsAck = notifications.some((n) => n.requires_ack && !n.acknowledged_at);

  if (expanded) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 px-1 text-xs font-black"
          style={{ color: style.accent }}
        >
          <ChevronDown size={14} className="rotate-180" />
          {translate("worker.notification.collapse")}
        </button>
        {notifications.map((n) => (
          <BannerItem
            key={n.id}
            notification={n}
            onDismiss={() => onDismiss(n.id)}
            onAck={() => onAck(n.id)}
            onViewDetails={() => onViewDetails(n.id)}
            translate={translate}
          />
        ))}
      </div>
    );
  }

  return (
    <article
      className="overflow-hidden rounded-2xl border shadow-sm"
      style={{
        background: style.bg,
        borderColor: style.border,
        boxShadow: "0 4px 14px rgba(30, 22, 64, 0.06)",
      }}
    >
      <div className="flex gap-0">
        <div className="w-1.5 shrink-0" style={{ background: style.accent }} />
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left"
        >
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{ background: `${style.accent}18`, color: style.accent }}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black tracking-tight" style={{ color: style.text }}>
              {title}
              <span
                className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-black text-white"
                style={{ background: style.accent }}
              >
                {notifications.length}
              </span>
            </p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: style.muted }}>
              {anyNeedsAck
                ? translate("worker.notification.groupNeedsAck")
                : translate("worker.notification.groupTapToView")}
            </p>
          </div>
          <ChevronDown size={16} style={{ color: style.text }} className="shrink-0" />
        </button>
      </div>
    </article>
  );
}

export function NotificationBannerStack() {
  const { translate } = useAccessibility();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();

  const { data } = useOrgQuery(["notification-banners"], {
    queryFn: () => fetchNotifications({ banners_only: true }),
    refetchInterval: isSupabaseRealtimeConfigured() ? false : 60_000,
    enabled: !!user && user.role === "support_worker",
  });

  const banners = (data?.notifications ?? []).filter(isActiveBanner);
  const bannersQueryKey = [orgId, "notification-banners"] as const;
  const [hiddenBannerIds, setHiddenBannerIds] = useState<Set<string>>(() => new Set());

  const hideBannerNow = useCallback(
    (id: string) => {
      setHiddenBannerIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      qc.setQueryData<{ notifications: UserNotification[]; count: number }>(
        bannersQueryKey,
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            notifications: prev.notifications.map((n) =>
              n.id === id ? { ...n, dismissed_at: n.dismissed_at ?? new Date().toISOString() } : n,
            ),
          };
        },
      );
    },
    [bannersQueryKey, qc],
  );

  /** Instant UI hide; persist dismiss in background (B — view = dismiss). */
  const dismissBanner = useCallback(
    (id: string) => {
      hideBannerNow(id);
      void dismissNotification(id).catch(() => {
        setHiddenBannerIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        void qc.invalidateQueries({ queryKey: [orgId, "notification-banners"] });
      });
    },
    [hideBannerNow, orgId, qc],
  );

  const ackBanner = useCallback(
    (id: string) => {
      hideBannerNow(id);
      void acknowledgeNotification(id).catch(() => {
        setHiddenBannerIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        void qc.invalidateQueries({ queryKey: [orgId, "notification-banners"] });
        void qc.invalidateQueries({ queryKey: [orgId, "notification-history"] });
      });
    },
    [hideBannerNow, orgId, qc],
  );

  const visibleBanners = banners.filter((n) => !hiddenBannerIds.has(n.id));

  const groups: { title: string; notifications: UserNotification[] }[] = [];
  for (const n of visibleBanners) {
    const existing = groups.find((g) => g.title === n.title);
    if (existing) existing.notifications.push(n);
    else groups.push({ title: n.title, notifications: [n] });
  }

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  if (!shouldShowStickyBannerStack() || isMobile || !visibleBanners.length) return null;

  return (
    <section
      className="fixed right-5 top-[70px] z-40 w-[380px] max-w-[calc(100vw-2.5rem)] max-h-[calc(100vh-90px)] overflow-y-auto"
      aria-label={translate("worker.notification.alerts")}
    >
      <div className="flex w-full flex-col gap-3">
        {groups.map((g) =>
          g.notifications.length === 1 ? (
            <BannerItem
              key={g.notifications[0].id}
              notification={g.notifications[0]}
              onDismiss={() => dismissBanner(g.notifications[0].id)}
              onAck={() => ackBanner(g.notifications[0].id)}
              translate={translate}
              onViewDetails={() => dismissBanner(g.notifications[0].id)}
            />
          ) : (
            <GroupedBannerItem
              key={g.title}
              title={g.title}
              notifications={g.notifications}
              expanded={expandedGroups.has(g.title)}
              onToggle={() => toggleGroup(g.title)}
              onDismiss={dismissBanner}
              onAck={ackBanner}
              onViewDetails={dismissBanner}
              translate={translate}
            />
          ),
        )}
      </div>
    </section>
  );
}
