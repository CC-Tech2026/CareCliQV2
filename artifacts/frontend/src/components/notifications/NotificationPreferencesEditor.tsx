import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { getDeviceId } from "@/lib/device-id";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationChannel,
  type QuietHours,
} from "@/services/userService";

/** A row in the editor; toggling it sets every backend event in `keys`
 *  (NOTIFICATION_EVENTS in notification_service.py). */
export type NotificationPrefGroup = {
  id: string;
  keys: string[];
  label: string;
  description: string;
  /** Safety alerts: the pop-up can't be turned off. */
  popupLocked?: boolean;
};

type Prefs = Record<string, Record<NotificationChannel, boolean>>;
type Channel = "push" | "email";

const CHANNELS: { key: Channel; labelKey: string }[] = [
  { key: "push", labelKey: "notifPrefs.popup" },
  { key: "email", labelKey: "notifPrefs.email" },
];

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** What reaches you by pop-up and email, and quiet hours. Saves each change
 *  as it's made, so there's no Save button to forget. */
export function NotificationPreferencesEditor({ groups }: { groups: NotificationPrefGroup[] }) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const deviceId = getDeviceId();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [quiet, setQuiet] = useState<QuietHours>({ enabled: false, from: "22:00", to: "07:00", timezone: browserTimezone() });
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getNotificationPreferences<string>(deviceId)
      .then((data) => {
        setPrefs(data.preferences);
        setQuiet({
          enabled: data.quiet_hours?.enabled ?? false,
          from: data.quiet_hours?.from || "22:00",
          to: data.quiet_hours?.to || "07:00",
          timezone: data.quiet_hours?.timezone || browserTimezone(),
        });
      })
      .catch(() => setLoadFailed(true));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [deviceId]);

  // Debounced so dragging through times in the picker is one save, not ten.
  function persist(nextPrefs: Prefs, nextQuiet: QuietHours) {
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        // Saved in the zone of the browser doing the editing, so 22:00 means 22:00 here.
        await saveNotificationPreferences<string>(deviceId, nextPrefs, { ...nextQuiet, timezone: browserTimezone() || nextQuiet.timezone });
        setStatus("saved");
      } catch {
        setStatus("idle");
        toast({ variant: "destructive", title: translate("notifPrefs.saveFailed") });
      }
    }, 500);
  }

  function groupChecked(keys: string[], channel: Channel): boolean {
    return keys.some((key) => prefs?.[key]?.[channel] ?? true);
  }

  function toggleGroup(keys: string[], channel: Channel) {
    if (!prefs) return;
    const value = !groupChecked(keys, channel);
    const next = { ...prefs };
    for (const key of keys) next[key] = { ...(next[key] ?? { push: true, email: true, sms: false }), [channel]: value };
    setPrefs(next);
    persist(next, quiet);
  }

  function updateQuiet(patch: Partial<QuietHours>) {
    const next = { ...quiet, ...patch };
    setQuiet(next);
    if (prefs) persist(prefs, next);
  }

  if (loadFailed) {
    return <p role="alert" className="text-sm" style={{ color: "var(--cc-muted)" }}>{translate("notifPrefs.loadFailed")}</p>;
  }
  if (!prefs) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm" style={{ color: "var(--cc-muted)" }}>
        <Loader2 size={14} className="animate-spin" /> {translate("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-bold" style={{ color: "var(--cc-text)" }}>{translate("notifPrefs.title")}</p>
            <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>{translate("notifPrefs.hint")}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }} role="status" aria-live="polite">
            {status === "saving" && <><Loader2 size={12} className="animate-spin" /> {translate("notifPrefs.saving")}</>}
            {status === "saved" && <><Check size={12} /> {translate("notifPrefs.saved")}</>}
          </span>
        </div>
        <div className="rounded-xl border bg-white" style={{ borderColor: "var(--cc-border)" }}>
          <div className="hidden grid-cols-[1fr_5rem_5rem] gap-3 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest md:grid" style={{ color: "var(--cc-muted)", borderColor: "var(--cc-border)" }}>
            <span>{translate("notifPrefs.event")}</span>
            {CHANNELS.map((c) => <span key={c.key} className="text-center">{translate(c.labelKey)}</span>)}
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
            {groups.map((group) => (
              <li key={group.id} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_5rem_5rem] md:items-center" style={{ borderColor: "var(--cc-border)" }}>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>{group.label}</p>
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>{group.description}</p>
                </div>
                {CHANNELS.map((c) => {
                  const locked = c.key === "push" && group.popupLocked;
                  return (
                    <label key={c.key} className="flex items-center justify-between gap-2 md:justify-center">
                      <span className="text-[12px] font-semibold md:hidden" style={{ color: "var(--cc-text)" }}>{translate(c.labelKey)}</span>
                      <Switch
                        aria-label={`${translate(c.labelKey)}: ${group.label}`}
                        checked={locked ? true : groupChecked(group.keys, c.key)}
                        disabled={locked}
                        onCheckedChange={() => toggleGroup(group.keys, c.key)}
                      />
                    </label>
                  );
                })}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl p-4" style={{ background: "var(--cc-soft)", border: "1px solid var(--cc-border)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[14px] font-bold" style={{ color: "var(--cc-text)" }}>{translate("notifPrefs.quiet.title")}</p>
            <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>{translate("notifPrefs.quiet.hint")}</p>
          </div>
          <Switch aria-label={translate("notifPrefs.quiet.title")} checked={quiet.enabled} onCheckedChange={(enabled) => updateQuiet({ enabled })} />
        </div>
        {quiet.enabled && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: "var(--cc-muted)" }}>{translate("notifPrefs.quiet.from")}</span>
              <TimePicker value={quiet.from} onChange={(from) => updateQuiet({ from })} className="rounded-xl px-3 text-[13px]" style={{ border: "1px solid var(--cc-border)" }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: "var(--cc-muted)" }}>{translate("notifPrefs.quiet.to")}</span>
              <TimePicker value={quiet.to} onChange={(to) => updateQuiet({ to })} className="rounded-xl px-3 text-[13px]" style={{ border: "1px solid var(--cc-border)" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
