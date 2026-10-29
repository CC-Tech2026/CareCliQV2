import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { WorkerBannerToastContent } from "@/components/worker/WorkerBannerToastContent";
import {
  acknowledgeNotification,
  dismissNotification,
  type UserNotification,
} from "@/services/notificationService";
import { showDesktopNotification } from "@/lib/desktop-notifications";
import { notificationAccentColor } from "@/lib/notification-copy";
import { notificationDestination, type NotificationAudience } from "@/lib/notification-destination";
import {
  isBannerNotification,
  isMobileViewport,
  shouldDismissBannerOnView,
  shouldShowDesktopNotification,
  shouldShowToast,
} from "@/lib/notification-display";

const MOBILE_BANNER_TOAST_MS = 5_000;

const presentedIds = new Set<string>();

export function clearPresentedNotifications(): void {
  presentedIds.clear();
}

export function seedPresentedNotificationIds(ids: string[]): void {
  for (const id of ids) presentedIds.add(id);
}

export function parseRealtimeNotificationRow(
  row: Record<string, unknown>,
): UserNotification | null {
  if (!row.id || !row.title) return null;
  return {
    id: String(row.id),
    event_type: String(row.event_type ?? ""),
    title: String(row.title),
    body: String(row.body ?? ""),
    severity: String(row.severity ?? "medium"),
    shift_id: (row.shift_id as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    action_url: (row.action_url as string | null) ?? null,
    banner_style: (row.banner_style as UserNotification["banner_style"]) ?? null,
    requires_ack: Boolean(row.requires_ack),
    acknowledged_at: (row.acknowledged_at as string | null) ?? null,
    read_at: (row.read_at as string | null) ?? null,
    dismissed_at: (row.dismissed_at as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

export type { NotificationAudience } from "@/lib/notification-destination";

/** Where a toast, desktop pop-up or the panel sends someone. Notifications
 *  with nothing specific to open land on their own full view in the inbox. */
export function resolveNotificationPath(
  notification: UserNotification,
  audience: NotificationAudience = "worker",
): string {
  return notificationDestination(notification, audience)?.path ?? `/notifications?open=${notification.id}`;
}

function toastVariant(
  notification: UserNotification,
): "default" | "destructive" {
  if (notification.banner_style === "red") return "destructive";
  if (notification.severity === "urgent" || notification.severity === "high") {
    return "destructive";
  }
  return "default";
}

function markMobileBannerSeen(notification: UserNotification) {
  if (notification.requires_ack && !notification.acknowledged_at) {
    void acknowledgeNotification(notification.id);
    return;
  }
  if (!notification.dismissed_at && shouldDismissBannerOnView(notification)) {
    void dismissNotification(notification.id);
  }
}

function mobileBannerToastClass(notification: UserNotification): string {
  return [
    "items-start gap-3 rounded-xl border border-slate-200/80 bg-white py-3.5 pl-4 pr-10 text-slate-900",
    "shadow-[0_10px_40px_rgba(15,23,42,0.14)]",
    "data-[state=open]:slide-in-from-top-2",
  ].join(" ");
}

function presentMobileBannerNotificationToast(notification: UserNotification): void {
  const accent = notificationAccentColor(notification.banner_style);

  toast({
    title: notification.title,
    description: <WorkerBannerToastContent notification={notification} />,
    duration: MOBILE_BANNER_TOAST_MS,
    variant: "default",
    className: mobileBannerToastClass(notification),
    style: { borderLeftWidth: 3, borderLeftColor: accent.text },
    onDismiss: () => markMobileBannerSeen(notification),
  });
}

export function presentWorkerNotification(
  notification: UserNotification,
  navigate: (path: string) => void,
  audience: NotificationAudience = "worker",
): void {
  if (presentedIds.has(notification.id)) return;
  if (notification.dismissed_at) return;
  presentedIds.add(notification.id);

  const path = resolveNotificationPath(notification, audience);
  const open = () => navigate(path);

  // Sticky banners (and their mobile toast form) are a worker-only surface;
  // office staff get every notification as a regular toast.
  const isWorkerBanner = audience === "worker" && isBannerNotification(notification);

  if (!document.hidden && isWorkerBanner && isMobileViewport()) {
    presentMobileBannerNotificationToast(notification);
    return;
  }

  if (!document.hidden && (audience !== "worker" || shouldShowToast(notification))) {
    toast({
      title: notification.title,
      description: notification.body,
      duration: 8_000,
      variant: toastVariant(notification),
      action: (
        <ToastAction altText="Open notification" onClick={open}>
          Open
        </ToastAction>
      ),
    });
  }

  if (shouldShowDesktopNotification(notification)) {
    showDesktopNotification(notification.title, notification.body, {
      tag: notification.id,
      requireInteraction: Boolean(notification.requires_ack),
      url: path,
      onClick: open,
    });
  }
}

/** sw.js hands a push to the visible tab instead of the OS; show it in-app.
 *  Realtime usually got there first, in which case the shared id dedupes it. */
export function presentPushedNotification(
  payload: { tag?: string; title?: string; body?: string; url?: string; urgent?: boolean; event?: string },
  navigate: (path: string) => void,
  audience: NotificationAudience,
): void {
  if (!payload.tag || !payload.title) return;
  presentWorkerNotification(
    {
      id: payload.tag,
      event_type: payload.event ?? "",
      title: payload.title,
      body: payload.body ?? "",
      severity: payload.urgent ? "high" : "medium",
      action_url: payload.url ?? null,
      created_at: new Date().toISOString(),
    },
    navigate,
    audience,
  );
}
