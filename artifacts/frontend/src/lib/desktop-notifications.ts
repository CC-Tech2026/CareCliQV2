const DESKTOP_PREF_KEY = "carescribe_desktop_notifications";

export type DesktopNotificationPermission = NotificationPermission | "unsupported";

export function getDesktopNotificationSupport(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getDesktopNotificationPermission(): DesktopNotificationPermission {
  if (!getDesktopNotificationSupport()) return "unsupported";
  return Notification.permission;
}

export function isDesktopNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(DESKTOP_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

export function setDesktopNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DESKTOP_PREF_KEY, String(enabled));
  } catch {
    /* noop */
  }
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (!getDesktopNotificationSupport()) return "unsupported";
  const result = await Notification.requestPermission();
  setDesktopNotificationsEnabled(result === "granted");
  return result;
}

export function showDesktopNotification(
  title: string,
  body: string,
  opts?: {
    tag?: string;
    requireInteraction?: boolean;
    onClick?: () => void;
  },
): void {
  if (!getDesktopNotificationSupport()) return;
  if (Notification.permission !== "granted") return;
  if (!isDesktopNotificationsEnabled() && Notification.permission === "granted") {
    setDesktopNotificationsEnabled(true);
  }

  try {
    const notification = new Notification(title, {
      body,
      tag: opts?.tag,
      requireInteraction: opts?.requireInteraction ?? false,
      icon: "/favicon.ico",
    });
    notification.onclick = () => {
      window.focus();
      opts?.onClick?.();
      notification.close();
    };
  } catch {
    /* noop — Safari / blocked contexts */
  }
}
