import { CCQ_DESKTOP_NOTIFICATIONS_KEY } from "@/lib/storage-keys";

export type DesktopNotificationPermission = NotificationPermission | "unsupported";

export function getDesktopNotificationSupport(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getDesktopNotificationPermission(): DesktopNotificationPermission {
  if (!getDesktopNotificationSupport()) return "unsupported";
  return Notification.permission;
}

export function isDesktopNotificationsEnabled(): boolean {
  if (getDesktopNotificationPermission() !== "granted") return false;
  try {
    // Granted before this setting existed counts as on; only an explicit
    // "Turn off" stops them.
    return localStorage.getItem(CCQ_DESKTOP_NOTIFICATIONS_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setDesktopNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CCQ_DESKTOP_NOTIFICATIONS_KEY, String(enabled));
  } catch {
    /* noop */
  }
}

export function showDesktopNotification(
  title: string,
  body: string,
  opts?: {
    tag?: string;
    requireInteraction?: boolean;
    url?: string;
    onClick?: () => void;
  },
): void {
  if (!getDesktopNotificationSupport()) return;
  if (!isDesktopNotificationsEnabled()) return;

  const options: NotificationOptions = {
    body,
    // The pushed copy (public/sw.js) uses the same tag, so whichever arrives
    // second silently replaces the first instead of alerting twice.
    tag: opts?.tag,
    requireInteraction: opts?.requireInteraction ?? false,
    icon: "/favicon.png",
    data: { url: opts?.url ?? window.location.pathname },
  };

  if (!("serviceWorker" in navigator)) {
    showPageNotification(title, options, opts?.onClick);
    return;
  }
  // Android Chrome only allows notifications through a service worker; taps
  // on those are routed by sw.js (carecliq:navigate) instead of onClick.
  navigator.serviceWorker
    .getRegistration("/sw.js")
    .then((registration) => {
      if (registration) return registration.showNotification(title, options);
      showPageNotification(title, options, opts?.onClick);
      return undefined;
    })
    .catch(() => showPageNotification(title, options, opts?.onClick));
}

function showPageNotification(title: string, options: NotificationOptions, onClick?: () => void): void {
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  } catch {
    /* blocked context */
  }
}
