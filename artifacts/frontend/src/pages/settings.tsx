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
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import QRCode from "react-qr-code";
import { PasswordInput } from "@/components/PasswordInput";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { useReAuth } from "@/hooks/useReAuth";
import { Link } from "wouter";
import {
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import { AvatarPicker, AvatarDisplay } from "@/components/AvatarPicker";
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
type SectionId = "account" | "provider" | "defaults" | "compliance" | "notifications" | "team";

const NAV_ITEMS: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }>; coordinatorOnly?: boolean }[] = [
  { id: "account",       label: "Account",          icon: User        },
  { id: "provider",      label: "Provider",          icon: Building2   },
  { id: "defaults",      label: "Session Defaults",  icon: Settings2   },
  { id: "compliance",    label: "Compliance",        icon: ShieldCheck },
  { id: "notifications", label: "Notifications",     icon: Bell, coordinatorOnly: true },
  { id: "team",          label: "Team",              icon: Users2, coordinatorOnly: true },
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
    <div className="flex items-center justify-between gap-6 px-4 py-4 hover:bg-[#F8F6FE] transition-colors rounded-xl group">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold" style={{ color: "var(--cc-text)" }}>{title}</p>
        <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: "var(--cc-muted)" }}>{description}</p>
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
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3.5 pb-1">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(55,48,163,0.09)" }}
        >
          <Icon className="h-[18px] w-[18px]" style={{ color: "#3730A3" }} />
        </div>
        <div>
          <h2 className="text-[18px] font-bold tracking-tight" style={{ color: "var(--cc-text)" }}>{title}</h2>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--cc-muted)" }}>{description}</p>
        </div>
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
      style={{
        border: "1px solid #EBE5F6",
        boxShadow: "0 2px 12px rgba(55,48,163,0.05), 0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      {label && (
        <div
          className="px-5 py-3 border-b flex items-center gap-2"
          style={{
            background: "transparent",
            borderColor: "#EBE5F6",
          }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#3730A3" }}>{label}</p>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const ROLE_LABELS: Record<string, string> = {
  support_coordinator: "CareCliQ Parent",
  allied_health:       "CareCliQ Pro",
  support_worker:      "CareCliQ Child",
};

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  support_coordinator: { bg: "rgba(55,48,163,0.1)",   color: "#3730A3" },
  allied_health:       { bg: "rgba(16,185,129,0.1)",  color: "#047857" },
  support_worker:      { bg: "rgba(100,116,139,0.1)", color: "#475569" },
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

// ─────────────────────────────────────────────────────────────────────────────
// CARECLIQV2-241 — Notification Preferences section
// ─────────────────────────────────────────────────────────────────────────────

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
  const [prefs, setPrefs] = useState<NotifPrefs>(defaultPrefs());
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
          setPrefs((p) => ({
            ...p, events,
            quiet_hours_enabled: data.quiet_hours_enabled ?? false,
            quiet_from: data.quiet_from ?? "22:00",
            quiet_to: data.quiet_to ?? "07:00",
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      toast({ title: "Notification preferences saved" });
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
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
        <Loader2 size={14} className="animate-spin" /> Loading preferences…
      </div>
    );
  }

  return (
    <Section
      title="Notifications"
      description="Control which events trigger notifications and how you receive them."
      icon={Bell}
    >
      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto rounded-xl" style={{ border: "1px solid #E5E7EB" }}>
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
                      checked={prefs.events[ev.key]?.[ch] ?? false}
                      disabled={ch === "in_app"}
                      onChange={() => toggleEvent(ev.key, ch)}
                      className="w-4 h-4 accent-[#3730A3] cursor-pointer disabled:cursor-default disabled:opacity-60"
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
          <div key={ev.key} className="rounded-xl p-4 border transition-colors" style={{ borderColor: "rgba(232,213,232,0.5)", background: "var(--cc-bg)" }}>
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
                    checked={prefs.events[ev.key]?.[ch] ?? false}
                    disabled={ch === "in_app"}
                    onChange={() => toggleEvent(ev.key, ch)}
                    className="w-4 h-4 accent-[#3730A3] cursor-pointer disabled:cursor-default disabled:opacity-60"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Quiet hours */}
      <div className="mt-4 rounded-2xl p-4 space-y-3" style={{ background: "var(--cc-soft)", border: "1px solid #E5E7EB" }}>
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
                value={prefs.quiet_from}
                onChange={(e) => setPrefs((p) => ({ ...p, quiet_from: e.target.value }))}
                className="h-9 rounded-xl px-3 text-[13px] outline-none"
                style={{ border: "1px solid #E5E7EB" }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold" style={{ color: "var(--cc-muted)" }}>To</label>
              <input
                type="time"
                value={prefs.quiet_to}
                onChange={(e) => setPrefs((p) => ({ ...p, quiet_to: e.target.value }))}
                className="h-9 rounded-xl px-3 text-[13px] outline-none"
                style={{ border: "1px solid #E5E7EB" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button
          className="rounded-2xl px-8"
          style={{ background: "var(--cc-plum)", color: "#fff" }}
          disabled={saving}
          onClick={save}
        >
          {saving ? <><Loader2 size={14} className="animate-spin mr-2" /> Saving…</> : "Save Preferences"}
        </Button>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Security Section — available to all roles
// ─────────────────────────────────────────────────────────────────────────────

function SecuritySection() {
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();

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
        toast({ title: "Could not load security settings", variant: "destructive" });
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
      toast({ title: "Could not start 2FA setup", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
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
      toast({ title: "Two-factor authentication enabled", description: "Save your recovery codes in a secure place." });
    } catch (error) {
      toast({ title: "Verification failed", description: error instanceof Error ? error.message : "Check the code and try again.", variant: "destructive" });
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
      toast({ title: "Two-factor authentication disabled" });
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
      toast({ title: "Trusted device removed" });
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
      toast({ title: "Other sessions signed out" });
    } catch (error) {
      toast({ title: "Could not sign out other devices", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
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
      toast({ title: "Name updated" });
    } catch (error) {
      toast({ title: "Could not rename", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm" style={{ color: "var(--cc-muted)" }}>
        <Loader2 size={14} className="animate-spin" /> Loading security settings…
      </div>
    );
  }

  return (
    <Section
      title="Security"
      description="Two-factor authentication, trusted devices, active sessions, and sign-in history."
      icon={LockKeyhole}
    >
      {modal}

      {/* QR code dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan QR code</DialogTitle>
            <DialogDescription>Open your authenticator app and scan this code to add CareCliQ.</DialogDescription>
          </DialogHeader>
          {enrollOtpAuthUrl && (
            <div className="flex justify-center rounded-xl bg-white p-5 ring-1 ring-[#E5E7EB]">
              <QRCode value={enrollOtpAuthUrl} size={200} bgColor="#FFFFFF" fgColor="#111827" />
            </div>
          )}
          <p className="text-center text-xs" style={{ color: "var(--cc-muted)" }}>Or enter the secret key manually if scanning is not available.</p>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renamingId} onOpenChange={(open) => { if (!open) { setRenamingId(null); setRenameKind(null); setRenameValue(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename {renameKind}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="rounded-xl" autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => { setRenamingId(null); setRenameKind(null); setRenameValue(""); }}>Cancel</Button>
              <Button size="sm" className="rounded-xl" style={{ background: "var(--cc-plum)" }} onClick={() => void submitRename()} disabled={!renameValue.trim()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Two-factor authentication */}
      <PanelCard label="Two-Factor Authentication">
        {recoveryCodes && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-900">Save your recovery codes</p>
            <p className="mt-1 text-sm text-amber-800">Each code can be used once if you lose access to your authenticator app.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm text-[#111827] sm:grid-cols-4">
              {recoveryCodes.map((code) => (
                <div key={code} className="rounded-lg bg-white px-3 py-2 text-center">{code}</div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-3 rounded-xl gap-2"
              onClick={() => { void navigator.clipboard.writeText(recoveryCodes.join("\n")); toast({ title: "Recovery codes copied" }); }}>
              <Copy className="h-3.5 w-3.5" /> Copy codes
            </Button>
          </div>
        )}

        {!mfaStatus?.enabled ? (
          enrolling && enrollSecret ? (
            <form onSubmit={handleVerifyEnrollment} className="space-y-4">
              <div className="rounded-xl bg-[#F8F8FE] p-4">
                <p className="text-sm font-semibold" style={{ color: "var(--cc-text)" }}>Set up your authenticator app</p>
                <p className="mt-1 text-sm" style={{ color: "var(--cc-muted)" }}>Scan the QR code or add a manual entry in Google Authenticator, Authy, or 1Password.</p>
                <div className="mt-3 flex items-stretch gap-2">
                  <code className="flex-1 break-all rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#3730A3]">{enrollSecret}</code>
                  <button type="button" onClick={() => setQrOpen(true)} aria-label="Show QR code" title="Show QR code"
                    className="flex min-w-[48px] items-center justify-center rounded-xl border bg-white px-3 hover:bg-[#EEF2FF]" style={{ borderColor: "var(--cc-border)" }}>
                    <QrCode className="h-5 w-5 text-[#3730A3]" />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sec-totp-code">Enter the 6-digit code</Label>
                <Input id="sec-totp-code" value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)}
                  inputMode="numeric" autoComplete="one-time-code" className="rounded-xl max-w-[200px] tracking-widest" placeholder="000000" />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => { setEnrolling(false); setEnrollSecret(null); setEnrollOtpAuthUrl(null); setQrOpen(false); setEnrollCode(""); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={enrollBusy || !enrollCode.trim()} className="rounded-xl" style={{ background: "var(--cc-plum)" }}>
                  {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify and enable"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "var(--cc-muted)" }}>Add an extra layer of protection with an authenticator app (Google Authenticator, Authy, 1Password).</p>
              <Button type="button" onClick={() => void handleStartEnrollment()} disabled={enrollBusy} className="rounded-xl gap-2" style={{ background: "var(--cc-plum)" }}>
                {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                Enable authenticator app
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#166534" }}>
              <Check className="h-4 w-4" /> Two-factor authentication is active
            </div>
            <form onSubmit={handleDisableMfa} className="max-w-md space-y-3 border-t pt-4" style={{ borderColor: "var(--cc-border)" }}>
              <p className="text-sm" style={{ color: "var(--cc-muted)" }}>To disable 2FA, confirm your current password.</p>
              <div className="space-y-1.5">
                <Label htmlFor="sec-disable-mfa">Current password</Label>
                <PasswordInput id="sec-disable-mfa" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} className="rounded-xl max-w-sm" />
              </div>
              <Button type="submit" variant="outline" disabled={disableBusy || !disablePassword} className="rounded-xl border-red-200 text-red-700 hover:bg-red-50">
                {disableBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disable two-factor authentication"}
              </Button>
            </form>
          </div>
        )}
      </PanelCard>

      {/* Trusted devices */}
      <PanelCard label="Trusted Devices">
        <p className="text-[12px] mb-3" style={{ color: "var(--cc-muted)" }}>Devices that can skip 2FA verification for 30 days.</p>
        {trustedDevices.length === 0 ? (
          <p className="text-sm py-1" style={{ color: "var(--cc-muted)" }}>No trusted devices.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
            {trustedDevices.map((device) => (
              <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>
                    {device.device_name}
                    {device.is_current && <span className="ml-2 rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-bold text-[#3730A3]">This device</span>}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {device.os_name} · trusted until {formatDistanceToNow(new Date(device.trusted_until), { addSuffix: true })}
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
      <PanelCard label="Active Sessions">
        <p className="text-[12px] mb-3" style={{ color: "var(--cc-muted)" }}>Devices currently signed in to your account.</p>
        {sessions.length === 0 ? (
          <p className="text-sm py-1" style={{ color: "var(--cc-muted)" }}>No active sessions found.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
            {sessions.map((session) => (
              <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>
                    {session.device_name}
                    {session.is_current && <span className="ml-2 rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-bold text-[#3730A3]">Current</span>}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>
                    {session.city || "Unknown location"}{session.country ? `, ${session.country}` : ""} · active {formatDistanceToNow(new Date(session.last_active_at), { addSuffix: true })}
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
          <p className="text-sm font-semibold" style={{ color: "var(--cc-text)" }}>Sign out all other devices</p>
          <div className="space-y-1.5">
            <Label htmlFor="sec-logout-others">Confirm your password</Label>
            <PasswordInput id="sec-logout-others" value={logoutOthersPassword} onChange={(e) => setLogoutOthersPassword(e.target.value)} className="rounded-xl max-w-sm" />
          </div>
          <Button type="submit" variant="outline" disabled={logoutOthersBusy || !logoutOthersPassword} className="rounded-xl">
            {logoutOthersBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign out other sessions"}
          </Button>
        </form>
      </PanelCard>

      {/* Recent sign-ins */}
      <PanelCard label="Recent Sign-ins">
        <p className="text-[12px] mb-3" style={{ color: "var(--cc-muted)" }}>Review recent account access activity.</p>
        {loginHistory.length === 0 ? (
          <p className="text-sm py-1" style={{ color: "var(--cc-muted)" }}>No sign-in history yet.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
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
                    <AlertTriangle className="h-3 w-3" /> Unusual sign-in
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

// ─────────────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { toast } = useToast();
  const { user, token: authToken } = useAuth();
  const { requireReAuth, modal } = useReAuth();
  const isCoordinator = user?.role === "support_coordinator";
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.coordinatorOnly || isCoordinator);

  const [activeSection, setActiveSection] = useState<SectionId>("account");
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"draw" | "upload">("draw");

  // ── Draw pad state ─────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);

  // ── Upload state ───────────────────────────────────────────────────────────
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Avatar state ───────────────────────────────────────────────────────────
  const [avatarId, setAvatarId] = useState<string | null>(null);

  // ── Practitioner Details state ─────────────────────────────────────────────
  const [practName, setPractName] = useState("");
  const [practCredentials, setPractCredentials] = useState("");
  const [isSavingPract, setIsSavingPract] = useState(false);

  // ── Provider Information state ─────────────────────────────────────────────
  const [businessName, setBusinessName] = useState("");
  const [abn, setAbn] = useState("");
  const [isSavingProvider, setIsSavingProvider] = useState(false);

  // ── Session Defaults state ─────────────────────────────────────────────────
  const [defaultDuration, setDefaultDuration] = useState<string>("60");
  const [autoStartTimer, setAutoStartTimer] = useState(false);
  const [enableVoice, setEnableVoice] = useState(false);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);

  // ── Compliance Requirements state ──────────────────────────────────────────
  const [requireActivity, setRequireActivity] = useState(false);
  const [requireNotes, setRequireNotes] = useState(false);
  const [requireDuration, setRequireDuration] = useState(false);
  const [physicalExamSessionTypes, setPhysicalExamSessionTypes] = useState<string[]>([]);
  const [newSessionType, setNewSessionType] = useState("");
  const [isSavingCompliance, setIsSavingCompliance] = useState(false);

  const DEFAULT_PHYSICAL_TYPES = [
    "physiotherapy", "physio", "occupational therapy", "OT",
    "physical therapy", "therapy", "exercise physiology",
    "hydrotherapy", "rehabilitation", "rehab", "massage",
    "manual therapy", "sports therapy",
  ];

  // ── Team state (support coordinator only) ──────────────────────────────────
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
      toast({ title: "Invitation revoked" });
    } catch {
      toast({ title: "Failed to revoke invitation", variant: "destructive" });
    }
  };

  const handleRemoveMember = async (memberId: string, name: string) => {
    if (!authToken) return;
    if (!confirm(`Remove ${name || "this member"} from the organization?`)) return;
    try {
      await requireReAuth(() => apiFetch(`/api/invitations/members/${memberId}`, { method: "DELETE" }));
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      toast({ title: "Member removed" });
    } catch {
      toast({ title: "Failed to remove member", variant: "destructive" });
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
      toast({ title: "Role updated", description: `Role changed to ${ROLE_LABELS[newRole] ?? newRole}` });
    } catch {
      toast({ title: "Failed to update role", variant: "destructive" });
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

  // ── API ────────────────────────────────────────────────────────────────────
  const { data: serverSettings, isLoading: isLoadingSettings } =
    useGetPractitionerSettings();

  const { mutateAsync: saveToServer, isPending: isSaving } =
    useSavePractitionerSettings();

  // ── Populate all fields from server settings ───────────────────────────────
  useEffect(() => {
    if (isLoadingSettings || !serverSettings) return;

    if (serverSettings.signature) {
      setSavedSignature(serverSettings.signature);
      saveSignature(serverSettings.signature);
    } else {
      const local = getStoredSignature();
      if (local) setSavedSignature(local);
    }

    if (serverSettings.name) setPractName(serverSettings.name);
    if (serverSettings.credentials) setPractCredentials(serverSettings.credentials);
    if (serverSettings.avatarId) setAvatarId(serverSettings.avatarId);

    const provider = serverSettings.provider as { businessName?: string | null; abn?: string | null } | null;
    if (provider?.businessName) setBusinessName(provider.businessName);
    if (provider?.abn) setAbn(provider.abn);

    const sd = serverSettings.sessionDefaults as {
      defaultDuration?: number | null;
      autoStartTimer?: boolean | null;
      enableVoice?: boolean | null;
    } | null;
    if (sd?.defaultDuration != null) setDefaultDuration(String(sd.defaultDuration));
    if (sd?.autoStartTimer != null) setAutoStartTimer(sd.autoStartTimer);
    if (sd?.enableVoice != null) setEnableVoice(sd.enableVoice);

    const comp = serverSettings.compliance as {
      requireActivity?: boolean | null;
      requireNotes?: boolean | null;
      requireDuration?: boolean | null;
      physicalExamSessionTypes?: string[] | null;
    } | null;
    if (comp?.requireActivity != null) setRequireActivity(comp.requireActivity);
    if (comp?.requireNotes != null) setRequireNotes(comp.requireNotes);
    if (comp?.requireDuration != null) setRequireDuration(comp.requireDuration);
    if (comp?.physicalExamSessionTypes != null) {
      setPhysicalExamSessionTypes(comp.physicalExamSessionTypes);
    }
  }, [serverSettings, isLoadingSettings]);

  // ── Canvas helpers ─────────────────────────────────────────────────────────
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

  // ── Save helpers ───────────────────────────────────────────────────────────
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
          title: "Saved locally",
          description: "Signature saved to this device. Server sync failed — it will retry next time you open Settings.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Signature saved",
        description: "Your signature is now synced and will appear on all PDF reports across all devices.",
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
    toast({ title: "Signature removed", description: "PDF reports will show the placeholder sign-here box." });
  }, [clearCanvas, saveToServer, serverSettings, toast]);

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      toast({ title: "Invalid file type", description: "Please upload a PNG or JPG image.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please upload an image smaller than 2 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => { setUploadPreview(reader.result as string); };
    reader.readAsDataURL(file);
  };

  // ── Avatar auto-save ───────────────────────────────────────────────────────
  const handleAvatarChange = async (newId: string | null) => {
    setAvatarId(newId);
    try {
      await saveToServer({ data: { avatarId: newId ?? null } });
    } catch {
      toast({ title: "Could not save avatar", variant: "destructive" });
    }
  };

  // ── Section save handlers ──────────────────────────────────────────────────
  const handleSavePractitioner = async () => {
    setIsSavingPract(true);
    try {
      await saveToServer({ data: { name: practName.trim() || null, credentials: practCredentials.trim() || null } });
      toast({ title: "Practitioner details saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save practitioner details.", variant: "destructive" });
    } finally {
      setIsSavingPract(false);
    }
  };

  const abnDigits = abn.replace(/\s/g, "");
  const abnHas11Digits = /^\d{11}$/.test(abnDigits);
  const abnValid = isValidABNFormat(abn);
  const abnError = abnDigits.length > 0 && abnDigits.length >= 11 && !abnHas11Digits;
  const abnShowValid = abnHas11Digits;

  const handleSaveProvider = async () => {
    if (!abnValid) {
      toast({ title: "Invalid ABN", description: "Please enter exactly 11 digits or leave the field blank.", variant: "destructive" });
      return;
    }
    setIsSavingProvider(true);
    try {
      await saveToServer({ data: { provider: { businessName: businessName.trim() || null, abn: abn.replace(/\s/g, "") || null } } });
      toast({ title: "Provider information saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save provider information.", variant: "destructive" });
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleSaveDefaults = async () => {
    setIsSavingDefaults(true);
    try {
      await saveToServer({ data: { sessionDefaults: { defaultDuration: defaultDuration ? Number(defaultDuration) : null, autoStartTimer, enableVoice } } });
      toast({ title: "Session defaults saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save session defaults.", variant: "destructive" });
    } finally {
      setIsSavingDefaults(false);
    }
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
      toast({ title: "Compliance requirements saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save compliance requirements.", variant: "destructive" });
    } finally {
      setIsSavingCompliance(false);
    }
  };

  const handleAddSessionType = () => {
    const trimmed = newSessionType.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (physicalExamSessionTypes.some((t) => t.toLowerCase() === lower)) {
      toast({ title: "Already in the list", description: `"${trimmed}" is already configured.` });
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

  // ── Loading overlay ────────────────────────────────────────────────────────
  const LoadingRow = () => (
    <div className="flex items-center gap-2 text-[13px] py-4" style={{ color: "#7A6A8A" }}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Loading settings…</span>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5 min-h-full pb-12">
      {modal}

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl px-6 py-4 flex items-center gap-4"
        style={{
          background: "rgba(55,48,163,0.06)",
          border: "1px solid rgba(55,48,163,0.1)",
        }}
      >
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(55,48,163,0.1)" }}
        >
          <Settings2 className="h-5 w-5" style={{ color: "#3730A3" }} />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-plum)" }}>Workspace Settings</h1>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--cc-muted)" }}>
            Manage your account, provider details, session defaults and compliance rules
          </p>
        </div>
      </div>

      {/* ── Mobile nav (outside flex row — stacks vertically on mobile) ────── */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-1">
        {visibleNavItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold whitespace-nowrap transition-all shrink-0"
            style={{
              background: activeSection === id ? "#3730A3" : "rgba(55,48,163,0.06)",
              color: activeSection === id ? "white" : "#374151",
            }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: activeSection === id ? "white" : "#6B7280" }} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-6">

      {/* ── Sticky sidebar ──────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-52 shrink-0">
        <div
          className="sticky top-0 rounded-2xl p-2.5 space-y-0.5"
          style={{
            background: "var(--cc-bg)",
            border: "1px solid #EBE5F6",
            boxShadow: "0 2px 12px rgba(55,48,163,0.05)",
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-1.5 pb-2.5" style={{ color: "var(--cc-muted)" }}>
            Navigation
          </p>
          {visibleNavItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150 text-left"
              style={{
                background: activeSection === id ? "#3730A3" : "transparent",
                color: activeSection === id ? "white" : "#374151",
              }}
            >
              <Icon
                className="h-4 w-4 shrink-0"
                style={{ color: activeSection === id ? "white" : "#6B7280" }}
              />
              {label}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Content panel ───────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 space-y-6">

        {/* ── Account section ─────────────────────────────────────────────── */}
        {activeSection === "account" && (
          <Section
            title="Account"
            description="Your practitioner identity and digital signature for NDIS audit reports."
            icon={User}
          >
            {/* Signature card */}
            <PanelCard label="Digital Signature">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-5">
                  {savedSignature && (
                    <div className="rounded-xl p-4" style={{ background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.2)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "#16A34A" }}>
                          <Check className="h-3.5 w-3.5" /> Signature saved
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 gap-1"
                          onClick={handleClear}
                          disabled={isSaving}
                        >
                          <Trash2 className="h-3 w-3" /> Remove
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
                        <PenLine className="h-3.5 w-3.5" /> Draw
                      </TabsTrigger>
                      <TabsTrigger value="upload" className="flex-1 gap-1.5 text-xs">
                        <Upload className="h-3.5 w-3.5" /> Upload Image
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="draw" className="space-y-3 mt-4">
                      <p className="text-[12px] leading-relaxed" style={{ color: "#7A6A8A" }}>
                        Draw your signature using your mouse, stylus, or finger on a touchscreen.
                      </p>
                      <div
                        className={cn("rounded-xl border-2 border-dashed overflow-hidden cursor-crosshair bg-white transition-colors")}
                        style={{ borderColor: hasDrawing ? "rgba(55,48,163,0.35)" : "rgba(232,213,232,0.7)", touchAction: "none" }}
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
                          <RotateCcw className="h-3.5 w-3.5" /> Clear
                        </Button>
                        <Button size="sm" className="gap-1.5 ml-auto" onClick={saveDrawn} disabled={!hasDrawing || isSaving || isLoadingSettings}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save Signature
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="upload" className="space-y-3 mt-4">
                      <p className="text-[12px] leading-relaxed" style={{ color: "#7A6A8A" }}>
                        Upload a PNG or JPG of your handwritten signature. Scan on a white background for best results. Max 2 MB.
                      </p>
                      <div
                        className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 cursor-pointer transition-colors bg-white hover:bg-[#F6F4FB]"
                        style={{ borderColor: uploadPreview ? "rgba(55,48,163,0.35)" : "rgba(232,213,232,0.7)" }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploadPreview ? (
                          <img src={uploadPreview} alt="Signature preview" className="max-h-24 max-w-full object-contain" />
                        ) : (
                          <>
                            <ImageIcon className="h-8 w-8 mb-2" style={{ color: "rgba(232,213,232,0.9)" }} />
                            <span className="text-[13px]" style={{ color: "#7A6A8A" }}>Click to upload a signature image</span>
                            <span className="text-[11px] mt-1" style={{ color: "#7A6A8A" }}>PNG or JPG — max 2 MB</span>
                          </>
                        )}
                      </div>
                      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFileChange} />
                      <div className="flex gap-2">
                        {uploadPreview && (
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setUploadPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                            <RotateCcw className="h-3.5 w-3.5" /> Reset
                          </Button>
                        )}
                        <Button size="sm" className="gap-1.5 ml-auto" onClick={saveUploaded} disabled={!uploadPreview || isSaving || isLoadingSettings}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save Signature
                        </Button>
                      </div>
                    </TabsContent>
                  </Tabs>

                  <div className="pt-2 border-t text-[11px] leading-relaxed" style={{ borderColor: "rgba(232,213,232,0.5)", color: "#7A6A8A" }}>
                    Signatures are synced to the server and cached locally for offline access. They appear in the sign-off block of every exported PDF audit report.
                  </div>
                </div>
              )}
            </PanelCard>

            {/* Practitioner details card */}
            <PanelCard label="Practitioner Details">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="pract-name" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>Full Name</Label>
                      <Input
                        id="pract-name"
                        value={practName}
                        onChange={(e) => setPractName(e.target.value)}
                        placeholder="e.g. Jane Smith"
                        className="rounded-lg"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pract-credentials" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>Credentials</Label>
                      <Input
                        id="pract-credentials"
                        value={practCredentials}
                        onChange={(e) => setPractCredentials(e.target.value)}
                        placeholder="e.g. RN, B.Sc. Nursing"
                        className="rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleSavePractitioner} disabled={isSavingPract} className="gap-1.5 min-w-[110px]">
                      {isSavingPract ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Save Details
                    </Button>
                  </div>
                </div>
              )}
            </PanelCard>

            {/* Avatar picker card */}
            <PanelCard label="Profile Avatar">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <AvatarDisplay
                      avatarId={avatarId}
                      sizePx={56}
                      fallback={
                        <div className="h-14 w-14 rounded-full flex items-center justify-center border-2 border-dashed"
                          style={{ background: "rgba(55,48,163,0.06)", borderColor: "rgba(55,48,163,0.2)", color: "rgba(55,48,163,0.3)" }}>
                          <User className="h-6 w-6" />
                        </div>
                      }
                    />
                    <div>
                      <p className="text-[14px] font-medium" style={{ color: "#1C1626" }}>
                        {avatarId ? "Avatar selected" : "No avatar chosen"}
                      </p>
                      <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: "#7A6A8A" }}>
                        Choose a character below. It appears in your sidebar instead of your initials. Saves automatically.
                      </p>
                    </div>
                  </div>
                  <AvatarPicker value={avatarId} onChange={handleAvatarChange} />
                </div>
              )}
            </PanelCard>
          </Section>
        )}

        {/* ── Provider section ─────────────────────────────────────────────── */}
        {activeSection === "provider" && (
          <Section
            title="Provider"
            description="Your registered NDIS provider business details. These appear on PDF audit reports and invoices."
            icon={Building2}
          >
            <PanelCard label="Business Information">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="business-name" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>Business Name</Label>
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
                      ABN <span className="font-normal" style={{ color: "#7A6A8A" }}>(Australian Business Number)</span>
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
                      <p className="text-[11px]" style={{ color: "#7A6A8A" }}>{11 - abnDigits.length} more digit{11 - abnDigits.length !== 1 ? "s" : ""} needed</p>
                    )}
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button size="sm" onClick={handleSaveProvider} disabled={isSavingProvider || abnError} className="gap-1.5 min-w-[130px]">
                      {isSavingProvider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Save Provider Info
                    </Button>
                  </div>
                </div>
              )}
            </PanelCard>
          </Section>
        )}

        {/* ── Session Defaults section ─────────────────────────────────────── */}
        {activeSection === "defaults" && (
          <Section
            title="Session Defaults"
            description="Default settings applied automatically when you start a new live session."
            icon={Settings2}
          >
            <PanelCard label="Duration">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="default-duration" className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>
                    Default Duration <span className="font-normal" style={{ color: "#7A6A8A" }}>(minutes)</span>
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
                  <p className="text-[12px]" style={{ color: "#7A6A8A" }}>Used as the planned duration when creating sessions</p>
                </div>
              )}
            </PanelCard>

            <PanelCard label="Automation">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
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

            {!isLoadingSettings && (
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSaveDefaults} disabled={isSavingDefaults} className="gap-1.5 min-w-[120px]">
                  {isSavingDefaults ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Defaults
                </Button>
              </div>
            )}
          </Section>
        )}

        {/* ── Compliance section ───────────────────────────────────────────── */}
        {activeSection === "compliance" && (
          <Section
            title="Compliance"
            description="Enforce documentation standards before a session can be approved. These checks run alongside the built-in NDIS compliance engine."
            icon={ShieldCheck}
          >
            <PanelCard label="Required Before Approval">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
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

            <PanelCard label="Session Types Requiring Physical Examination">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <p className="text-[12px] leading-relaxed" style={{ color: "var(--cc-text)" }}>
                    When a session's type matches one of the names below, the compliance engine will warn if no body examination markers have been recorded.
                    Names are matched case-insensitively. This list <strong>replaces</strong> the built-in defaults — leave it empty to keep using the built-in set (physiotherapy, OT, therapy, rehab, etc.).
                  </p>

                  {/* Current list */}
                  {physicalExamSessionTypes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {physicalExamSessionTypes.map((type, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-full text-[12px] font-medium px-2.5 py-1"
                          style={{ background: "rgba(55,48,163,0.08)", color: "#3730A3", border: "1px solid rgba(55,48,163,0.2)" }}
                        >
                          {type}
                          <button
                            type="button"
                            onClick={() => handleRemoveSessionType(i)}
                            className="ml-0.5 hover:text-red-500 transition-colors" style={{ color: "rgba(55,48,163,0.5)" }}
                            aria-label={`Remove ${type}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[12px] rounded-xl px-3 py-2.5 border border-dashed"
                      style={{ color: "#7A6A8A", background: "rgba(246,244,251,0.8)", borderColor: "rgba(232,213,232,0.7)" }}>
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span>No custom types saved — the built-in defaults (physiotherapy, OT, therapy, rehab…) are used.</span>
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
                  <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: "rgba(232,213,232,0.5)" }}>
                    <p className="text-[12px]" style={{ color: "#7A6A8A" }}>
                      Reset to restore the standard built-in list
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[12px] gap-1 hover:text-[#1C1626]"
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
              <>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSaveCompliance} disabled={isSavingCompliance} className="gap-1.5 min-w-[140px]">
                    {isSavingCompliance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save Requirements
                  </Button>
                </div>

                <div
                  className="rounded-2xl p-4 text-[12px] leading-relaxed space-y-2"
                  style={{
                    background: "rgba(55,48,163,0.04)",
                    border: "1px solid rgba(55,48,163,0.12)",
                    borderLeft: "3px solid #3730A3",
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
              </>
            )}
          </Section>
        )}

        {/* ── Notifications section (coordinator only) ─────────────────────── */}
        {activeSection === "notifications" && isCoordinator && (
          <NotificationsSection />
        )}

        {activeSection === "team" && isCoordinator && (
          <Section
            title="Team"
            description="Manage your organisation's staff members and invite new practitioners."
            icon={Users2}
          >
            {/* Active members */}
            <PanelCard label="Active Members">
              {loadingTeam ? (
                <div className="flex items-center gap-2 text-[13px] py-4" style={{ color: "#7A6A8A" }}>
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
                </div>
              ) : members.length === 0 ? (
                <p className="text-[13px] py-4 text-center" style={{ color: "#7A6A8A" }}>
                  No members found. Invite your first staff member below.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
                  {members.map((m) => {
                    const rc = ROLE_COLORS[m.role] ?? ROLE_COLORS.support_worker;
                    return (
                      <div key={m.id} className="flex items-center gap-3 py-3">
                        {/* Avatar */}
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                          style={{ background: "rgba(55,48,163,0.08)", color: "#3730A3" }}
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
                            value={m.role}
                            onChange={(e) => handleChangeRole(m.id, e.target.value)}
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer shrink-0"
                            style={{ background: rc.bg, color: rc.color }}
                          >
                            <option value="support_worker">Support Worker</option>
                            <option value="support_coordinator">Support Coordinator</option>
                            <option value="allied_health">Allied Health</option>
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
                          Joined {m.joined_at ? new Date(m.joined_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        </span>

                        {/* Remove — prevent removing self */}
                        {m.user_id !== user?.id && (
                          <button
                            onClick={() => handleRemoveMember(m.id, m.full_name)}
                            title="Remove member"
                            className="p-1.5 rounded-lg transition-colors hover:bg-red-50 shrink-0"
                            style={{ color: "#94a3b8" }}
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
            <PanelCard label="Pending Invitations">
              {invites.length === 0 ? (
                <p className="text-[13px] py-3 text-center" style={{ color: "#7A6A8A" }}>
                  No pending invitations.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.4)" }}>
                  {invites.map((inv) => {
                    const rc = ROLE_COLORS[inv.role] ?? ROLE_COLORS.support_worker;
                    const expires = new Date(inv.expires_at);
                    const expired = expires < new Date();
                    return (
                      <div key={inv.id} className="flex items-center gap-3 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: "var(--cc-text)" }}>{inv.email}</p>
                          <p className="text-[11px]" style={{ color: expired ? "#dc2626" : "#6B7280" }}>
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
                          className="p-1.5 rounded-lg transition-colors hover:bg-[#F0EDF9] shrink-0"
                          style={{ color: copiedToken === inv.id ? "#22c55e" : "#6B7280" }}
                        >
                          {copiedToken === inv.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>

                        {/* Revoke */}
                        <button
                          onClick={() => handleRevokeInvite(inv.id)}
                          title="Revoke invitation"
                          className="p-1.5 rounded-lg transition-colors hover:bg-red-50 shrink-0"
                          style={{ color: "#94a3b8" }}
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
                <Plus size={15} /> Invite Staff Member
              </Link>
            </div>

            {/* Explainer */}
            <div
              className="rounded-2xl p-4 text-[12px] leading-relaxed space-y-2"
              style={{
                background: "rgba(55,48,163,0.04)",
                border: "1px solid rgba(55,48,163,0.12)",
                borderLeft: "3px solid #3730A3",
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
                Email delivery is not yet configured — copy and share the link manually. Pending invitations
                can be revoked at any time before they are accepted.
              </p>
            </div>
          </Section>
        )}

      </main>

      </div>{/* end flex gap-6 */}

    </div>
  );
}
