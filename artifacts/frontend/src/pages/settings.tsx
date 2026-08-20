import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStoredSignature, saveSignature, clearSignature } from "@/lib/signature-store";
import { changePassword, requestPasswordReset } from "@/services/userService";
import {
  PenLine,
  Upload,
  Trash2,
  Check,
  RotateCcw,
  ImageIcon,
  Loader2,
  Building2,
  Settings2,
  ShieldCheck,
  User,
  Plus,
  X,
  Info,
  Users2,
  UserMinus,
  ChevronDown,
  Copy,
  Bell,
  LockKeyhole,
  MonitorSmartphone,
  Pencil,
  QrCode,
  AlertTriangle,
  Accessibility as AccessibilityIcon,
  Shield,
} from "lucide-react";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import WorkerPrivacy from "@/pages/worker-privacy";
import { formatDistanceToNow } from "date-fns";
import QRCode from "react-qr-code";
import { PasswordInput } from "@/components/PasswordInput";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { apiFetch } from "@/lib/api-fetch";
import { useReAuth } from "@/hooks/useReAuth";
import { Link } from "wouter";
import {
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import {
  disableMfa,
  getLoginHistory,
  getMfaStatus,
  listSessions,
  listTrustedDevices,
  logoutOtherSessions,
  renameSession,
  renameTrustedDevice,
  revokeTrustedDevice,
  startTotpEnrollment,
  verifyTotpEnrollment,
  type LoginHistoryEntry,
  type MfaStatus,
  type TrustedDevice,
  type UserSession,
} from "@/services/securityService";
import {
  getOrganizationBranding,
  updateOrganizationBranding,
  uploadOrganizationLogo,
  removeOrganizationLogo,
  type OrganizationBranding,
} from "@/services/organizationBrandingService";

// ---------------------------------------------------------------------------
// ABN validation — 11 digits only (optional field)
// ---------------------------------------------------------------------------
function isValidABNFormat(abn: string): boolean {
  const digits = abn.replace(/\s/g, "");
  return digits === "" || /^\d{11}$/.test(digits);
}

// ---------------------------------------------------------------------------
// Sidebar nav items
// ---------------------------------------------------------------------------
type SectionId = "account" | "provider" | "defaults" | "compliance" | "notifications" | "team" | "accessibility" | "privacy" | "branding";

const NAV_ITEMS: { id: SectionId; labelKey: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; coordinatorOnly?: boolean; mdOnly?: boolean }[] = [
  { id: "account",       labelKey: "settings.nav.account",          icon: User        },
  { id: "provider",      labelKey: "settings.nav.provider",          icon: Building2   },
  { id: "defaults",      labelKey: "settings.nav.defaults",          icon: Settings2   },
  { id: "compliance",    labelKey: "settings.nav.compliance",        icon: ShieldCheck },
  { id: "accessibility", labelKey: "settings.nav.accessibility",     icon: AccessibilityIcon },
  { id: "privacy",       labelKey: "settings.nav.privacy",           icon: Shield      },
  { id: "notifications", labelKey: "settings.nav.notifications",     icon: Bell, coordinatorOnly: true },
  { id: "team",          labelKey: "settings.nav.team",              icon: Users2, coordinatorOnly: true },
  { id: "branding",      labelKey: "settings.nav.branding",          icon: ImageIcon, mdOnly: true },
];

// ---------------------------------------------------------------------------
// Reusable setting row (toggle + title + description)
// ---------------------------------------------------------------------------
function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>{title}</p>
        <p className="text-[14px] mt-1 font-medium leading-relaxed" style={{ color: "var(--cc-text)" }}>{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="pb-1">
        <h2 className="text-[22px] font-black tracking-tight" style={{ color: "var(--cc-text)" }}>{title}</h2>
        <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "var(--cc-muted)" }}>{description}</p>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel card
