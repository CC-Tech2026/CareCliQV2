import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseRealtimeConfigured } from "@/lib/supabase";
import { X, AlertTriangle, Info, ChevronRight } from "lucide-react";
import {
  acknowledgeNotification,
  dismissNotification,
  fetchNotifications,
  type UserNotification,
} from "@/services/notificationService";
import { isActiveBanner, shouldDismissBannerOnView } from "@/lib/notification-display";
import { resolveNotificationPath } from "@/lib/worker-notification-presenter";

/** Sticky banner stack — see notification-display.ts (A ticket strict, B view = dismiss). */
const BANNER_STYLES = {
  red: {
    accent: "#DC2626",
    bg: "#FEF2F2",
    border: "#FECACA",
    text: "#991B1B",
    muted: "#B91C1C",
  },
  orange: {
    accent: "#EA580C",
    bg: "#FFF7ED",
    border: "#FDBA74",
    text: "#9A3412",
    muted: "#C2410C",
  },
  yellow: {
    accent: "#CA8A04",
    bg: "#FEFCE8",
    border: "#FDE047",
    text: "#854D0E",
    muted: "#A16207",
  },
};

function BannerItem({
  notification,
  onDismiss,
  onAck,
  onViewDetails,
}: {
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
                View details
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
                Acknowledged
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg p-1.5 transition hover:bg-black/5"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDismiss();
                }}
                aria-label="Dismiss notification"
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

export function NotificationBannerStack() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();

  const { data } = useOrgQuery(["notification-banners", orgId], {
    queryFn: () => fetchNotifications({ banners_only: true }),
    refetchInterval: isSupabaseRealtimeConfigured() ? false : 30_000,
    enabled: !!user && user.role === "support_worker",
  });

  const banners = (data?.notifications ?? []).filter(isActiveBanner);
  const bannersQueryKey = [orgId, "notification-banners", orgId] as const;
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

  if (!visibleBanners.length) return null;

  return (
    <section
      className="border-b px-5 py-4 md:px-8"
      style={{
        background: "var(--cc-bg)",
        borderColor: "var(--cc-border)",
      }}
      aria-label="Important alerts"
    >
      {/* <p
        className="mb-3 text-[10px] font-black uppercase tracking-[0.18em]"
        style={{ color: "var(--cc-muted)" }}
      >
        Requires your attention
      </p> */}
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {visibleBanners.map((n) => (
          <BannerItem
            key={n.id}
            notification={n}
            onDismiss={() => dismissBanner(n.id)}
            onAck={() => ackBanner(n.id)}
            onViewDetails={() => dismissBanner(n.id)}
          />
        ))}
      </div>
    </section>
  );
}
