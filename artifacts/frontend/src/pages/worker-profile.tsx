import { useEffect, useMemo, useState } from "react";
import { Loader2, LockKeyhole, Pencil, Save, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { useToast } from "@/hooks/use-toast";
import {
  getDesktopNotificationPermission,
  getDesktopNotificationSupport,
  isDesktopNotificationsEnabled,
  requestDesktopNotificationPermission,
  setDesktopNotificationsEnabled,
} from "@/lib/desktop-notifications";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useReAuth } from "@/hooks/useReAuth";
import { getDeviceId } from "@/lib/device-id";
import {
  passwordStrengthScore,
  validatePasswordPolicy,
} from "@/lib/password-strength";
import {
  changePassword,
  getMe,
  getNotificationPreferences,
  saveNotificationPreferences,
  updateContact,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPreferences,
  type PreferredContactMethod,
  type UserProfile,
} from "@/services/userService";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "var(--cc-border)";

const ROLE_KEYS: Record<string, string> = {
  support_worker: "profile.role.supportWorker",
  support_coordinator: "profile.role.coordinator",
};

const EVENTS: NotificationEvent[] = [
  "shift_reminder",
  "shift_change",
  "coordinator_message",
  "feedback_received",
  "certification_expiry",
];
const CHANNELS: NotificationChannel[] = ["push", "email", "sms"];
const CONTACT_METHODS: PreferredContactMethod[] = ["phone_call", "sms", "in_app_message"];

const PASSWORD_POLICY_KEYS: Record<string, string> = {
  "Password must be at least 10 characters.": "profile.passwordPolicy.tooShort",
  "Password must include at least one uppercase letter.": "profile.passwordPolicy.uppercase",
  "Password must include at least one number.": "profile.passwordPolicy.number",
  "This password is too common. Choose a stronger password.": "profile.passwordPolicy.common",
};

function ReadOnlyField({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value?: string | null;
  emptyLabel: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-cc-muted">{label}</p>
      <p className="mt-1 text-[15px] font-semibold text-cc-text">{value || emptyLabel}</p>
    </div>
  );
}