// ---------------------------------------------------------------------------
function PanelCard({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("bg-white rounded-2xl overflow-hidden", className)}
      style={{ border: "1px solid var(--cc-border)" }}
    >
      <div className="p-6">
        {label && (
          <p className="text-[15px] font-bold mb-4" style={{ color: "var(--cc-text)" }}>{label}</p>
        )}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky save/cancel bar — shown at the bottom of a section once its fields
// differ from the last-saved snapshot, mirroring the "Update Settings /
// Cancel" floating bar pattern (reference screenshot, 2026-08-20).
// ---------------------------------------------------------------------------
function StickyActionBar({
  visible,
  saving,
  onSave,
  onCancel,
  saveLabel = "Save changes",
}: {
  visible: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  if (!visible) return null;
  return (
    <div
      className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3.5"
      style={{
        background: "var(--cc-surface)",
        border: "1px solid var(--cc-border)",
        boxShadow: "var(--cc-shadow-md)",
      }}
    >
      <p className="text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }}>You have unsaved changes</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-xl min-w-[130px] gap-1.5"
          style={{ background: "var(--cc-cta)", color: "#fff" }}
          onClick={onSave}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const ROLE_LABELS: Record<string, string> = {
  support_coordinator: "Support Coordinator",
  support_worker:      "Support Worker",
};

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  support_coordinator: { bg: "var(--cc-plum-soft)", color: "var(--cc-plum)" },
  support_worker:      { bg: "var(--cc-soft)",       color: "var(--cc-muted)" },
};

interface OrgMember {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  full_name: string;
  email: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  invite_url?: string;
  token?: string;
}

// -----------------------------------------------------------------------------
// CARECLIQV2-241 — Notification Preferences section
// -----------------------------------------------------------------------------

const NOTIF_EVENTS: { key: string; label: string; description: string }[] = [
  { key: "worker_clocked_in",    label: "Worker Clocked In",         description: "Notified when a worker clocks in to a shift" },
  { key: "session_started",      label: "Session Started",           description: "Notified when a session begins" },
  { key: "session_completed",    label: "Session Completed",         description: "Notified when a session is finalised" },
  { key: "no_session_started",   label: "No Session Started (Alert)",description: "Alert when worker is clocked in but no session after 30 min" },
  { key: "shift_assigned",       label: "Shift Assigned",            description: "Notified when you assign a shift to a worker" },
  { key: "low_compliance",       label: "Low Compliance",            description: "Alert when a session has low compliance score" },
  { key: "worker_offline",       label: "Worker Offline",            description: "Alert when a worker goes offline mid-shift" },
  { key: "feedback_received",    label: "Feedback Received",         description: "Notified when a participant submits feedback" },
];

const NOTIF_CHANNELS = ["in_app", "email", "sms"] as const;
type NotifChannel = (typeof NOTIF_CHANNELS)[number];

const CHANNEL_LABELS: Record<NotifChannel, string> = { in_app: "In-App", email: "Email", sms: "SMS" };

type NotifPrefs = {
  events: Record<string, Record<NotifChannel, boolean>>;
  quiet_hours_enabled: boolean;
  quiet_from: string;
  quiet_to: string;
};

function defaultPrefs(): NotifPrefs {
  const events: Record<string, Record<NotifChannel, boolean>> = {};
  for (const e of NOTIF_EVENTS) {
    events[e.key] = { in_app: true, email: false, sms: false };
  }
  return { events, quiet_hours_enabled: false, quiet_from: "22:00", quiet_to: "07:00" };
}

function NotificationsSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const [prefs, setPrefs] = useState<NotifPrefs>(defaultPrefs());
  const [pristine, setPristine] = useState<NotifPrefs>(defaultPrefs());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/users/me/notification-preferences?device_id=web")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.notification_events) {
          const events = { ...defaultPrefs().events };
          for (const ev of (data.notification_events as Array<{ event_type: string; channel: string; is_enabled: boolean }>)) {
            if (events[ev.event_type] && NOTIF_CHANNELS.includes(ev.channel as NotifChannel)) {
              events[ev.event_type][ev.channel as NotifChannel] = ev.is_enabled;
            }
          }
          const loaded: NotifPrefs = {
            events,
            quiet_hours_enabled: data.quiet_hours_enabled ?? false,
            quiet_from: data.quiet_from ?? "22:00",
            quiet_to: data.quiet_to ?? "07:00",
          };
          setPrefs(loaded);
          setPristine(loaded);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(pristine);

  function cancel() {
    setPrefs(pristine);
  }

  async function save() {
    setSaving(true);
    try {
      const notification_events = Object.entries(prefs.events).flatMap(([event_type, channels]) =>
        Object.entries(channels).map(([channel, is_enabled]) => ({ event_type, channel, is_enabled }))
      );
      await apiFetch("/api/users/me/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: "web",
          notification_events,
          quiet_hours_enabled: prefs.quiet_hours_enabled,
          quiet_from: prefs.quiet_from,
          quiet_to: prefs.quiet_to,
        }),
      });
      setPristine(prefs);
      toast({ title: translate("settings.toast.notificationsSaved") });
    } catch {
      toast({ variant: "destructive", title: translate("settings.toast.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  function toggleEvent(eventKey: string, channel: NotifChannel) {
    setPrefs((p) => ({
      ...p,
      events: {
        ...p.events,
        [eventKey]: { ...p.events[eventKey], [channel]: !p.events[eventKey][channel] },
      },
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--cc-muted)" }}>
        <Loader2 size={14} className="animate-spin" /> {translate("settings.loadingPreferences")}
      </div>
    );
  }

  return (
    <Section
      title={translate("settings.notifications.title")}
      description={translate("settings.notifications.subtitle")}
      icon={Bell}
    >
      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto rounded-xl" style={{ border: "1px solid var(--cc-border)" }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ background: "var(--cc-soft)" }}>
              <th className="px-4 py-2.5 text-left font-black text-[11px] uppercase tracking-widest" style={{ color: "var(--cc-muted)" }}>Event</th>
              {NOTIF_CHANNELS.map((ch) => (
                <th key={ch} className="px-4 py-2.5 text-center font-black text-[11px] uppercase tracking-widest w-24" style={{ color: "var(--cc-muted)" }}>
                  {CHANNEL_LABELS[ch]}
                  {ch === "in_app" && <span className="ml-1 text-[9px] font-semibold rounded-full px-1 py-0.5 bg-gray-200 text-gray-500">always</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIF_EVENTS.map((ev, i) => (
              <tr key={ev.key} style={{ background: i % 2 === 0 ? "var(--cc-surface)" : "var(--cc-soft)" }}>
                <td className="px-4 py-3">
                  <p className="font-semibold" style={{ color: "var(--cc-text)" }}>{ev.label}</p>
                  <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>{ev.description}</p>
                </td>
                {NOTIF_CHANNELS.map((ch) => (
                  <td key={ch} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      title={`Toggle ${CHANNEL_LABELS[ch]} notifications for ${ev.description}`}
                      checked={prefs.events[ev.key]?.[ch] ?? false}
                      disabled={ch === "in_app"}
                      onChange={() => toggleEvent(ev.key, ch)}
                      className="w-4 h-4 accent-[var(--cc-plum)] cursor-pointer disabled:cursor-default disabled:opacity-60"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View (sm, md only) */}
      <div className="md:hidden space-y-3">
        {NOTIF_EVENTS.map((ev) => (
          <div key={ev.key} className="rounded-xl p-4 border transition-colors" style={{ borderColor: "var(--cc-border)", background: "var(--cc-bg)" }}>
            {/* Event name & description */}
            <div className="mb-3">
              <p className="text-[13px] font-bold" style={{ color: "var(--cc-text)" }}>{ev.label}</p>
              <p className="text-[12px] mt-1" style={{ color: "var(--cc-muted)" }}>{ev.description}</p>
            </div>

            {/* Channel toggles */}
            <div className="space-y-2.5">
              {NOTIF_CHANNELS.map((ch) => (
                <div key={ch} className="flex items-center justify-between gap-2">
                  <label className="text-[12px] font-semibold" style={{ color: "var(--cc-text)" }}>
                    {CHANNEL_LABELS[ch]}
                    {ch === "in_app" && <span className="ml-1 text-[9px] font-semibold rounded-full px-1.5 py-0.5 bg-gray-200 text-gray-500">always on</span>}
                  </label>
                  <input
                    type="checkbox"
                    title={`Toggle ${CHANNEL_LABELS[ch]} notifications for ${ev.description}`}
                    checked={prefs.events[ev.key]?.[ch] ?? false}
                    disabled={ch === "in_app"}
                    onChange={() => toggleEvent(ev.key, ch)}
                    className="w-4 h-4 accent-[var(--cc-plum)] cursor-pointer disabled:cursor-default disabled:opacity-60"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Quiet hours */}
      <div className="mt-4 rounded-2xl p-4 space-y-3" style={{ background: "var(--cc-soft)", border: "1px solid var(--cc-border)" }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-[14px]" style={{ color: "var(--cc-text)" }}>Quiet Hours</p>
            <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>Suppress non-critical notifications during these hours</p>
          </div>
          <Switch checked={prefs.quiet_hours_enabled} onCheckedChange={(v) => setPrefs((p) => ({ ...p, quiet_hours_enabled: v }))} />
        </div>
        {prefs.quiet_hours_enabled && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold" style={{ color: "var(--cc-muted)" }}>From</label>
              <input
                type="time"
                title="Quiet hours start time"
                value={prefs.quiet_from}
                onChange={(e) => setPrefs((p) => ({ ...p, quiet_from: e.target.value }))}
                className="h-9 rounded-xl px-3 text-[13px] outline-none"
                style={{ border: "1px solid var(--cc-border)" }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold" style={{ color: "var(--cc-muted)" }}>To</label>
              <input
                type="time"
                title="Quiet hours end time"
                value={prefs.quiet_to}
                onChange={(e) => setPrefs((p) => ({ ...p, quiet_to: e.target.value }))}
                className="h-9 rounded-xl px-3 text-[13px] outline-none"
                style={{ border: "1px solid var(--cc-border)" }}
              />
            </div>
          </div>
        )}
      </div>

      <StickyActionBar visible={dirty} saving={saving} onSave={save} onCancel={cancel} saveLabel="Update settings" />
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Security Section — available to all roles
// -----------------------------------------------------------------------------

function SecuritySection() {
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const { requireReAuth, modal } = useReAuth();

  function formatWhen(value?: string | null) {
    if (!value) return translate("common.emDash");
    try {
      return formatDistanceToNow(new Date(value), { addSuffix: true });
    } catch {
      return value;
    }
  }

  const [loading, setLoading] = useState(true);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryEntry[]>([]);

  const [enrolling, setEnrolling] = useState(false);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);
  const [enrollOtpAuthUrl, setEnrollOtpAuthUrl] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [disablePassword, setDisablePassword] = useState("");
  const [disableBusy, setDisableBusy] = useState(false);

  const [logoutOthersPassword, setLogoutOthersPassword] = useState("");
  const [logoutOthersBusy, setLogoutOthersBusy] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameKind, setRenameKind] = useState<"device" | "session" | null>(null);

  const loadSecurityData = useCallback(async () => {
    const [status, devices, activeSessions, history] = await Promise.all([
      getMfaStatus(),
      listTrustedDevices(),
      listSessions(),
      getLoginHistory(),
    ]);
    setMfaStatus(status);
    setTrustedDevices(devices);
    setSessions(activeSessions);
    setLoginHistory(history);
  }, []);

  useEffect(() => {
    let active = true;
    loadSecurityData()
      .catch(() => {
        if (!active) return;
        toast({ title: translate("security.loadFailed"), variant: "destructive" });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadSecurityData, toast]);

  async function handleStartEnrollment() {
    setEnrollBusy(true);
    try {
      const payload = await startTotpEnrollment();
      setEnrollSecret(payload.secret);
      setEnrollOtpAuthUrl(payload.otpauth_url);
      setEnrolling(true);
      setEnrollCode("");
      setRecoveryCodes(null);
    } catch (error) {
      toast({ title: translate("security.start2faFailed"), description: error instanceof Error ? error.message : translate("toast.tryAgain"), variant: "destructive" });
    } finally {
      setEnrollBusy(false);
    }
  }

  async function handleVerifyEnrollment(event: React.FormEvent) {
    event.preventDefault();
    if (!enrollCode.trim()) return;
    setEnrollBusy(true);
    try {
      const result = await verifyTotpEnrollment(enrollCode.trim());
      setRecoveryCodes(result.recovery_codes);
      setMfaStatus({ enabled: true, method: "totp", phone: null });
      setEnrolling(false);
      setEnrollSecret(null);
      setEnrollCode("");
      toast({ title: translate("security.twoFactorEnabled"), description: translate("security.twoFactorEnabledHint") });
    } catch (error) {
      toast({ title: translate("security.verifyFailed"), description: error instanceof Error ? error.message : translate("security.verifyFailedHint"), variant: "destructive" });
    } finally {
      setEnrollBusy(false);
    }
  }

  async function handleDisableMfa(event: React.FormEvent) {
    event.preventDefault();
    if (!disablePassword) return;
    setDisableBusy(true);
    try {
      await requireReAuth(async () => {
        await disableMfa(disablePassword);
        return true;
      });
      setMfaStatus({ enabled: false, method: null, phone: null });
      setDisablePassword("");
      toast({ title: translate("security.twoFactorDisabled") });
    } catch { /* requireReAuth handles cancellation */ } finally {
      setDisableBusy(false);
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    try {
      await requireReAuth(async () => {
        await revokeTrustedDevice(deviceId);
        await loadSecurityData();
        return true;
      });
      toast({ title: translate("security.deviceRemoved") });
    } catch { /* noop */ }
  }

  async function handleLogoutOthers(event: React.FormEvent) {
    event.preventDefault();
    if (!logoutOthersPassword) return;
    setLogoutOthersBusy(true);
    try {
      await logoutOtherSessions(logoutOthersPassword);
      setLogoutOthersPassword("");
      await loadSecurityData();
      toast({ title: translate("security.signOutOthersSuccess") });
    } catch (error) {
      toast({ title: translate("security.signOutOthersFailed"), description: error instanceof Error ? error.message : translate("toast.tryAgain"), variant: "destructive" });
    } finally {
      setLogoutOthersBusy(false);
    }
  }

  async function submitRename() {
    if (!renamingId || !renameKind || !renameValue.trim()) return;
    try {
      if (renameKind === "device") {
        await renameTrustedDevice(renamingId, renameValue.trim());
      } else {
        await renameSession(renamingId, renameValue.trim());
      }
      setRenamingId(null);
      setRenameKind(null);
      setRenameValue("");
      await loadSecurityData();
      toast({ title: translate("security.nameUpdated") });
    } catch (error) {
      toast({ title: translate("security.renameFailed"), description: error instanceof Error ? error.message : translate("toast.tryAgain"), variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--cc-muted)" }}>
        <Loader2 size={14} className="animate-spin" /> {translate("settings.loadingSecurity")}
      </div>
    );
  }

  return (
    <Section
      title={translate("security.title")}
      description={translate("security.subtitle")}
      icon={LockKeyhole}
    >
      {modal}

      {/* QR code dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{translate("security.scanQr")}</DialogTitle>
            <DialogDescription>{translate("security.qrDescription")}</DialogDescription>
          </DialogHeader>
          {enrollOtpAuthUrl && (
            <div className="flex justify-center rounded-xl bg-white p-5 ring-1 ring-[var(--cc-border)]">
              <QRCode value={enrollOtpAuthUrl} size={200} bgColor="#FFFFFF" fgColor="#1A1A2E" />
            </div>
          )}
          <p className="text-center text-xs" style={{ color: "var(--cc-muted)" }}>{translate("security.qrManualHint")}</p>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renamingId} onOpenChange={(open) => { if (!open) { setRenamingId(null); setRenameKind(null); setRenameValue(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{renameKind === "device" ? translate("security.renameDevice") : translate("settings.renameSession")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="rounded-xl" autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => { setRenamingId(null); setRenameKind(null); setRenameValue(""); }}>{translate("common.cancel")}</Button>
              <Button size="sm" className="rounded-xl" style={{ background: "var(--cc-cta)" }} onClick={() => void submitRename()} disabled={!renameValue.trim()}>{translate("common.save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Two-factor authentication */}
      <PanelCard label={translate("security.twoFactor")}>
        {recoveryCodes && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-900">{translate("security.recoveryCodes")}</p>
            <p className="mt-1 text-sm text-amber-800">{translate("security.recoveryCodesHint")}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm text-[#1A1A2E] sm:grid-cols-4">
              {recoveryCodes.map((code) => (
                <div key={code} className="rounded-lg bg-white px-3 py-2 text-center">{code}</div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3 rounded-xl gap-2"
              onClick={() => { void navigator.clipboard.writeText(recoveryCodes.join("\n")); toast({ title: translate("security.codesCopied") }); }}>
              <Copy className="h-3.5 w-3.5" /> {translate("security.copyCodes")}
            </Button>
          </div>
        )}

        {!mfaStatus?.enabled ? (
          enrolling && enrollSecret ? (
            <form onSubmit={handleVerifyEnrollment} className="space-y-4">
              <div className="rounded-xl bg-[var(--cc-soft)] p-4">
                <p className="text-sm font-semibold" style={{ color: "var(--cc-text)" }}>{translate("security.setupAuthenticator")}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--cc-muted)" }}>{translate("security.setupAuthenticatorHint")}</p>
                <div className="mt-3 flex items-stretch gap-2">
                  <code className="flex-1 break-all rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[var(--cc-plum)]">{enrollSecret}</code>
                  <button type="button" onClick={() => setQrOpen(true)} aria-label={translate("security.showQrAria")} title={translate("security.showQrTitle")}
                    className="flex min-w-[48px] items-center justify-center rounded-xl border bg-white px-3 hover:bg-[var(--cc-plum-soft)]" style={{ borderColor: "var(--cc-border)" }}>
                    <QrCode className="h-5 w-5 text-[var(--cc-plum)]" />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sec-totp-code">{translate("security.totpCode")}</Label>
                <Input id="sec-totp-code" value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)}
                  inputMode="numeric" autoComplete="one-time-code" className="rounded-xl max-w-[200px] tracking-widest" placeholder={translate("security.totpPlaceholder")} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => { setEnrolling(false); setEnrollSecret(null); setEnrollOtpAuthUrl(null); setQrOpen(false); setEnrollCode(""); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={enrollBusy || !enrollCode.trim()} className="rounded-xl" style={{ background: "var(--cc-cta)" }}>
                  {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("security.verifyEnable")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "var(--cc-muted)" }}>Add an extra layer of protection with an authenticator app (Google Authenticator, Authy, 1Password).</p>
              <Button type="button" onClick={() => void handleStartEnrollment()} disabled={enrollBusy} className="rounded-xl gap-2" style={{ background: "var(--cc-cta)" }}>
                {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                {translate("security.enableAuthenticator")}
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#166534" }}>
              <Check className="h-4 w-4" /> {translate("security.twoFactorActive")}
            </div>
            <form onSubmit={handleDisableMfa} className="max-w-md space-y-3 border-t pt-4" style={{ borderColor: "var(--cc-border)" }}>
              <p className="text-sm" style={{ color: "var(--cc-muted)" }}>{translate("security.disableTwoFactorHint")}</p>
              <div className="space-y-1.5">
                <Label htmlFor="sec-disable-mfa">{translate("profile.currentPassword")}</Label>
                <PasswordInput id="sec-disable-mfa" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} className="rounded-xl max-w-sm" />
              </div>
              <Button type="submit" variant="outline" disabled={disableBusy || !disablePassword} className="rounded-xl border-red-200 text-red-700 hover:bg-red-50">
                {disableBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("security.disableTwoFactor")}
              </Button>
            </form>
          </div>
        )}
      </PanelCard>

      {/* Trusted devices */}
      <PanelCard label={translate("security.trustedDevices")}>
        <p className="text-[12px] mb-3" style={{ color: "var(--cc-muted)" }}>{translate("security.trustedDevicesHint")}</p>
        {trustedDevices.length === 0 ? (
          <p className="text-sm py-1" style={{ color: "var(--cc-muted)" }}>{translate("security.noTrustedDevices")}</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
            {trustedDevices.map((device) => (
              <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>
                    {device.device_name}
                    {device.is_current && <span className="ml-2 rounded-full bg-[var(--cc-plum-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--cc-plum)]">{translate("security.thisDevice")}</span>}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {translateParams("security.trustedUntil", { os: device.os_name, when: formatWhen(device.trusted_until) })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="rounded-lg h-8"
                    onClick={() => { setRenamingId(device.id); setRenameKind("device"); setRenameValue(device.device_name); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="rounded-lg h-8 border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => void handleRevokeDevice(device.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelCard>

      {/* Active sessions */}
      <PanelCard label={translate("security.activeSessions")}>
        <p className="text-[12px] mb-3" style={{ color: "var(--cc-muted)" }}>{translate("security.sessionsHint")}</p>
        {sessions.length === 0 ? (
          <p className="text-sm py-1" style={{ color: "var(--cc-muted)" }}>{translate("settings.noActiveSessions")}</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
            {sessions.map((session) => (
              <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>
                    {session.device_name}
                    {session.is_current && <span className="ml-2 rounded-full bg-[var(--cc-plum-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--cc-plum)]">{translate("security.currentSession")}</span>}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {translateParams("security.sessionLocation", { city: session.city || translate("security.unknownCity"), country: session.country || translate("security.unknownCountry"), when: formatWhen(session.last_active_at) })}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" className="rounded-lg h-8"
                  onClick={() => { setRenamingId(session.id); setRenameKind("session"); setRenameValue(session.device_name); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleLogoutOthers} className="mt-4 border-t pt-4 max-w-md space-y-3" style={{ borderColor: "var(--cc-border)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--cc-text)" }}>{translate("security.signOutAllOthers")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="sec-logout-others">{translate("security.confirmPassword")}</Label>
            <PasswordInput id="sec-logout-others" value={logoutOthersPassword} onChange={(e) => setLogoutOthersPassword(e.target.value)} className="rounded-xl max-w-sm" />
          </div>
          <Button type="submit" variant="outline" disabled={logoutOthersBusy || !logoutOthersPassword} className="rounded-xl">
            {logoutOthersBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("security.signOutOthers")}
          </Button>
        </form>
      </PanelCard>

      {/* Recent sign-ins */}
      <PanelCard label={translate("security.recentSignIns")}>
        <p className="text-[12px] mb-3" style={{ color: "var(--cc-muted)" }}>{translate("security.recentSignInsHint")}</p>
        {loginHistory.length === 0 ? (
          <p className="text-sm py-1" style={{ color: "var(--cc-muted)" }}>{translate("security.noSignInHistory")}</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
            {loginHistory.slice(0, 10).map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3"
                style={{ borderColor: entry.is_suspicious ? "rgba(190,24,93,0.2)" : undefined }}>
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>{entry.device_name}</p>
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {entry.location_label} · {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                  </p>
                </div>
                {entry.is_suspicious ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                    <AlertTriangle className="h-3 w-3" /> {translate("security.unusualSignIn")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </PanelCard>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Organisation branding (managing director only) — logo, display name, and
// accent color used on onboarding-facing emails and the first-login welcome
// screen. Deliberately scoped to those touchpoints, not a general re-skin.
// -----------------------------------------------------------------------------
function OrganizationBrandingSection() {
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [identityPristine, setIdentityPristine] = useState({ displayName: "", accentColor: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getOrganizationBranding()
      .then((data) => {
        setBranding(data);
        const name = data.display_name || "";
        const accent = data.brand_accent_color || "";
        setDisplayName(name);
        setAccentColor(accent);
        setIdentityPristine({ displayName: name, accentColor: accent });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const identityDirty = displayName !== identityPristine.displayName || accentColor !== identityPristine.accentColor;
  function handleCancelIdentity() {
    setDisplayName(identityPristine.displayName);
    setAccentColor(identityPristine.accentColor);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateOrganizationBranding({
        display_name: displayName.trim(),
        brand_accent_color: accentColor.trim(),
      });
      setBranding(updated);
      setIdentityPristine({ displayName, accentColor });
      toast({ title: translate("settings.branding.saved") });
    } catch (e) {
      toast({ variant: "destructive", title: translate("settings.toast.saveFailed"), description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const updated = await uploadOrganizationLogo(file);
      setBranding(updated);
      toast({ title: translate("settings.branding.logoUploaded") });
    } catch (err) {
      toast({ variant: "destructive", title: translate("settings.toast.saveFailed"), description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function handleRemoveLogo() {
    setUploading(true);
    try {
      const updated = await removeOrganizationLogo();
      setBranding(updated);
    } catch (err) {
      toast({ variant: "destructive", title: translate("settings.toast.saveFailed"), description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--cc-muted)" }}>
        <Loader2 size={14} className="animate-spin" /> {translate("settings.loadingPreferences")}
      </div>
    );
  }

  return (
    <Section
      title={translate("settings.branding.title")}
      description={translate("settings.branding.subtitle")}
      icon={ImageIcon}
    >
      <PanelCard label={translate("settings.branding.logoLabel")}>
        <div className="flex items-center gap-4">
          <div
            className="h-16 w-16 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
            style={{ background: "var(--cc-soft)", border: "1px solid var(--cc-border)" }}
          >
            {branding?.logo_url ? (
              <img src={branding.logo_url} alt="" className="h-full w-full object-contain" />
            ) : (
              <ImageIcon className="h-6 w-6" style={{ color: "var(--cc-muted)" }} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => logoInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                {translate("settings.branding.uploadLogo")}
              </Button>
              {branding?.logo_url && (
                <Button size="sm" variant="ghost" onClick={handleRemoveLogo} disabled={uploading}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> {translate("settings.branding.removeLogo")}
                </Button>
              )}
            </div>
            <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>{translate("settings.branding.logoHint")}</p>
            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={handleLogoChange} />
          </div>
        </div>
      </PanelCard>

      <PanelCard label={translate("settings.branding.identityLabel")}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brand-display-name" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>
              {translate("settings.branding.displayName")}
            </Label>
            <Input
              id="brand-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={translate("settings.branding.displayNamePlaceholder")}
            />
            <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>{translate("settings.branding.displayNameHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-accent-color" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>
              {translate("settings.branding.accentColor")}
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#E8457A"}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-9 w-12 rounded-md border cursor-pointer"
                style={{ borderColor: "var(--cc-border)" }}
                aria-label={translate("settings.branding.accentColor")}
              />
              <Input
                id="brand-accent-color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                placeholder="#E8457A"
                className="max-w-[140px]"
              />
            </div>
            <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>{translate("settings.branding.accentColorHint")}</p>
          </div>
        </div>
      </PanelCard>

      <StickyActionBar visible={identityDirty} saving={saving} onSave={handleSave} onCancel={handleCancelIdentity} />

      <NavLayoutCard />
    </Section>
  );
}

function LayoutPreview({ variant }: { variant: "topbar" | "sidebar" | "bottombar" }) {
  const PLUM = "var(--cc-plum)";
  const LINE = "var(--cc-border)";
  const SURFACE = "var(--cc-surface)";
  const SOFT = "var(--cc-soft)";

  const headerRow = (
    <div className="flex h-3.5 shrink-0 items-center gap-1 border-b px-1.5" style={{ borderColor: LINE, background: SURFACE }}>
      <div className="h-1.5 w-1.5 rounded-sm shrink-0" style={{ background: PLUM }} />
      <div className="h-1 w-5 rounded-full shrink-0" style={{ background: LINE }} />
      <div className="ml-auto h-1.5 max-w-[24px] flex-1 rounded-full" style={{ background: SOFT }} />
      <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: PLUM }} />
    </div>
  );

  const bodyLines = (
    <div className="flex-1 space-y-1 p-1.5">
      <div className="h-1 w-3/4 rounded-full" style={{ background: LINE }} />
      <div className="h-1 w-1/2 rounded-full" style={{ background: LINE }} />
    </div>
  );

  if (variant === "sidebar") {
    return (
      <div className="flex h-16 w-full overflow-hidden rounded-lg border" style={{ borderColor: LINE, background: SURFACE }}>
        <div className="flex h-full w-4 shrink-0 flex-col items-center gap-1 pt-1.5" style={{ background: PLUM }}>
          <div className="h-1 w-2 rounded-full bg-white/70" />
          <div className="h-1 w-2 rounded-full bg-white/40" />
          <div className="h-1 w-2 rounded-full bg-white/40" />
        </div>
        <div className="flex flex-1 flex-col">
          {headerRow}
          {bodyLines}
        </div>
      </div>
    );
  }

  if (variant === "bottombar") {
    return (
      <div className="relative flex h-16 w-full flex-col overflow-hidden rounded-lg border" style={{ borderColor: LINE, background: SURFACE }}>
        {headerRow}
        {bodyLines}
        <div className="absolute inset-x-0 bottom-1 flex justify-center">
          <div className="flex items-center gap-1 rounded-full border px-1.5 py-1" style={{ borderColor: LINE, background: SURFACE }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-1 w-3 rounded-full" style={{ background: i === 0 ? PLUM : LINE }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-16 w-full flex-col overflow-hidden rounded-lg border" style={{ borderColor: LINE, background: SURFACE }}>
      {headerRow}
      <div className="flex justify-center px-2 pt-1.5">
        <div className="flex items-center gap-1 rounded-full border px-1.5 py-1" style={{ borderColor: LINE, background: SURFACE }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-1 w-3 rounded-full" style={{ background: i === 0 ? PLUM : LINE }} />
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-1 p-1.5">
        <div className="h-1 w-3/4 rounded-full" style={{ background: LINE }} />
      </div>
    </div>
  );
}

function NavLayoutCard() {
  const { prefs, setNavLayout, translate } = useAccessibility();
  const layout = prefs?.nav_layout ?? "topbar";
  const [busy, setBusy] = useState(false);

  async function choose(value: "topbar" | "sidebar" | "bottombar") {
    if (value === layout || busy) return;
    setBusy(true);
    try {
      await setNavLayout(value);
    } finally {
      setBusy(false);
    }
  }

  const options: { value: "topbar" | "sidebar" | "bottombar"; label: string }[] = [
    { value: "topbar", label: translate("settings.branding.layoutTopbar") },
    { value: "sidebar", label: translate("settings.branding.layoutSidebar") },
    { value: "bottombar", label: translate("settings.branding.layoutBottombar") },
  ];

  return (
    <PanelCard label={translate("settings.branding.layoutLabel")}>
      <p className="mb-3 text-[11px]" style={{ color: "var(--cc-muted)" }}>{translate("settings.branding.layoutHint")}</p>
      <div className="grid grid-cols-3 gap-3 max-w-lg">
        {options.map((opt) => {
          const selected = layout === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => choose(opt.value)}
              disabled={busy}
              className="rounded-xl border p-2 text-left transition-all disabled:opacity-60"
              style={{
                borderColor: selected ? "var(--cc-plum)" : "var(--cc-border)",
                boxShadow: selected ? "0 0 0 2px var(--cc-plum-ring)" : "none",
                background: "var(--cc-soft)",
              }}
            >
              <LayoutPreview variant={opt.value} />
              <div className="mt-2 flex items-center justify-between gap-1.5">
                <span className="text-[12px] font-bold" style={{ color: selected ? "var(--cc-plum)" : "var(--cc-text)" }}>
                  {opt.label}
                </span>
                {selected && (
                  <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--cc-plum)" }} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      <NavColorPicker />
    </PanelCard>
  );
}

// A handful of curated, tested options — not a free-form picker — so every
// choice stays readable. "Midnight" reuses the same dark navy the
// worker/coordinator sidebar already uses (--cc-sidebar-bg), for a look
// that's consistent with the rest of the app rather than a one-off color.
const NAV_COLOR_PRESETS: { hex: string | null; labelKey: string }[] = [
  { hex: null, labelKey: "settings.branding.navColorDefault" },
  { hex: "#E8457A", labelKey: "settings.branding.navColorPink" },
  { hex: "#6E79C2", labelKey: "settings.branding.navColorPurple" },
  { hex: "#1A1A18", labelKey: "settings.branding.navColorDark" },
];

function isDarkHex(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

// Renders the nav exactly as it will actually look with this preset —
// background AND correctly-contrasted text/active-pill bundled together —
// so there's nothing to discover after clicking. Mirrors the real
// Command Deck nav's own contrast logic (see HubLayout.tsx's navText/
// navActiveBg derivation) so the preview never lies about the result.
function NavDesignPreview({ hex }: { hex: string | null }) {
  const bg = hex ?? "var(--cc-surface)";
  const dark = hex ? isDarkHex(hex) : false;
  const text = dark ? "rgba(255,255,255,0.85)" : "var(--cc-muted)";
  const activeBg = dark ? "rgba(255,255,255,0.18)" : "var(--cc-plum)";

  return (
    <div
      className="flex h-11 w-full items-center justify-center gap-1 rounded-full border px-2"
      style={{ background: bg, borderColor: "var(--cc-border)" }}
    >
      <span className="rounded-full px-2 py-1 text-[8px] font-bold whitespace-nowrap" style={{ background: activeBg, color: "#FFFFFF" }}>
        Dashboard
      </span>
      <span className="rounded-full px-2 py-1 text-[8px] font-bold whitespace-nowrap" style={{ color: text }}>
        Staff
      </span>
    </div>
  );
}

function NavColorPicker() {
  const { prefs, setNavColor, translate } = useAccessibility();
  const current = prefs?.nav_color ?? null;
  const [busy, setBusy] = useState(false);

  async function apply(hex: string | null) {
    if (hex === current || busy) return;
    setBusy(true);
    try {
      await setNavColor(hex);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--cc-border)" }}>
      <p className="mb-1 text-[12px] font-bold" style={{ color: "var(--cc-text)" }}>
        {translate("settings.branding.navColorLabel")}
      </p>
      <p className="mb-3 text-[11px]" style={{ color: "var(--cc-muted)" }}>
        Each option is a full nav design — background and text are matched for you, so you never end up with unreadable labels.
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-md sm:grid-cols-4">
        {NAV_COLOR_PRESETS.map((preset) => {
          const selected = current === preset.hex;
          return (
            <button
              key={preset.hex ?? "default"}
              type="button"
              onClick={() => apply(preset.hex)}
              disabled={busy}
              className="rounded-xl border p-2 text-left transition-all disabled:opacity-60"
              style={{
                borderColor: selected ? "var(--cc-plum)" : "var(--cc-border)",
                boxShadow: selected ? "0 0 0 2px var(--cc-plum-ring)" : "none",
                background: "var(--cc-soft)",
              }}
              aria-pressed={selected}
            >
              <NavDesignPreview hex={preset.hex} />
              <div className="mt-2 flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold" style={{ color: selected ? "var(--cc-plum)" : "var(--cc-text)" }}>
                  {translate(preset.labelKey)}
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--cc-plum)" }} />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const { user, token: authToken } = useAuth();
  const { requireReAuth, modal } = useReAuth();
  const isCoordinator = user?.role === "support_coordinator";
  const isMD = user?.role === "managing_director";
  const visibleNavItems = NAV_ITEMS.filter((item) => (!item.coordinatorOnly || isCoordinator) && (!item.mdOnly || isMD));

  const [activeSection, setActiveSection] = useState<SectionId>("account");
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"draw" | "upload">("draw");

  // -- Draw pad state ---------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);

  // -- Upload state -----------------------------------------------------------
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -- Practitioner Details state ---------------------------------------------
  const [practName, setPractName] = useState("");
  const [practCredentials, setPractCredentials] = useState("");
  const [isSavingPract, setIsSavingPract] = useState(false);
  const [practPristine, setPractPristine] = useState({ name: "", credentials: "" });

  // -- Provider Information state ---------------------------------------------
  const [businessName, setBusinessName] = useState("");
  const [abn, setAbn] = useState("");
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [providerPristine, setProviderPristine] = useState({ businessName: "", abn: "" });

  // -- Session Defaults state -------------------------------------------------
  const [defaultDuration, setDefaultDuration] = useState<string>("60");
  const [autoStartTimer, setAutoStartTimer] = useState(false);
  const [enableVoice, setEnableVoice] = useState(false);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [defaultsPristine, setDefaultsPristine] = useState({ defaultDuration: "60", autoStartTimer: false, enableVoice: false });

  // -- Compliance Requirements state ------------------------------------------
  const [requireActivity, setRequireActivity] = useState(false);
  const [requireNotes, setRequireNotes] = useState(false);
  const [requireDuration, setRequireDuration] = useState(false);
  const [physicalExamSessionTypes, setPhysicalExamSessionTypes] = useState<string[]>([]);
  const [newSessionType, setNewSessionType] = useState("");
  const [isSavingCompliance, setIsSavingCompliance] = useState(false);
  const [compliancePristine, setCompliancePristine] = useState({ requireActivity: false, requireNotes: false, requireDuration: false, physicalExamSessionTypes: [] as string[] });

  const DEFAULT_PHYSICAL_TYPES = [
    "physiotherapy", "physio", "occupational therapy", "OT",
    "physical therapy", "therapy", "exercise physiology",
    "hydrotherapy", "rehabilitation", "rehab", "massage",
    "manual therapy", "sports therapy",
  ];

  // -- Team state (support coordinator only) ----------------------------------
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    if (!isCoordinator || !authToken) return;
    setLoadingTeam(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        apiFetch("/api/invitations/members"),
        apiFetch("/api/invitations/list"),
      ]);
      if (membersRes.ok) setMembers(await membersRes.json());
      if (invitesRes.ok) setInvites(await invitesRes.json());
    } catch {
      // silently skip — team data is supplementary
    } finally {
      setLoadingTeam(false);
    }
  }, [isCoordinator, authToken]);

  useEffect(() => {
    if (activeSection === "team") fetchTeam();
  }, [activeSection, fetchTeam]);

  const handleRevokeInvite = async (id: string) => {
    if (!authToken) return;
    try {
      await requireReAuth(() => apiFetch(`/api/invitations/revoke/${id}`, { method: "DELETE" }));
      setInvites((prev) => prev.filter((i) => i.id !== id));
      toast({ title: translate("settings.toast.inviteRevoked") });
    } catch {
      toast({ title: translate("settings.toast.inviteRevokeFailed"), variant: "destructive" });
    }
  };

  const handleRemoveMember = async (memberId: string, name: string) => {
    if (!authToken) return;
    if (!confirm(`Remove ${name || "this member"} from the organization?`)) return;
    try {
      await requireReAuth(() => apiFetch(`/api/invitations/members/${memberId}`, { method: "DELETE" }));
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      toast({ title: translate("settings.toast.memberRemoved") });
    } catch {
      toast({ title: translate("settings.toast.memberRemoveFailed"), variant: "destructive" });
    }
  };

  const handleChangeRole = async (memberId: string, newRole: string) => {
    if (!authToken) return;
    try {
      await requireReAuth(() =>
        apiFetch(`/api/invitations/members/${memberId}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        })
      );
      setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role: newRole } : m));
      toast({ title: translate("settings.toast.roleUpdated"), description: translateParams("settings.toast.roleUpdatedDesc", { role: ROLE_LABELS[newRole] ?? newRole }) });
    } catch {
      toast({ title: translate("settings.toast.roleUpdateFailed"), variant: "destructive" });
    }
  };

  const copyInviteLink = (invite: PendingInvite) => {
    const url = invite.invite_url
      ? `${window.location.origin}${invite.invite_url}`
      : `${window.location.origin}/accept-invite?token=${invite.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(invite.id);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  };

  // -- API --------------------------------------------------------------------
  const { data: serverSettings, isLoading: isLoadingSettings } =
    useGetPractitionerSettings();

  const { mutateAsync: saveToServer, isPending: isSaving } =
    useSavePractitionerSettings();

  // -- Populate all fields from server settings -------------------------------
  useEffect(() => {
    if (isLoadingSettings || !serverSettings) return;

    if (serverSettings.signature) {
      setSavedSignature(serverSettings.signature);
      saveSignature(serverSettings.signature);
    } else {
      const local = getStoredSignature();
      if (local) setSavedSignature(local);
    }

    // Fall back to the real account name so the field is never blank on first
    // load — the system already knows this from signup/invite, no need to
    // make the user retype it just because practitioner_settings has nothing yet.
    const loadedName = serverSettings.name || user?.full_name || "";
    const loadedCredentials = serverSettings.credentials ?? "";
    setPractName(loadedName);
    setPractCredentials(loadedCredentials);
    setPractPristine({ name: loadedName, credentials: loadedCredentials });

    const provider = serverSettings.provider as { businessName?: string | null; abn?: string | null } | null;
    const loadedBusinessName = provider?.businessName ?? "";
    const loadedAbn = provider?.abn ?? "";
    if (provider?.businessName) setBusinessName(provider.businessName);
    if (provider?.abn) setAbn(provider.abn);
    setProviderPristine({ businessName: loadedBusinessName, abn: loadedAbn });

    const sd = serverSettings.sessionDefaults as {
      defaultDuration?: number | null;
      autoStartTimer?: boolean | null;
      enableVoice?: boolean | null;
    } | null;
    const loadedDuration = sd?.defaultDuration != null ? String(sd.defaultDuration) : "60";
    const loadedAutoStart = sd?.autoStartTimer ?? false;
    const loadedVoice = sd?.enableVoice ?? false;
    if (sd?.defaultDuration != null) setDefaultDuration(loadedDuration);
    if (sd?.autoStartTimer != null) setAutoStartTimer(loadedAutoStart);
    if (sd?.enableVoice != null) setEnableVoice(loadedVoice);
    setDefaultsPristine({ defaultDuration: loadedDuration, autoStartTimer: loadedAutoStart, enableVoice: loadedVoice });

    const comp = serverSettings.compliance as {
      requireActivity?: boolean | null;
      requireNotes?: boolean | null;
      requireDuration?: boolean | null;
      physicalExamSessionTypes?: string[] | null;
    } | null;
    const loadedActivity = comp?.requireActivity ?? false;
    const loadedNotes = comp?.requireNotes ?? false;
    const loadedReqDuration = comp?.requireDuration ?? false;
    const loadedTypes = comp?.physicalExamSessionTypes ?? [];
    if (comp?.requireActivity != null) setRequireActivity(loadedActivity);
    if (comp?.requireNotes != null) setRequireNotes(loadedNotes);
    if (comp?.requireDuration != null) setRequireDuration(loadedReqDuration);
    if (comp?.physicalExamSessionTypes != null) {
      setPhysicalExamSessionTypes(loadedTypes);
    }
    setCompliancePristine({ requireActivity: loadedActivity, requireNotes: loadedNotes, requireDuration: loadedReqDuration, physicalExamSessionTypes: loadedTypes });
  }, [serverSettings, isLoadingSettings]);

  // -- Canvas helpers ---------------------------------------------------------
  const getCanvasPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDrawing = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      isDrawingRef.current = true;
      lastPosRef.current = getCanvasPos(e);
    },
    []
  );

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isDrawingRef.current || !lastPosRef.current) return;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const pos = getCanvasPos(e);
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      lastPosRef.current = pos;
      setHasDrawing(true);
    },
    []
  );

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
    lastPosRef.current = null;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
  }, []);

  // -- Save helpers -----------------------------------------------------------
  const persistSignature = useCallback(
    async (dataUrl: string) => {
      saveSignature(dataUrl);
      setSavedSignature(dataUrl);
      try {
        await saveToServer({
          data: {
            signature: dataUrl,
            name: serverSettings?.name ?? null,
            credentials: serverSettings?.credentials ?? null,
          },
        });
      } catch {
        toast({
          title: translate("settings.toast.savedLocally"),
          description: translate("settings.toast.savedLocallyDesc"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: translate("settings.toast.signatureSaved"),
        description: translate("settings.toast.signatureSavedDesc"),
      });
    },
    [saveToServer, serverSettings, toast]
  );

  const saveDrawn = useCallback(async () => {
    const canvas = canvasRef.current!;
    const dataUrl = canvas.toDataURL("image/png");
    await persistSignature(dataUrl);
  }, [persistSignature]);

  const saveUploaded = useCallback(async () => {
    if (!uploadPreview) return;
    await persistSignature(uploadPreview);
  }, [uploadPreview, persistSignature]);

  const handleClear = useCallback(async () => {
    clearSignature();
    setSavedSignature(null);
    clearCanvas();
    setUploadPreview(null);
    try {
      await saveToServer({
        data: {
          signature: null,
          name: serverSettings?.name ?? null,
          credentials: serverSettings?.credentials ?? null,
        },
      });
    } catch {
      // server sync failed — signature already cleared locally
    }
    toast({ title: translate("settings.toast.signatureRemoved"), description: translate("settings.toast.signatureRemovedDesc") });
  }, [clearCanvas, saveToServer, serverSettings, toast]);

  // -- File upload ------------------------------------------------------------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      toast({ title: translate("settings.toast.invalidFileType"), description: translate("settings.toast.invalidFileTypeDesc"), variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: translate("settings.toast.fileTooLarge"), description: translate("settings.toast.fileTooLargeDesc"), variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => { setUploadPreview(reader.result as string); };
    reader.readAsDataURL(file);
  };

  // -- Section save handlers --------------------------------------------------
  const handleSavePractitioner = async () => {
    setIsSavingPract(true);
    try {
      await saveToServer({ data: { name: practName.trim() || null, credentials: practCredentials.trim() || null } });
      setPractPristine({ name: practName, credentials: practCredentials });
      toast({ title: translate("settings.toast.practitionerSaved") });
    } catch {
      toast({ title: translate("settings.toast.saveFailed"), description: translate("settings.toast.practitionerSaveFailed"), variant: "destructive" });
    } finally {
      setIsSavingPract(false);
    }
  };

  const practDirty = practName !== practPristine.name || practCredentials !== practPristine.credentials;
  const handleCancelPractitioner = () => {
    setPractName(practPristine.name);
    setPractCredentials(practPristine.credentials);
  };

  // -- Password state (MD/coordinator self-service; support workers request via admin) --
  const canChangeOwnPassword = user?.role !== "support_worker";
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isRequestingReset, setIsRequestingReset] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: translate("profile.passwordsNoMatch"), variant: "destructive" });
      return;
    }
    setIsChangingPassword(true);
    try {
      const result = await changePassword({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: translate("profile.passwordUpdated"), description: result.message });
    } catch (error) {
      toast({ title: translate("profile.passwordChangeFailed"), description: error instanceof Error ? error.message : translate("toast.tryAgain"), variant: "destructive" });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    setIsRequestingReset(true);
    try {
      const result = await requestPasswordReset();
      setResetRequested(true);
      toast({ title: translate("profile.passwordResetRequested"), description: result.message });
    } catch (error) {
      toast({ title: translate("profile.passwordResetRequestFailed"), description: error instanceof Error ? error.message : translate("toast.tryAgain"), variant: "destructive" });
    } finally {
      setIsRequestingReset(false);
    }
  };

  const abnDigits = abn.replace(/\s/g, "");
  const abnHas11Digits = /^\d{11}$/.test(abnDigits);
  const abnValid = isValidABNFormat(abn);
  const abnError = abnDigits.length > 0 && abnDigits.length >= 11 && !abnHas11Digits;
  const abnShowValid = abnHas11Digits;

  const handleSaveProvider = async () => {
    if (!abnValid) {
      toast({ title: translate("settings.toast.invalidAbn"), description: translate("settings.toast.invalidAbnDesc"), variant: "destructive" });
      return;
    }
    setIsSavingProvider(true);
    try {
      await saveToServer({ data: { provider: { businessName: businessName.trim() || null, abn: abn.replace(/\s/g, "") || null } } });
      setProviderPristine({ businessName, abn });
      toast({ title: translate("settings.toast.providerSaved") });
    } catch {
      toast({ title: translate("settings.toast.saveFailed"), description: translate("settings.toast.providerSaveFailed"), variant: "destructive" });
    } finally {
      setIsSavingProvider(false);
    }
  };

  const providerDirty = businessName !== providerPristine.businessName || abn !== providerPristine.abn;
  const handleCancelProvider = () => {
    setBusinessName(providerPristine.businessName);
    setAbn(providerPristine.abn);
  };

  const handleSaveDefaults = async () => {
    setIsSavingDefaults(true);
    try {
      await saveToServer({ data: { sessionDefaults: { defaultDuration: defaultDuration ? Number(defaultDuration) : null, autoStartTimer, enableVoice } } });
      setDefaultsPristine({ defaultDuration, autoStartTimer, enableVoice });
      toast({ title: translate("settings.toast.defaultsSaved") });
    } catch {
      toast({ title: translate("settings.toast.saveFailed"), description: translate("settings.toast.defaultsSaveFailed"), variant: "destructive" });
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const defaultsDirty = defaultDuration !== defaultsPristine.defaultDuration
    || autoStartTimer !== defaultsPristine.autoStartTimer
    || enableVoice !== defaultsPristine.enableVoice;
  const handleCancelDefaults = () => {
    setDefaultDuration(defaultsPristine.defaultDuration);
    setAutoStartTimer(defaultsPristine.autoStartTimer);
    setEnableVoice(defaultsPristine.enableVoice);
  };

  const handleSaveCompliance = async () => {
    setIsSavingCompliance(true);
    try {
      await saveToServer({
        data: {
          compliance: {
            requireActivity,
            requireNotes,
            requireDuration,
            // Send null when list is empty so the backend falls back to built-in
            // defaults rather than treating an empty array as "no types required".
            physicalExamSessionTypes: physicalExamSessionTypes.length > 0 ? physicalExamSessionTypes : null,
          },
        },
      });
      setCompliancePristine({ requireActivity, requireNotes, requireDuration, physicalExamSessionTypes });
      toast({ title: translate("settings.toast.complianceSaved") });
    } catch {
      toast({ title: translate("settings.toast.saveFailed"), description: translate("settings.toast.complianceSaveFailed"), variant: "destructive" });
    } finally {
      setIsSavingCompliance(false);
    }
  };

  const complianceDirty = requireActivity !== compliancePristine.requireActivity
    || requireNotes !== compliancePristine.requireNotes
    || requireDuration !== compliancePristine.requireDuration
    || JSON.stringify(physicalExamSessionTypes) !== JSON.stringify(compliancePristine.physicalExamSessionTypes);
  const handleCancelCompliance = () => {
    setRequireActivity(compliancePristine.requireActivity);
    setRequireNotes(compliancePristine.requireNotes);
    setRequireDuration(compliancePristine.requireDuration);
    setPhysicalExamSessionTypes(compliancePristine.physicalExamSessionTypes);
  };

  const handleAddSessionType = () => {
    const trimmed = newSessionType.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (physicalExamSessionTypes.some((t) => t.toLowerCase() === lower)) {
      toast({ title: translate("settings.toast.alreadyInList"), description: translateParams("settings.toast.alreadyInListDesc", { name: trimmed }) });
      return;
    }
    setPhysicalExamSessionTypes((prev) => [...prev, trimmed]);
    setNewSessionType("");
  };

  const handleRemoveSessionType = (index: number) => {
    setPhysicalExamSessionTypes((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResetToDefaults = () => {
    setPhysicalExamSessionTypes(DEFAULT_PHYSICAL_TYPES);
  };

  // -- Loading overlay --------------------------------------------------------
  const LoadingRow = () => (
    <div className="flex items-center gap-2 text-[13px] py-4" style={{ color: "var(--cc-muted)" }}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{translate("settings.loading")}</span>
    </div>
  );

  // -- Render -----------------------------------------------------------------
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 min-h-full pb-12">
      {modal}

      {/* -- Page header ------------------------------------------------------- */}
      <div>
        <h1 className="text-[26px] font-black tracking-tight" style={{ color: "var(--cc-text)" }}>{translate("settings.title")}</h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--cc-muted)" }}>
          {translate("settings.subtitle")}
        </p>
      </div>

      {/* -- Mobile nav (outside flex row — stacks vertically on mobile) ------ */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-1">
        {visibleNavItems.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold whitespace-nowrap transition-all shrink-0"
            style={{
              background: activeSection === id ? "var(--cc-cta)" : "var(--cc-soft)",
              color: activeSection === id ? "white" : "var(--cc-text)",
            }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: activeSection === id ? "white" : "var(--cc-muted)" }} />
            {translate(labelKey)}
          </button>
        ))}
      </div>

      <div className="flex gap-6">

      {/* -- Sticky sidebar ---------------------------------------------------- */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0">
        <div className="sticky top-0 space-y-0.5">
          <p className="text-[11px] font-bold uppercase tracking-widest px-3 pb-3" style={{ color: "var(--cc-muted)" }}>
            Settings
          </p>
          {visibleNavItems.map(({ id, labelKey, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150 text-left"
              style={{
                background: activeSection === id ? "var(--cc-cta)" : "transparent",
                color: activeSection === id ? "white" : "var(--cc-text)",
              }}
            >
              <Icon
                className="h-4 w-4 shrink-0"
                style={{ color: activeSection === id ? "white" : "var(--cc-muted)" }}
              />
              {translate(labelKey)}
            </button>
          ))}
        </div>
      </aside>

      {/* -- Content panel ----------------------------------------------------- */}
      <main className="flex-1 min-w-0 space-y-6">

        {/* -- Account section ----------------------------------------------- */}
        {activeSection === "account" && (
          <Section
            title={translate("settings.account.title")}
            description={translate("settings.account.subtitle")}
            icon={User}
          >
            {/* Personal details card */}
            <PanelCard label={translate("settings.practitioner.label")}>
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-5">
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--cc-muted)" }}>
                    {translate("settings.practitioner.hint")}
                  </p>

                  <ProfilePhotoUpload cropCircle />

                  <div className="flex items-center justify-between gap-4 rounded-xl px-4 py-3" style={{ background: "var(--cc-soft)" }}>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>{translate("profile.email")}</p>
                      <p className="mt-0.5 text-[14px] font-semibold truncate" style={{ color: "var(--cc-text)" }}>{user?.email || "—"}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold" style={{ color: "var(--cc-muted)" }}>{translate("settings.practitioner.fromAccount")}</span>
                  </div>

                  <div className={cn("grid grid-cols-1 gap-4", !isMD && "sm:grid-cols-2")}>
                    <div className={cn("space-y-1.5", isMD && "max-w-sm")}>
                      <Label htmlFor="pract-name" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>{translate("settings.practitioner.fullName")}</Label>
                      <Input
                        id="pract-name"
                        value={practName}
                        onChange={(e) => setPractName(e.target.value)}
                        placeholder="e.g. Jane Smith"
                        className="rounded-lg"
                      />
                    </div>
                    {!isMD && (
                      <div className="space-y-1.5">
                        <Label htmlFor="pract-credentials" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>{translate("settings.practitioner.credentials")}</Label>
                        <Input
                          id="pract-credentials"
                          value={practCredentials}
                          onChange={(e) => setPractCredentials(e.target.value)}
                          placeholder="e.g. RN, B.Sc. Nursing"
                          className="rounded-lg"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </PanelCard>

            <StickyActionBar visible={practDirty} saving={isSavingPract} onSave={handleSavePractitioner} onCancel={handleCancelPractitioner} />

            {/* Password card */}
            <PanelCard label={translate("settings.password.label")}>
              {canChangeOwnPassword ? (
                <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="current-password" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>{translate("profile.currentPassword")}</Label>
                      <PasswordInput id="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="rounded-lg" autoComplete="current-password" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-password" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>{translate("profile.newPassword")}</Label>
                      <PasswordInput id="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="rounded-lg" autoComplete="new-password" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirm-password" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>{translate("profile.confirmPassword")}</Label>
                      <PasswordInput id="confirm-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="rounded-lg" autoComplete="new-password" />
                    </div>
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>{translate("profile.passwordPolicyHint")}</p>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword} className="gap-1.5 min-w-[150px]">
                      {isChangingPassword ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />}
                      {translate("profile.updatePassword")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="rounded-xl p-4" style={{ background: "var(--cc-soft)" }}>
                  <p className="text-[13px]" style={{ color: "var(--cc-muted)" }}>{translate("profile.passwordResetPolicyHint")}</p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 gap-1.5"
                    onClick={() => void handleRequestPasswordReset()}
                    disabled={isRequestingReset || resetRequested}
                  >
                    {isRequestingReset ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />}
                    {resetRequested ? translate("profile.passwordResetAlreadyRequested") : translate("profile.requestPasswordReset")}
                  </Button>
                </div>
              )}
            </PanelCard>

            {/* Signature card */}
            <PanelCard label={translate("settings.signature.label")}>
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-5">
                  {savedSignature && (
                    <div className="rounded-xl p-4" style={{ background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.2)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "#16A34A" }}>
                          <Check className="h-3.5 w-3.5" /> {translate("settings.signature.saved")}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 gap-1"
                          onClick={handleClear}
                          disabled={isSaving}
                        >
                          <Trash2 className="h-3 w-3" /> {translate("common.remove")}
                        </Button>
                      </div>
                      <div className="bg-white rounded-xl p-3 flex items-center justify-center h-20" style={{ border: "1px solid rgba(22,163,74,0.15)" }}>
                        <img src={savedSignature} alt="Saved signature" className="max-h-full max-w-full object-contain" />
                      </div>
                    </div>
                  )}

                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "draw" | "upload")}>
                    <TabsList className="w-full rounded-lg h-9">
                      <TabsTrigger value="draw" className="flex-1 gap-1.5 text-xs">
                        <PenLine className="h-3.5 w-3.5" /> {translate("settings.signature.draw")}
                      </TabsTrigger>
                      <TabsTrigger value="upload" className="flex-1 gap-1.5 text-xs">
                        <Upload className="h-3.5 w-3.5" /> {translate("settings.signature.upload")}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="draw" className="space-y-3 mt-4">
                      <p className="text-[12px] leading-relaxed" style={{ color: "var(--cc-muted)" }}>
                        Draw your signature using your mouse, stylus, or finger on a touchscreen.
                      </p>
                      <div
                        className={cn("rounded-xl border-2 border-dashed overflow-hidden cursor-crosshair bg-white transition-colors")}
                        style={{ borderColor: hasDrawing ? "var(--cc-plum)" : "var(--cc-border)", touchAction: "none" }}
                      >
                        <canvas
                          ref={canvasRef}
                          width={560}
                          height={160}
                          className="w-full block"
                          style={{ touchAction: "none" }}
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={startDrawing}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={clearCanvas} disabled={!hasDrawing}>
                          <RotateCcw className="h-3.5 w-3.5" /> {translate("settings.signature.clear")}
                        </Button>
                        <Button size="sm" className="gap-1.5 ml-auto" onClick={saveDrawn} disabled={!hasDrawing || isSaving || isLoadingSettings}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {translate("settings.signature.save")}
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="upload" className="space-y-3 mt-4">
                      <p className="text-[12px] leading-relaxed" style={{ color: "var(--cc-muted)" }}>
                        Upload a PNG or JPG of your handwritten signature. Scan on a white background for best results. Max 2 MB.
                      </p>
                      <div
                        className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 cursor-pointer transition-colors bg-white hover:bg-[var(--cc-soft)]"
                        style={{ borderColor: uploadPreview ? "var(--cc-plum)" : "var(--cc-border)" }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploadPreview ? (
                          <img src={uploadPreview} alt="Signature preview" className="max-h-24 max-w-full object-contain" />
                        ) : (
                          <>
                            <ImageIcon className="h-8 w-8 mb-2" style={{ color: "var(--cc-border)" }} />
                            <span className="text-[13px]" style={{ color: "var(--cc-muted)" }}>Click to upload a signature image</span>
                            <span className="text-[11px] mt-1" style={{ color: "var(--cc-muted)" }}>PNG or JPG, max 2 MB</span>
                          </>
                        )}
                      </div>
                      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" title="Upload profile photo (PNG or JPG, max 2 MB)" className="hidden" onChange={handleFileChange} />
                      <div className="flex gap-2">
                        {uploadPreview && (
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setUploadPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                            <RotateCcw className="h-3.5 w-3.5" /> Reset
                          </Button>
                        )}
                        <Button size="sm" className="gap-1.5 ml-auto" onClick={saveUploaded} disabled={!uploadPreview || isSaving || isLoadingSettings}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {translate("settings.signature.save")}
                        </Button>
                      </div>
                    </TabsContent>
                  </Tabs>

                  <div className="pt-2 border-t text-[11px] leading-relaxed" style={{ borderColor: "var(--cc-border)", color: "var(--cc-muted)" }}>
                    Signatures are synced to the server and cached locally for offline access. They appear in the sign-off block of every exported PDF audit report.
                  </div>
                </div>
              )}
            </PanelCard>
          </Section>
        )}

        {/* -- Provider section ----------------------------------------------- */}
        {activeSection === "provider" && (
          <Section
            title={translate("settings.provider.title")}
            description={translate("settings.provider.subtitle")}
            icon={Building2}
          >
            <PanelCard label={translate("settings.provider.businessInfo")}>
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5 max-w-sm">
                    <Label htmlFor="business-name" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>{translate("settings.provider.businessName")}</Label>
                    <Input
                      id="business-name"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. Sunshine Support Services Pty Ltd"
                      className="rounded-lg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="abn" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>
                      ABN <span className="font-normal" style={{ color: "var(--cc-muted)" }}>(Australian Business Number)</span>
                    </Label>
                    <Input
                      id="abn"
                      value={abn}
                      onChange={(e) => setAbn(e.target.value)}
                      placeholder="e.g. 51 824 753 556"
                      className={cn("rounded-lg max-w-[220px]", abnError && "border-red-400 focus-visible:ring-red-400")}
                      maxLength={14}
                    />
                    {abnError && (
                      <p className="text-xs text-red-500">Please enter a valid 11-digit ABN.</p>
                    )}
                    {!abnError && abnShowValid && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Valid ABN
                      </p>
                    )}
                    {!abnError && !abnShowValid && abnDigits.length > 0 && (
                      <p className="text-[11px]" style={{ color: "var(--cc-muted)" }}>{11 - abnDigits.length} more digit{11 - abnDigits.length !== 1 ? "s" : ""} needed</p>
                    )}
                  </div>
                </div>
              )}
            </PanelCard>

            <StickyActionBar visible={providerDirty} saving={isSavingProvider} onSave={handleSaveProvider} onCancel={handleCancelProvider} />
          </Section>
        )}

        {/* -- Session Defaults section --------------------------------------- */}
        {activeSection === "defaults" && (
          <Section
            title={translate("settings.defaults.title")}
            description={translate("settings.defaults.subtitle")}
            icon={Settings2}
          >
            <PanelCard label={translate("settings.defaults.duration")}>
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="default-duration" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>
                    Default Duration <span className="font-normal" style={{ color: "var(--cc-muted)" }}>(minutes)</span>
                  </Label>
                  <Input
                    id="default-duration"
                    type="number"
                    min={1}
                    max={480}
                    value={defaultDuration}
                    onChange={(e) => setDefaultDuration(e.target.value)}
                    placeholder="60"
                    className="max-w-[120px] rounded-lg"
                  />
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>Used as the planned duration when creating sessions</p>
                </div>
              )}
            </PanelCard>

            <PanelCard label={translate("settings.defaults.automation")}>
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
                  <SettingRow
                    title="Auto-start timer"
                    description="Timer starts automatically when you open the session page, so you never forget to start it."
                    checked={autoStartTimer}
                    onCheckedChange={setAutoStartTimer}
                  />
                  <SettingRow
                    title="Enable voice dictation"
                    description="Voice recording is activated by default when a session starts, ready to capture notes hands-free."
                    checked={enableVoice}
                    onCheckedChange={setEnableVoice}
                  />
                </div>
              )}
            </PanelCard>

            <StickyActionBar visible={defaultsDirty} saving={isSavingDefaults} onSave={handleSaveDefaults} onCancel={handleCancelDefaults} />
          </Section>
        )}

        {/* -- Compliance section --------------------------------------------- */}
        {activeSection === "compliance" && (
          <Section
            title={translate("settings.compliance.title")}
            description={translate("settings.compliance.subtitle")}
            icon={ShieldCheck}
          >
            <PanelCard label={translate("settings.compliance.required")}>
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
                  <SettingRow
                    title="Require activity log"
                    description="At least one support activity must be logged during the session before it can be approved."
                    checked={requireActivity}
                    onCheckedChange={setRequireActivity}
                  />
                  <SettingRow
                    title="Require clinical notes"
                    description="Clinical notes must be completed and contain substantive content before the session can be approved."
                    checked={requireNotes}
                    onCheckedChange={setRequireNotes}
                  />
                  <SettingRow
                    title="Require session duration"
                    description="The session timer must have been run and record a duration greater than zero before approval."
                    checked={requireDuration}
                    onCheckedChange={setRequireDuration}
                  />
                </div>
              )}
            </PanelCard>

            <PanelCard label={translate("settings.compliance.physicalExam")}>
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--cc-text)" }}>
                    When a session's type matches one of the names below, the compliance engine will warn if no body examination markers have been recorded.
                    Names are matched case-insensitively. This list <strong>replaces</strong> the built-in defaults. Leave it empty to keep using the built-in set (physiotherapy, OT, therapy, rehab, etc.).
                  </p>

                  {/* Current list */}
                  {physicalExamSessionTypes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {physicalExamSessionTypes.map((type, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-full text-[12px] font-medium px-2.5 py-1"
                          style={{ background: "var(--cc-plum-soft)", color: "var(--cc-plum)", border: "1px solid var(--cc-plum-border)" }}
                        >
                          {type}
                          <button
                            type="button"
                            onClick={() => handleRemoveSessionType(i)}
                            className="ml-0.5 hover:text-red-500 transition-colors" style={{ color: "var(--cc-plum)" }}
                            aria-label={`Remove ${type}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[12px] rounded-xl px-3 py-2.5 border border-dashed"
                      style={{ color: "var(--cc-muted)", background: "var(--cc-soft)", borderColor: "var(--cc-border)" }}>
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span>No custom types saved. The built-in defaults (physiotherapy, OT, therapy, rehab…) are used.</span>
                    </div>
                  )}

                  {/* Add new type */}
                  <div className="flex gap-2">
                    <Input
                      value={newSessionType}
                      onChange={(e) => setNewSessionType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleAddSessionType(); }
                      }}
                      placeholder="e.g. hydrotherapy, support coordination…"
                      className="rounded-lg text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={handleAddSessionType}
                      disabled={!newSessionType.trim()}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>

                  {/* Reset to defaults helper */}
                  <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: "var(--cc-border)" }}>
                    <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                      Reset to restore the standard built-in list
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[12px] gap-1 hover:text-[var(--cc-text)]"
                      style={{ color: "var(--cc-text)" }}
                      onClick={handleResetToDefaults}
                    >
                      <RotateCcw className="h-3 w-3" /> Reset to defaults
                    </Button>
                  </div>
                </div>
              )}
            </PanelCard>

            {!isLoadingSettings && (
              <div
                className="rounded-2xl p-4 text-[12px] leading-relaxed space-y-2"
                style={{
                  background: "var(--cc-soft)",
                  border: "1px solid var(--cc-border)",
                  borderLeft: "3px solid var(--cc-plum)",
                }}
              >
                <p className="font-bold text-[13px]" style={{ color: "var(--cc-text)" }}>How compliance requirements work</p>
                <p style={{ color: "var(--cc-text)" }}>
                  These toggles add enforcement gates on top of the built-in NDIS compliance scoring. When a rule is enabled, the
                  Approve &amp; Save action is blocked with a clear message if the requirement is not met. The gate fires before the session
                  review modal opens, so practitioners are prompted to complete the missing documentation immediately.
                </p>
                <p style={{ color: "var(--cc-text)" }}>
                  The built-in engine always runs regardless of these toggles and tracks participant linkage, duration, activities, clinical notes,
                  photo evidence, and goal linkage.
                </p>
              </div>
            )}

            <StickyActionBar visible={complianceDirty} saving={isSavingCompliance} onSave={handleSaveCompliance} onCancel={handleCancelCompliance} />
          </Section>
        )}

        {/* -- Accessibility section ------------------------------------------- */}
        {activeSection === "accessibility" && (
          <AccessibilityPanel showHeader={false} />
        )}

        {/* -- Privacy & data section ------------------------------------------ */}
        {activeSection === "privacy" && (
          <Section
            title={translate("settings.privacy.title")}
            description={translate("settings.privacy.subtitle")}
            icon={Shield}
          >
            <WorkerPrivacy showHeader={false} />
          </Section>
        )}

        {/* -- Notifications section (coordinator only) ----------------------- */}
        {activeSection === "notifications" && isCoordinator && (
          <NotificationsSection />
        )}

        {activeSection === "team" && isCoordinator && (
          <Section
            title={translate("settings.team.title")}
            description={translate("settings.team.subtitle")}
            icon={Users2}
          >
            {/* Active members */}
            <PanelCard label={translate("settings.team.activeMembers")}>
              {loadingTeam ? (
                <div className="flex items-center gap-2 text-[13px] py-4" style={{ color: "var(--cc-muted)" }}>
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
                </div>
              ) : members.length === 0 ? (
                <p className="text-[13px] py-4 text-center" style={{ color: "var(--cc-muted)" }}>
                  No members found. Invite your first staff member below.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
                  {members.map((m) => {
                    const rc = ROLE_COLORS[m.role] ?? ROLE_COLORS.support_worker;
                    return (
                      <div key={m.id} className="flex items-center gap-3 py-3">
                        {/* Avatar */}
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                          style={{ background: "var(--cc-plum-soft)", color: "var(--cc-plum)" }}
                        >
                          {(m.full_name || m.email || "?")[0].toUpperCase()}
                        </div>

                        {/* Name + email */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: "var(--cc-text)" }}>
                            {m.full_name || "(No name)"}
                          </p>
                          <p className="text-[11px] truncate" style={{ color: "var(--cc-muted)" }}>{m.email}</p>
                        </div>

                        {/* Role selector — prevent changing own role */}
                        {m.user_id !== user?.id ? (
                          <select
                            title="User role"
                            value={m.role}
                            onChange={(e) => handleChangeRole(m.id, e.target.value)}
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer shrink-0"
                            style={{ background: rc.bg, color: rc.color }}
                          >
                            <option value="support_worker">Support Worker</option>
                            <option value="support_coordinator">Support Coordinator</option>
                          </select>
                        ) : (
                          <span
                            className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0"
                            style={{ background: rc.bg, color: rc.color }}
                          >
                            {ROLE_LABELS[m.role] ?? m.role}
                          </span>
                        )}

                        {/* Joined date */}
                        <span className="text-[11px] shrink-0 hidden sm:block" style={{ color: "var(--cc-muted)" }}>
                          Joined {m.joined_at ? new Date(m.joined_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "N/A"}
                        </span>

                        {/* Remove — prevent removing self */}
                        {m.user_id !== user?.id && (
                          <button
                            onClick={() => handleRemoveMember(m.id, m.full_name)}
                            title="Remove member"
                            className="p-1.5 rounded-lg transition-colors hover:bg-red-50 shrink-0"
                            style={{ color: "var(--cc-muted)" }}
                          >
                            <UserMinus size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </PanelCard>

            {/* Pending invitations */}
            <PanelCard label={translate("settings.team.pendingInvites")}>
              {invites.length === 0 ? (
                <p className="text-[13px] py-3 text-center" style={{ color: "var(--cc-muted)" }}>
                  No pending invitations.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
                  {invites.map((inv) => {
                    const rc = ROLE_COLORS[inv.role] ?? ROLE_COLORS.support_worker;
                    const expires = new Date(inv.expires_at);
                    const expired = expires < new Date();
                    return (
                      <div key={inv.id} className="flex items-center gap-3 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: "var(--cc-text)" }}>{inv.email}</p>
                          <p className="text-[11px]" style={{ color: expired ? "#dc2626" : "var(--cc-muted)" }}>
                            {expired ? "Expired" : "Expires"} {expires.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <span
                          className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0"
                          style={{ background: rc.bg, color: rc.color }}
                        >
                          {ROLE_LABELS[inv.role] ?? inv.role}
                        </span>

                        {/* Copy link */}
                        <button
                          onClick={() => copyInviteLink(inv)}
                          title="Copy invite link"
                          className="p-1.5 rounded-lg transition-colors hover:bg-[var(--cc-soft)] shrink-0"
                          style={{ color: copiedToken === inv.id ? "#22c55e" : "var(--cc-muted)" }}
                        >
                          {copiedToken === inv.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>

                        {/* Revoke */}
                        <button
                          onClick={() => handleRevokeInvite(inv.id)}
                          title="Revoke invitation"
                          className="p-1.5 rounded-lg transition-colors hover:bg-red-50 shrink-0"
                          style={{ color: "var(--cc-muted)" }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </PanelCard>

            {/* Invite button */}
            <div className="flex justify-end">
              <Link href="/team" className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm font-medium">
                <Plus size={15} /> {translate("settings.team.inviteStaff")}
              </Link>
            </div>

            {/* Explainer */}
            <div
              className="rounded-2xl p-4 text-[12px] leading-relaxed space-y-2"
              style={{
                background: "var(--cc-soft)",
                border: "1px solid var(--cc-border)",
                borderLeft: "3px solid var(--cc-plum)",
              }}
            >
              <p className="font-bold text-[13px]" style={{ color: "var(--cc-text)" }}>How staff invitations work</p>
              <p style={{ color: "var(--cc-text)" }}>
                Inviting a staff member generates a secure token link (7-day expiry). The invitee
                clicks the link, sets their password, and is immediately added to your organisation
                with the role you selected. Their access is scoped to only the participants and sessions
                your org allocates to them.
              </p>
              <p style={{ color: "var(--cc-text)" }}>
                Email delivery is not yet configured. Copy and share the link manually. Pending invitations
                can be revoked at any time before they are accepted.
              </p>
            </div>
          </Section>
        )}

        {activeSection === "branding" && isMD && (
          <OrganizationBrandingSection />
        )}

      </main>

      </div>{/* end flex gap-6 */}

    </div>
  );
}
