import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Copy,
  Loader2,
  LockKeyhole,
  MonitorSmartphone,
  Pencil,
  QrCode,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/PasswordInput";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
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


function formatWhen(value?: string | null) {
  if (!value) return "—";
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return value;
  }
}

export default function WorkerSecurity() {
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
      .catch((error) => {
        if (!active) return;
        toast({
          title: "Could not load security settings",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
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
      toast({
        title: "Could not start 2FA setup",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
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
      toast({
        title: "Two-factor authentication enabled",
        description: "Save your recovery codes in a secure place.",
      });
    } catch (error) {
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "Check the code and try again.",
        variant: "destructive",
      });
    } finally {
      setEnrollBusy(false);
    }
  }

  async function handleDisableMfa(event: React.FormEvent) {
    event.preventDefault();
    if (!disablePassword) return;
    setDisableBusy(true);
    try {
      await disableMfa(disablePassword);
      setDisablePassword("");
      setMfaStatus({ enabled: false, method: null, phone: null });
      setRecoveryCodes(null);
      toast({ title: "Two-factor authentication disabled" });
    } catch (error) {
      toast({
        title: "Could not disable 2FA",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDisableBusy(false);
    }
  }

  async function handleLogoutOthers(event: React.FormEvent) {
    event.preventDefault();
    if (!logoutOthersPassword) return;
    setLogoutOthersBusy(true);
    try {
      const result = await logoutOtherSessions(logoutOthersPassword);
      setLogoutOthersPassword("");
      await loadSecurityData();
      toast({
        title: "Other sessions signed out",
        description: `${result.revoked_sessions} session(s) were revoked.`,
      });
    } catch (error) {
      toast({
        title: "Could not sign out other devices",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLogoutOthersBusy(false);
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
    } catch {
      // requireReAuth handles cancellation
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
      toast({
        title: "Could not rename",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  function copyRecoveryCodes() {
    if (!recoveryCodes?.length) return;
    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toast({ title: "Recovery codes copied" });
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-cc-plum" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      {modal}

      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          Account
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
          Security settings
        </h1>
        <p className="mt-2 text-sm text-cc-muted">
          Manage two-factor authentication, trusted devices, active sessions, and sign-in history.
        </p>
      </div>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cc-bg">
            <ShieldCheck className="h-5 w-5 text-cc-plum" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-cc-text">Two-factor authentication</h2>
            <p className="text-sm text-cc-muted">
              {mfaStatus?.enabled
                ? "Authenticator app verification is active on your account."
                : "Add an extra layer of protection with an authenticator app."}
            </p>
          </div>
        </div>

        {recoveryCodes ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-900">Save these recovery codes</p>
            <p className="mt-1 text-sm text-amber-800">
              Each code can be used once if you lose access to your authenticator app.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm text-cc-text sm:grid-cols-4">
              {recoveryCodes.map((code) => (
                <div key={code} className="rounded-lg bg-cc-surface px-3 py-2 text-center">
                  {code}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={copyRecoveryCodes} className="mt-4 rounded-xl gap-2">
              <Copy className="h-4 w-4" />
              Copy codes
            </Button>
          </div>
        ) : null}

        {!mfaStatus?.enabled ? (
          enrolling && enrollSecret ? (
            <form onSubmit={handleVerifyEnrollment} className="space-y-4">
              <div className="rounded-2xl bg-cc-bg p-4">
                <p className="text-sm font-semibold text-cc-text">Set up your authenticator app</p>
                <p className="mt-1 text-sm text-cc-muted">
                  Scan the QR code or add a manual entry in Google Authenticator, Authy, or 1Password.
                </p>
                <div className="mt-3 flex items-stretch gap-2">
                  <code className="flex-1 break-all rounded-xl bg-cc-surface px-4 py-3 text-sm font-semibold text-cc-plum">
                    {enrollSecret}
                  </code>
                  <button
                    type="button"
                    onClick={() => setQrOpen(true)}
                    aria-label="Show QR code for authenticator app"
                    title="Show QR code"
                    className="flex min-w-[52px] items-center justify-center rounded-xl border bg-cc-surface px-3 transition-colors hover:bg-[#EDEAFF]"
                    style={{ borderColor: BORDER }}
                  >
                    <QrCode className="h-5 w-5 text-cc-plum" />
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="totp-code">Enter the 6-digit code</Label>
                <Input
                  id="totp-code"
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="mt-1 rounded-xl tracking-widest"
                  placeholder="000000"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEnrolling(false);
                    setEnrollSecret(null);
                    setEnrollOtpAuthUrl(null);
                    setQrOpen(false);
                    setEnrollCode("");
                  }}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={enrollBusy || !enrollCode.trim()}
                  className="rounded-xl"
                  style={{ background: PLUM }}
                >
                  {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify and enable"}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              onClick={() => void handleStartEnrollment()}
              disabled={enrollBusy}
              className="rounded-xl gap-2"
              style={{ background: PLUM }}
            >
              {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Enable authenticator app
            </Button>
          )
        ) : (
          <form onSubmit={handleDisableMfa} className="max-w-md space-y-3">
            <p className="text-sm text-cc-muted">
              To turn off two-factor authentication, confirm your current password.
            </p>
            <div>
              <Label htmlFor="disable-mfa-password">Current password</Label>
              <PasswordInput
                id="disable-mfa-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="mt-1 rounded-xl"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={disableBusy || !disablePassword}
              className="rounded-xl border-red-200 text-red-700 hover:bg-red-50"
            >
              {disableBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disable two-factor authentication"}
            </Button>
          </form>
        )}
      </section>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cc-bg">
            <MonitorSmartphone className="h-5 w-5 text-cc-plum" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-cc-text">Trusted devices</h2>
            <p className="text-sm text-cc-muted">Devices that can skip 2FA for 30 days.</p>
          </div>
        </div>

        {trustedDevices.length === 0 ? (
          <p className="text-sm text-cc-muted">No trusted devices yet.</p>
        ) : (
          <div className="space-y-3">
            {trustedDevices.map((device) => (
              <div
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                style={{ borderColor: BORDER }}
              >
                <div>
                  <p className="font-semibold text-cc-text">
                    {device.device_name}
                    {device.is_current ? (
                      <span className="ml-2 rounded-full bg-[#EDEAFF] px-2 py-0.5 text-[11px] font-bold text-cc-plum">
                        This device
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-cc-muted">
                    {device.os_name} · trusted until {formatWhen(device.trusted_until)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => {
                      setRenamingId(device.id);
                      setRenameKind("device");
                      setRenameValue(device.device_name);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-xl border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => void handleRevokeDevice(device.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cc-bg">
            <LockKeyhole className="h-5 w-5 text-cc-plum" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-cc-text">Active sessions</h2>
            <p className="text-sm text-cc-muted">Devices currently signed in to your account.</p>
          </div>
        </div>

        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3"
              style={{ borderColor: BORDER }}
            >
              <div>
                <p className="font-semibold text-cc-text">
                  {session.device_name}
                  {session.is_current ? (
                    <span className="ml-2 rounded-full bg-[#EDEAFF] px-2 py-0.5 text-[11px] font-bold text-cc-plum">
                      Current session
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-cc-muted">
                  {session.city || "Unknown city"}, {session.country || "Unknown"} · active {formatWhen(session.last_active_at)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  setRenamingId(session.id);
                  setRenameKind("session");
                  setRenameValue(session.device_name);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <form onSubmit={handleLogoutOthers} className="mt-6 max-w-md space-y-3 border-t pt-6" style={{ borderColor: BORDER }}>
          <p className="text-sm font-semibold text-cc-text">Sign out all other devices</p>
          <div>
            <Label htmlFor="logout-others-password">Confirm your password</Label>
            <PasswordInput
              id="logout-others-password"
              value={logoutOthersPassword}
              onChange={(e) => setLogoutOthersPassword(e.target.value)}
              className="mt-1 rounded-xl"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={logoutOthersBusy || !logoutOthersPassword}
            className="rounded-xl"
          >
            {logoutOthersBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign out other sessions"}
          </Button>
        </form>
      </section>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cc-bg">
            <AlertTriangle className="h-5 w-5 text-cc-plum" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-cc-text">Recent sign-ins</h2>
            <p className="text-sm text-cc-muted">Review recent account access activity.</p>
          </div>
        </div>

        {loginHistory.length === 0 ? (
          <p className="text-sm text-cc-muted">No sign-in history yet.</p>
        ) : (
          <div className="space-y-3">
            {loginHistory.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl border px-4 py-3"
                style={{ borderColor: entry.is_suspicious ? "rgba(240,48,96,0.35)" : BORDER }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-cc-text">{entry.device_name}</p>
                  {entry.is_suspicious ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                      Unusual sign-in
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-cc-muted">
                  {entry.location_label} · {formatWhen(entry.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm rounded-[1.5rem] border-0 p-6">
          <DialogHeader>
            <DialogTitle className="text-cc-text">Scan QR code</DialogTitle>
            <DialogDescription className="text-cc-muted">
              Open your authenticator app and scan this code to add CareCliQ.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center rounded-2xl bg-cc-surface p-5 ring-1 ring-[#E2DEF2]">
            {enrollOtpAuthUrl ? (
              <QRCode value={enrollOtpAuthUrl} size={220} bgColor="#FFFFFF" fgColor="#1E1640" />
            ) : null}
          </div>
          <p className="text-center text-xs text-cc-muted">
            Or enter the secret key manually if scanning is not available.
          </p>
        </DialogContent>
      </Dialog>

      {renamingId && renameKind ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-cc-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-cc-text">Rename device</h3>
              <button type="button" onClick={() => setRenamingId(null)} aria-label="Close">
                <X className="h-5 w-5 text-cc-muted" />
              </button>
            </div>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="rounded-xl"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenamingId(null)} className="rounded-xl">
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitRename()} className="rounded-xl" style={{ background: PLUM }}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
