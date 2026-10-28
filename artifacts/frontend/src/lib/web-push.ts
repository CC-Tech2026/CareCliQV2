import { jsonFetch } from "@/services/http";
import { CCQ_WEB_PUSH_USER_KEY } from "@/lib/storage-keys";
import { setDesktopNotificationsEnabled } from "@/lib/desktop-notifications";

/**
 * Browser push: lets this browser show CareCliQ alerts while no tab is open.
 * public/sw.js receives the push and shows the OS notification; the backend
 * (web_push_service.py) sends to every subscription the user has.
 */

const SW_URL = "/sw.js";

export type PushDevice = {
  device_id: string;
  platform: "ios" | "android" | "web" | string;
  token_type: "expo" | "fcm" | "webpush" | string;
  label: string | null;
  registered_at: string | null;
};

export type PushDevicesResponse = {
  devices: PushDevice[];
  web_push: { enabled: boolean; public_key: string | null };
};

export type TestPushResult = {
  app: { devices: number; delivered: number; enabled: boolean };
  browser: { devices: number; delivered: number; enabled: boolean };
};

export type EnableResult = "enabled" | "in_tab_only" | "denied" | "dismissed" | "unsupported" | "needs_install";

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad only allow web notifications from a Home Screen app (iOS 16.4+). */
export function needsHomeScreenInstall(): boolean {
  return typeof window !== "undefined" && isIos() && !isStandalone();
}

export function describeThisBrowser(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = isIos()
    ? "iPhone or iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Same id the backend derives (device_id_for_endpoint) so we can mark "this browser". */
export async function deviceIdForEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `web:${hex.slice(0, 40)}`;
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL);
  } catch {
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export function fetchPushDevices(): Promise<PushDevicesResponse> {
  return jsonFetch<PushDevicesResponse>("/api/notifications/devices");
}

export function sendTestPush(): Promise<TestPushResult> {
  return jsonFetch<TestPushResult>("/api/notifications/devices/test", { method: "POST" });
}

async function subscribeAndRegister(publicKey: string): Promise<boolean> {
  const registration = await getServiceWorkerRegistration();
  if (!registration) return false;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = subscription.toJSON();
  const result = await jsonFetch<{ registered: boolean }>("/api/notifications/devices/web-push", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: describeThisBrowser() }),
  });
  return result.registered;
}

/** Asks for permission (must run from a click) and subscribes this browser. */
export async function enableDeviceNotifications(userId: string): Promise<EnableResult> {
  if (!isNotificationSupported()) return needsHomeScreenInstall() ? "needs_install" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "dismissed";
  setDesktopNotificationsEnabled(true);

  if (!isWebPushSupported()) return "in_tab_only";
  try {
    const { web_push } = await fetchPushDevices();
    if (!web_push.enabled || !web_push.public_key) return "in_tab_only";
    const registered = await subscribeAndRegister(web_push.public_key);
    if (!registered) return "in_tab_only";
    localStorage.setItem(CCQ_WEB_PUSH_USER_KEY, userId);
    return "enabled";
  } catch {
    return "in_tab_only";
  }
}

export async function disableDeviceNotifications(): Promise<void> {
  setDesktopNotificationsEnabled(false);
  try {
    localStorage.removeItem(CCQ_WEB_PUSH_USER_KEY);
  } catch {
    /* noop */
  }
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  await jsonFetch("/api/notifications/devices/web-push/remove", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}

/**
 * On sign-in: keep this browser's subscription registered for the user who
 * turned it on (subscriptions rotate, and the server prunes dead ones).
 * Never subscribes anyone who didn't opt in on this browser themselves.
 */
export async function syncDeviceNotifications(userId: string): Promise<void> {
  if (!isWebPushSupported() || Notification.permission !== "granted") return;
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(CCQ_WEB_PUSH_USER_KEY);
  } catch {
    return;
  }
  if (owner !== userId) return;
  try {
    const { web_push } = await fetchPushDevices();
    if (web_push.enabled && web_push.public_key) await subscribeAndRegister(web_push.public_key);
  } catch {
    /* offline or not deployed yet; retried next sign-in */
  }
}

/**
 * On sign-out: drop this browser's subscription so a shared computer stops
 * showing the previous person's alerts. No auth needed: once unsubscribed,
 * the push service answers 410 and the server deletes the row itself.
 */
export async function releaseDeviceNotificationsOnSignOut(): Promise<void> {
  const subscription = await getCurrentSubscription();
  await subscription?.unsubscribe().catch(() => false);
}