export default function WorkerProfile() {
  const { updateUser } = useAuth();
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const { requireReAuth, modal } = useReAuth();
  const deviceId = useMemo(() => getDeviceId(), []);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftPreferredContact, setDraftPreferredContact] = useState<PreferredContactMethod>("in_app_message");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [desktopPermission, setDesktopPermission] = useState(() => getDesktopNotificationPermission());
  const [desktopEnabled, setDesktopEnabled] = useState(() => isDesktopNotificationsEnabled());

  function roleLabel(role?: string | null) {
    if (!role) return "";
    const key = ROLE_KEYS[role];
    return key ? translate(key) : role;
  }

  function contactLabel(method: PreferredContactMethod) {
    return translate(`profile.contact.${method}`);
  }

  function eventLabel(event: NotificationEvent) {
    return translate(`profile.notification.event.${event}`);
  }

  function channelLabel(channel: NotificationChannel) {
    return translate(`profile.notification.channel.${channel}`);
  }

  function strengthLabel(score: number) {
    if (score <= 1) return translate("profile.strength.weak");
    if (score === 2) return translate("profile.strength.fair");
    if (score === 3) return translate("profile.strength.good");
    return translate("profile.strength.strong");
  }

  async function handleEnableDesktopNotifications() {
    const result = await requestDesktopNotificationPermission();
    setDesktopPermission(result);
    setDesktopEnabled(result === "granted");
    if (result === "granted") {
      toast({ title: translate("profile.desktopEnabled") });
    } else if (result === "denied") {
      toast({
        title: translate("profile.desktopBlocked"),
        description: translate("profile.desktopBlockedHint"),
        variant: "destructive",
      });
    }
  }

  function handleDisableDesktopNotifications() {
    setDesktopNotificationsEnabled(false);
    setDesktopEnabled(false);
    toast({ title: translate("profile.desktopDisabled") });
  }

  useEffect(() => {
    let active = true;
    Promise.all([getMe(), getNotificationPreferences(deviceId)])
      .then(([me, prefs]) => {
        if (!active) return;
        setProfile(me);
        setDraftEmail(me.email || "");
        setDraftPhone(me.phone || "");
        setDraftPreferredContact(me.preferred_contact_method || "in_app_message");
        setNotificationPrefs(prefs.preferences);
      })
      .catch((error) => {
        if (!active) return;
        toast({
          title: translate("profile.loadFailed"),
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
  }, [deviceId, toast, translate]);

  const strength = passwordStrengthScore(newPassword);

  async function handleSaveContact() {
    if (!profile) return;
    setSavingContact(true);
    try {
      const result = await requireReAuth(() =>
        updateContact({
          email: draftEmail.trim() !== profile.email ? draftEmail.trim() : undefined,
          phone: draftPhone.trim() !== (profile.phone || "") ? draftPhone.trim() : undefined,
          preferred_contact_method: draftPreferredContact,
        }),
      );
      if (!result) return;
      setProfile(result.profile);
      updateUser({
        full_name: result.profile.full_name,
        profile_photo_url: result.profile.profile_photo_url,
      });
      setEditMode(false);
      toast({ title: translate("profile.updated"), description: result.message });
    } catch (error) {
      toast({
        title: translate("profile.saveFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setSavingContact(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      const key = PASSWORD_POLICY_KEYS[policyError];
      toast({
        title: translate("profile.passwordPolicy"),
        description: key ? translate(key) : policyError,
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: translate("profile.passwordsNoMatch"), variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      const result = await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: translate("profile.passwordUpdated"), description: result.message });
    } catch (error) {
      toast({
        title: translate("profile.passwordChangeFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  }

  async function persistNotificationPrefs(next: NotificationPreferences) {
    setNotificationPrefs(next);
    setSavingPrefs(true);
    try {
      await saveNotificationPreferences(deviceId, next);
    } catch (error) {
      toast({
        title: translate("profile.notificationSaveFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setSavingPrefs(false);
    }
  }

  function toggleNotification(event: NotificationEvent, channel: NotificationChannel, checked: boolean) {
    if (!notificationPrefs) return;
    const next = {
      ...notificationPrefs,
      [event]: {
        ...notificationPrefs[event],
        [channel]: checked,
      },
    };
    void persistNotificationPrefs(next);
  }

  if (loading || !profile) {
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="hidden" style={{ color: CORAL }}>
            {translate("profile.account")}
          </p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
            {translate("profile.title")}
          </h1>
          <p className="mt-2 text-sm text-[#6A6A77]">
            {translate("profile.subtitle")}
          </p>
        </div>
        {!editMode ? (
          <Button
            type="button"
            onClick={() => setEditMode(true)}
            className="rounded-xl gap-2"
            style={{ background: "var(--cc-cta)" }}
          >
            <Pencil className="h-4 w-4" />
            {translate("profile.edit")}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditMode(false);
                setDraftEmail(profile.email || "");
                setDraftPhone(profile.phone || "");
                setDraftPreferredContact(profile.preferred_contact_method || "in_app_message");
              }}
              className="rounded-xl gap-2"
            >
              <X className="h-4 w-4" />
              {translate("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveContact()}
              disabled={savingContact}
              className="rounded-xl gap-2"
              style={{ background: CORAL }}
            >
              {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {translate("profile.saveChanges")}
            </Button>
          </div>
        )}
      </div>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F4EDE6]">
            <UserRound className="h-5 w-5 text-[#E8457A]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("profile.details")}</h2>
            <p className="text-sm text-[#6A6A77]">{translate("profile.detailsHint")}</p>
          </div>
        </div>

        <div className="mb-6 rounded-2xl bg-cc-soft p-4">
          <ProfilePhotoUpload currentUrl={profile.profile_photo_url} cropCircle />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <ReadOnlyField
            label={translate("profile.fullName")}
            value={profile.full_name}
            emptyLabel={translate("common.emDash")}
          />
          <ReadOnlyField
            label={translate("profile.role")}
            value={roleLabel(profile.membership_role || profile.role)}
            emptyLabel={translate("common.emDash")}
          />
          <ReadOnlyField
            label={translate("profile.employeeId")}
            value={profile.employee_id}
            emptyLabel={translate("common.emDash")}
          />

          {editMode ? (
            <>
              <div>
                <Label htmlFor="profile-email">{translate("profile.email")}</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  className="mt-1 rounded-xl"
                />
                {profile.pending_email ? (
                  <p className="mt-1 text-xs text-[#6A6A77]">
                    {translateParams("profile.pendingVerification", { email: profile.pending_email })}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="profile-phone">{translate("profile.mobile")}</Label>
                <Input
                  id="profile-phone"
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="preferred-contact">{translate("profile.preferredContact")}</Label>
                <select
                  id="preferred-contact"
                  title={translate("profile.preferredContact")}
                  value={draftPreferredContact}
                  onChange={(e) => setDraftPreferredContact(e.target.value as PreferredContactMethod)}
                  className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm"
                  style={{ borderColor: BORDER }}
                >
                  {CONTACT_METHODS.map((value) => (
                    <option key={value} value={value}>{contactLabel(value)}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[#6A6A77]">
                  {translate("profile.preferredContactHint")}
                </p>
              </div>
              <p className="md:col-span-2 text-xs text-[#6A6A77]">
                {translate("profile.saveContactHint")}
              </p>
            </>
          ) : (
            <>
              <ReadOnlyField
                label={translate("profile.email")}
                value={profile.email}
                emptyLabel={translate("common.emDash")}
              />
              <ReadOnlyField
                label={translate("profile.mobile")}
                value={profile.phone}
                emptyLabel={translate("common.emDash")}
              />
              <ReadOnlyField
                label={translate("profile.preferredContact")}
                value={
                  profile.preferred_contact_method
                    ? contactLabel(profile.preferred_contact_method)
                    : translate("profile.inAppMessage")
                }
                emptyLabel={translate("common.emDash")}
              />
            </>
          )}
        </div>
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F4EDE6]">
            <LockKeyhole className="h-5 w-5 text-[#E8457A]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("profile.changePassword")}</h2>
            <p className="text-sm text-[#6A6A77]">{translate("profile.passwordPolicyHint")}</p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="current-password">{translate("profile.currentPassword")}</Label>
            <PasswordInput
              id="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 rounded-xl"
              autoComplete="current-password"
            />
          </div>
          <div>
            <Label htmlFor="new-password">{translate("profile.newPassword")}</Label>
            <PasswordInput
              id="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 rounded-xl"
              autoComplete="new-password"
            />
            {newPassword ? (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((index) => (
                    <div
                      key={index}
                      className="h-1.5 flex-1 rounded-full"
                      style={{ background: index < strength ? "var(--cc-text)" : "#E8E8EA" }}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs font-medium text-[#6A6A77]">
                  {translate("profile.strength")} {strengthLabel(strength)}
                </p>
              </div>
            ) : null}
          </div>
          <div>
            <Label htmlFor="confirm-password">{translate("profile.confirmPassword")}</Label>
            <PasswordInput
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 rounded-xl"
              autoComplete="new-password"
            />
          </div>
          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="rounded-xl"
              style={{ background: "var(--cc-cta)" }}
            >
              {changingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("profile.updatePassword")}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-5">
          <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("profile.desktopNotifications")}</h2>
          <p className="text-sm text-[#6A6A77]">
            {translate("profile.desktopHint")}
          </p>
        </div>
        {!getDesktopNotificationSupport() ? (
          <p className="text-sm text-[#6A6A77]">{translate("profile.desktopNotSupported")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-[#1A1A2E]">
              {desktopPermission === "granted" && desktopEnabled
                ? translate("profile.desktopStatusEnabled")
                : desktopPermission === "denied"
                  ? translate("profile.desktopStatusBlocked")
                  : translate("profile.desktopStatusNotEnabled")}
            </p>
            {desktopPermission !== "granted" || !desktopEnabled ? (
              <Button
                type="button"
                className="rounded-xl"
                style={{ background: "var(--cc-cta)" }}
                onClick={() => void handleEnableDesktopNotifications()}
              >
                {translate("profile.enableDesktop")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={handleDisableDesktopNotifications}
              >
                {translate("profile.disableDesktop")}
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-5">
          <h2 className="text-lg font-bold text-[#1A1A2E]">{translate("profile.notificationPrefs")}</h2>
          <p className="text-sm text-[#6A6A77]">
            {translate("profile.notificationPrefsHint")}
          </p>
        </div>

        {notificationPrefs ? (
          <div className="space-y-4">
            <div className="hidden md:grid md:grid-cols-[1.4fr_repeat(3,0.5fr)] gap-3 px-2 text-[11px] font-bold uppercase tracking-wider text-[#6A6A77]">
              <span>{translate("profile.event")}</span>
              {CHANNELS.map((channel) => (
                <span key={channel} className="text-center">{channelLabel(channel)}</span>
              ))}
            </div>
            {EVENTS.map((event) => (
              <div
                key={event}
                className="grid gap-3 rounded-2xl border px-4 py-3 md:grid-cols-[1.4fr_repeat(3,0.5fr)] md:items-center"
                style={{ borderColor: BORDER }}
              >
                <p className="text-sm font-semibold text-[#1A1A2E]">{eventLabel(event)}</p>
                {CHANNELS.map((channel) => (
                  <div key={channel} className="flex items-center justify-between md:justify-center gap-3">
                    <span className="text-xs text-[#6A6A77] md:hidden">{channelLabel(channel)}</span>
                    <Switch
                      checked={notificationPrefs[event][channel]}
                      disabled={savingPrefs}
                      onCheckedChange={(checked) => toggleNotification(event, channel, checked)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
