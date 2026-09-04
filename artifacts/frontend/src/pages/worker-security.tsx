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
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useReAuth } from "@/hooks/useReAuth";
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

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "var(--cc-border)";

export default function WorkerSecurity() {
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
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

  function formatWhen(value?: string | null) {
    if (!value) return translate("common.emDash");
    try {
      return formatDistanceToNow(new Date(value), { addSuffix: true });
    } catch {
      return value;
    }
  }

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
          title: translate("security.loadFailed"),
          description: error instanceof Error ? error.message : translate("toast.tryAgain"),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadSecurityData, toast, translate]);

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
        title: translate("security.start2faFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
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
        title: translate("security.twoFactorEnabled"),
        description: translate("security.twoFactorEnabledHint"),
      });
    } catch (error) {
      toast({
        title: translate("security.verifyFailed"),
        description: error instanceof Error ? error.message : translate("security.verifyFailedHint"),
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
      toast({ title: translate("security.twoFactorDisabled") });
    } catch (error) {
      toast({
        title: translate("security.disable2faFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
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
        title: translate("security.signOutOthersSuccess"),
        description: translateParams("security.signOutOthersSuccessDesc", {
          count: String(result.revoked_sessions),
        }),
      });
    } catch (error) {
      toast({
        title: translate("security.signOutOthersFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
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
      toast({ title: translate("security.deviceRemoved") });
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
      toast({ title: translate("security.nameUpdated") });
    } catch (error) {
      toast({
        title: translate("security.renameFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    }
  }

  function copyRecoveryCodes() {
    if (!recoveryCodes?.length) return;
    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toast({ title: translate("security.codesCopied") });
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#E8457A]" />
        <span className="sr-only">{translate("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {modal}

      <div>
        <p className="hidden" style={{ color: CORAL }}>
          {translate("profile.account")}
        </p>
        <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
          {translate("security.title")}
        </h1>
        <p className="mt-2 text-sm text-[#6A6A77]">
          {translate("security.subtitle")}
        </p>
      </div>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ECECEC]">
            <ShieldCheck className="h-5 w-5 text-[#E8457A]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("security.twoFactor")}</h2>
            <p className="text-sm text-[#6A6A77]">
              {mfaStatus?.enabled
                ? translate("security.twoFactorActive")
                : translate("security.twoFactorInactive")}
            </p>
          </div>
        </div>

        {recoveryCodes ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-900">{translate("security.recoveryCodes")}</p>
            <p className="mt-1 text-sm text-amber-800">
              {translate("security.recoveryCodesHint")}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm text-[#1A1A2E] sm:grid-cols-4">
              {recoveryCodes.map((code) => (
                <div key={code} className="rounded-lg bg-white px-3 py-2 text-center">
                  {code}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={copyRecoveryCodes} className="mt-4 rounded-xl gap-2">
              <Copy className="h-4 w-4" />
              {translate("security.copyCodes")}
            </Button>
          </div>
        ) : null}

        {!mfaStatus?.enabled ? (
          enrolling && enrollSecret ? (
            <form onSubmit={handleVerifyEnrollment} className="space-y-4">
              <div className="rounded-2xl bg-[#ECECEC] p-4">
                <p className="text-sm font-semibold text-[#1A1A2E]">{translate("security.setupAuthenticator")}</p>
                <p className="mt-1 text-sm text-[#6A6A77]">
                  {translate("security.setupAuthenticatorHint")}
                </p>
                <div className="mt-3 flex items-stretch gap-2">
                  <code className="flex-1 break-all rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#E8457A]">
                    {enrollSecret}
                  </code>
                  <button
                    type="button"
                    onClick={() => setQrOpen(true)}
                    aria-label={translate("security.showQrAria")}
                    title={translate("security.showQrTitle")}
                    className="flex min-w-[52px] items-center justify-center rounded-xl border bg-white px-3 transition-colors hover:bg-[#F2EBFD]"
                    style={{ borderColor: BORDER }}
                  >
                    <QrCode className="h-5 w-5 text-[#E8457A]" />
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="totp-code">{translate("security.totpCode")}</Label>
                <Input
                  id="totp-code"
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="mt-1 rounded-xl tracking-widest"
                  placeholder={translate("security.totpPlaceholder")}
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
                  {translate("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={enrollBusy || !enrollCode.trim()}
                  className="rounded-xl"
                  style={{ background: "var(--cc-cta)" }}
                >
                  {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("security.verifyEnable")}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              onClick={() => void handleStartEnrollment()}
              disabled={enrollBusy}
              className="rounded-xl gap-2"
              style={{ background: "var(--cc-cta)" }}
            >
              {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              {translate("security.enableAuthenticator")}
            </Button>
          )
        ) : (
          <form onSubmit={handleDisableMfa} className="max-w-md space-y-3">
            <p className="text-sm text-[#6A6A77]">
              {translate("security.disableTwoFactorHint")}
            </p>
            <div>
              <Label htmlFor="disable-mfa-password">{translate("profile.currentPassword")}</Label>
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
              {disableBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("security.disableTwoFactor")}
            </Button>
          </form>
        )}
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ECECEC]">
            <MonitorSmartphone className="h-5 w-5 text-[#E8457A]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("security.trustedDevices")}</h2>
            <p className="text-sm text-[#6A6A77]">{translate("security.trustedDevicesHint")}</p>
          </div>
        </div>

        {trustedDevices.length === 0 ? (
          <p className="text-sm text-[#6A6A77]">{translate("security.noTrustedDevices")}</p>
        ) : (
          <div className="space-y-3">
            {trustedDevices.map((device) => (
              <div
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                style={{ borderColor: BORDER }}
              >
                <div>
                  <p className="font-semibold text-[#1A1A2E]">
                    {device.device_name}
                    {device.is_current ? (
                      <span className="ml-2 rounded-full bg-[#F2EBFD] px-2 py-0.5 text-[11px] font-bold text-[#E8457A]">
                        {translate("security.thisDevice")}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-[#6A6A77]">
                    {translateParams("security.trustedUntil", {
                      os: device.os_name,
                      when: formatWhen(device.trusted_until),
                    })}
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

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ECECEC]">
            <LockKeyhole className="h-5 w-5 text-[#E8457A]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("security.activeSessions")}</h2>
            <p className="text-sm text-[#6A6A77]">{translate("security.sessionsHint")}</p>
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
                <p className="font-semibold text-[#1A1A2E]">
                  {session.device_name}
                  {session.is_current ? (
                    <span className="ml-2 rounded-full bg-[#F2EBFD] px-2 py-0.5 text-[11px] font-bold text-[#E8457A]">
                      {translate("security.currentSession")}
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-[#6A6A77]">
                  {translateParams("security.sessionLocation", {
                    city: session.city || translate("security.unknownCity"),
                    country: session.country || translate("security.unknownCountry"),
                    when: formatWhen(session.last_active_at),
                  })}
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
          <p className="text-sm font-semibold text-[#1A1A2E]">{translate("security.signOutAllOthers")}</p>
          <div>
            <Label htmlFor="logout-others-password">{translate("security.confirmPassword")}</Label>
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
            {logoutOthersBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("security.signOutOthers")}
          </Button>
        </form>
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ECECEC]">
            <AlertTriangle className="h-5 w-5 text-[#E8457A]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("security.recentSignIns")}</h2>
            <p className="text-sm text-[#6A6A77]">{translate("security.recentSignInsHint")}</p>
          </div>
        </div>

        {loginHistory.length === 0 ? (
          <p className="text-sm text-[#6A6A77]">{translate("security.noSignInHistory")}</p>
        ) : (
          <div className="space-y-3">
            {loginHistory.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl border px-4 py-3"
                style={{ borderColor: entry.is_suspicious ? "rgba(190,24,93,0.35)" : BORDER }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#1A1A2E]">{entry.device_name}</p>
                  {entry.is_suspicious ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                      {translate("security.unusualSignIn")}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-[#6A6A77]">
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
            <DialogTitle className="text-[#1A1A2E]">{translate("security.scanQr")}</DialogTitle>
            <DialogDescription className="text-[#6A6A77]">
              {translate("security.qrDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center rounded-2xl bg-white p-5 ring-1 ring-[#E8E8EA]">
            {enrollOtpAuthUrl ? (
              <QRCode value={enrollOtpAuthUrl} size={220} bgColor="#FFFFFF" fgColor="#1A1A2E" />
            ) : null}
          </div>
          <p className="text-center text-xs text-[#6A6A77]">
            {translate("security.qrManualHint")}
          </p>
        </DialogContent>
      </Dialog>

      {renamingId && renameKind ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#1A1A2E]">{translate("security.renameDevice")}</h3>
              <button type="button" onClick={() => setRenamingId(null)} aria-label={translate("common.close")}>
                <X className="h-5 w-5 text-[#6A6A77]" />
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
                {translate("common.cancel")}
              </Button>
              <Button type="button" onClick={() => void submitRename()} className="rounded-xl" style={{ background: "var(--cc-cta)" }}>
                {translate("common.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
