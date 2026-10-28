import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Laptop, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { isDesktopNotificationsEnabled } from "@/lib/desktop-notifications";
import {
  deviceIdForEndpoint,
  disableDeviceNotifications,
  enableDeviceNotifications,
  fetchPushDevices,
  getCurrentSubscription,
  isNotificationSupported,
  needsHomeScreenInstall,
  sendTestPush,
  type PushDevice,
} from "@/lib/web-push";

type DeviceState = "on" | "in_tab" | "off" | "blocked" | "unsupported" | "needs_install";

const DEVICES_KEY = ["notification-devices"];

function readPermissionState(): DeviceState {
  if (needsHomeScreenInstall()) return "needs_install";
  if (!isNotificationSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return isDesktopNotificationsEnabled() ? "in_tab" : "off";
}

/** One row per physical device: the app registers Expo and FCM tokens under
 *  "<id>" and "<id>:fcm", which are the same phone. */
function uniqueDevices(devices: PushDevice[]): PushDevice[] {
  const seen = new Map<string, PushDevice>();
  for (const device of devices) {
    const key = device.device_id.replace(/:fcm$/, "");
    if (!seen.has(key)) seen.set(key, device);
  }
  return [...seen.values()];
}

/**
 * "Notifications on this device": turn OS pop-ups on or off for this browser,
 * send a test to every registered device, and list where alerts will go.
 * Renders content only; the page supplies its own section chrome.
 */
export function DeviceNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const qc = useQueryClient();
  const [state, setState] = useState<DeviceState>(readPermissionState);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);

  const { data } = useQuery({ queryKey: DEVICES_KEY, queryFn: fetchPushDevices, enabled: !!user });

  useEffect(() => {
    void getCurrentSubscription().then(async (sub) => {
      setThisDeviceId(sub ? await deviceIdForEndpoint(sub.endpoint) : null);
    });
  }, [data]);

  const devices = uniqueDevices(data?.devices ?? []);
  const thisBrowserRegistered = !!thisDeviceId && devices.some((d) => d.device_id === thisDeviceId);
  const shownState: DeviceState = state === "in_tab" && thisBrowserRegistered ? "on" : state;

  async function turnOn() {
    if (!user) return;
    setBusy("toggle");
    try {
      const result = await enableDeviceNotifications(user.id);
      if (result === "denied") {
        setState("blocked");
      } else if (result === "enabled" || result === "in_tab_only") {
        setState("in_tab");
        toast({ title: translate("devices.toast.on") });
      } else if (result === "needs_install" || result === "unsupported") {
        setState(result);
      }
      await qc.invalidateQueries({ queryKey: DEVICES_KEY });
    } finally {
      setBusy(null);
    }
  }

  async function turnOff() {
    setBusy("toggle");
    try {
      await disableDeviceNotifications();
      setState("off");
      setThisDeviceId(null);
      toast({ title: translate("devices.toast.off") });
      await qc.invalidateQueries({ queryKey: DEVICES_KEY });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const result = await sendTestPush();
      const total = result.app.devices + result.browser.devices;
      const delivered = result.app.delivered + result.browser.delivered;
      if (total === 0) {
        toast({ title: translate("devices.test.noneTitle"), description: translate("devices.test.none") });
      } else if (delivered === 0) {
        toast({
          variant: "destructive",
          title: translate("devices.test.failedTitle"),
          description: translate("devices.test.failed"),
        });
      } else {
        toast({
          title: translate("devices.test.sentTitle"),
          description: translateParams("devices.test.sent", {
            delivered: String(delivered),
            total: String(total),
          }),
        });
      }
      await qc.invalidateQueries({ queryKey: DEVICES_KEY });
    } catch (err) {
      toast({
        variant: "destructive",
        title: translate("devices.test.failedTitle"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  function deviceLabel(device: PushDevice): string {
    if (device.device_id === thisDeviceId) return translate("devices.thisBrowser");
    if (device.token_type === "webpush") return device.label || translate("devices.browser");
    if (device.platform === "ios") return translate("devices.iosApp");
    if (device.platform === "android") return translate("devices.androidApp");
    return translate("devices.app");
  }

  const canToggle = shownState !== "unsupported" && shownState !== "needs_install" && shownState !== "blocked";
  const isOn = shownState === "on" || shownState === "in_tab";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm" style={{ color: "var(--cc-text)" }}>
          {translate(`devices.status.${shownState}`)}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canToggle &&
            (isOn ? (
              <Button type="button" variant="outline" className="rounded-xl" disabled={busy !== null} onClick={() => void turnOff()}>
                {busy === "toggle" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
                {translate("devices.turnOff")}
              </Button>
            ) : (
              <Button
                type="button"
                className="rounded-xl text-white"
                style={{ background: "var(--cc-cta)" }}
                disabled={busy !== null}
                onClick={() => void turnOn()}
              >
                {busy === "toggle" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                {translate("devices.turnOn")}
              </Button>
            ))}
          <Button type="button" variant="outline" className="rounded-xl" disabled={busy !== null} onClick={() => void test()}>
            {busy === "test" && <Loader2 className="h-4 w-4 animate-spin" />}
            {translate("devices.test.button")}
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--cc-muted)" }}>
          {translate("devices.listTitle")}
        </p>
        {devices.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
            {translate("devices.listEmpty")}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white" style={{ borderColor: "var(--cc-border)" }}>
            {devices.map((device) => {
              const Icon = device.token_type === "webpush" ? Laptop : Smartphone;
              return (
                <li key={device.device_id} className="flex items-center gap-3 px-4 py-2.5 text-sm" style={{ borderColor: "var(--cc-border)" }}>
                  <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--cc-muted)" }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate" style={{ color: "var(--cc-text)" }}>
                    {deviceLabel(device)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
