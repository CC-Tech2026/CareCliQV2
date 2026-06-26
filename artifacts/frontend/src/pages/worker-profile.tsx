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
import { useReAuth } from "@/hooks/useReAuth";
import { getDeviceId } from "@/lib/device-id";
import {
  passwordStrengthLabel,
  passwordStrengthScore,
  validatePasswordPolicy,
} from "@/lib/password-strength";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import {
  changePassword,
  getMe,
  getNotificationPreferences,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_EVENT_LABELS,
  PREFERRED_CONTACT_LABELS,
  saveNotificationPreferences,
  updateContact,
  updateMe,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPreferences,
  type PreferredContactMethod,
  type UserProfile,
} from "@/services/userService";


const ROLE_LABELS: Record<string, string> = {
  support_worker: "Support Worker",
  allied_health: "Allied Health Professional",
  support_coordinator: "Support Coordinator",
};

const EVENTS = Object.keys(NOTIFICATION_EVENT_LABELS) as NotificationEvent[];
const CHANNELS = Object.keys(NOTIFICATION_CHANNEL_LABELS) as NotificationChannel[];

function ReadOnlyField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-cc-muted">{label}</p>
      <p className="mt-1 text-[15px] font-semibold text-cc-text">{value || "—"}</p>
    </div>
  );
}

export default function WorkerProfile() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const deviceId = useMemo(() => getDeviceId(), []);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [draftSuburb, setDraftSuburb] = useState("");
  const [draftPreferredContact, setDraftPreferredContact] = useState<PreferredContactMethod>("in_app_message");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [desktopPermission, setDesktopPermission] = useState(() => getDesktopNotificationPermission());
  const [desktopEnabled, setDesktopEnabled] = useState(() => isDesktopNotificationsEnabled());

  async function handleEnableDesktopNotifications() {
    const result = await requestDesktopNotificationPermission();
    setDesktopPermission(result);
    setDesktopEnabled(result === "granted");
    if (result === "granted") {
      toast({ title: "Desktop notifications enabled" });
    } else if (result === "denied") {
      toast({
        title: "Desktop notifications blocked",
        description: "Allow notifications in your browser site settings.",
        variant: "destructive",
      });
    }
  }

  function handleDisableDesktopNotifications() {
    setDesktopNotificationsEnabled(false);
    setDesktopEnabled(false);
    toast({ title: "Desktop notifications disabled on this device" });
  }

  useEffect(() => {
    let active = true;
    Promise.all([getMe(), getNotificationPreferences(deviceId)])
      .then(([me, prefs]) => {
        if (!active) return;
        setProfile(me);
        setDraftEmail(me.email || "");
        setDraftPhone(me.phone || "");
        setDraftAddress(me.address || "");
        setDraftSuburb(me.suburb || "");
        setDraftPreferredContact(me.preferred_contact_method || "in_app_message");
        setNotificationPrefs(prefs.preferences);
      })
      .catch((error) => {
        if (!active) return;
        toast({
          title: "Could not load profile",
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
  }, [deviceId, toast]);

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
      const addressChanged =
        draftAddress.trim() !== (profile.address || "") || draftSuburb.trim() !== (profile.suburb || "");
      let updatedProfile = result.profile;
      if (addressChanged) {
        updatedProfile = await updateMe({
          address: draftAddress.trim(),
          suburb: draftSuburb.trim(),
        });
      }
      setProfile(updatedProfile);
      updateUser({
        full_name: result.profile.full_name,
        profile_photo_url: result.profile.profile_photo_url,
      });
      setEditMode(false);
      toast({ title: "Profile updated", description: result.message });
    } catch (error) {
      toast({
        title: "Could not save profile",
        description: error instanceof Error ? error.message : "Please try again.",
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
      toast({ title: "Password policy", description: policyError, variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
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
      toast({ title: "Password updated", description: result.message });
    } catch (error) {
      toast({
        title: "Password change failed",
        description: error instanceof Error ? error.message : "Please try again.",
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
        title: "Could not save notification settings",
        description: error instanceof Error ? error.message : "Please try again.",
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
        <Loader2 className="h-7 w-7 animate-spin text-cc-plum" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      {modal}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            Account
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
            My profile
          </h1>
          <p className="mt-2 text-sm text-cc-muted">
            Manage your contact details, password, photo, and notification preferences.
          </p>
        </div>
        {!editMode ? (
          <Button
            type="button"
            onClick={() => setEditMode(true)}
            className="rounded-xl gap-2"
            style={{ background: PLUM }}
          >
            <Pencil className="h-4 w-4" />
            Edit profile
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
                setDraftAddress(profile.address || "");
                setDraftSuburb(profile.suburb || "");
                setDraftPreferredContact(profile.preferred_contact_method || "in_app_message");
              }}
              className="rounded-xl gap-2"
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveContact()}
              disabled={savingContact}
              className="rounded-xl gap-2"
              style={{ background: CORAL }}
            >
              {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </Button>
          </div>
        )}
      </div>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cc-bg">
            <UserRound className="h-5 w-5 text-cc-plum" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-cc-text">Profile details</h2>
            <p className="text-sm text-cc-muted">Your identity within your organisation.</p>
          </div>
        </div>

        <div className="mb-6 rounded-2xl bg-cc-bg p-4">
          <ProfilePhotoUpload currentUrl={profile.profile_photo_url} cropCircle />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <ReadOnlyField label="Full name" value={profile.full_name} />
          <ReadOnlyField label="Role" value={ROLE_LABELS[profile.membership_role || profile.role] || profile.role} />
          <ReadOnlyField label="Employee ID" value={profile.employee_id} />

          {editMode ? (
            <>
              <div>
                <Label htmlFor="profile-email">Email</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  className="mt-1 rounded-xl"
                />
                {profile.pending_email ? (
                  <p className="mt-1 text-xs text-cc-muted">
                    Pending verification for {profile.pending_email}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="profile-phone">Mobile</Label>
                <Input
                  id="profile-phone"
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="profile-address">Home address</Label>
                <Input
                  id="profile-address"
                  value={draftAddress}
                  onChange={(e) => setDraftAddress(e.target.value)}
                  placeholder="Street address for mileage calculations"
                  className="mt-1 rounded-xl"
                />
              </div>
              <div>
                <Label htmlFor="profile-suburb">Suburb</Label>
                <Input
                  id="profile-suburb"
                  value={draftSuburb}
                  onChange={(e) => setDraftSuburb(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="preferred-contact">Preferred contact method</Label>
                <select
                  id="preferred-contact"
                  value={draftPreferredContact}
                  onChange={(e) => setDraftPreferredContact(e.target.value as PreferredContactMethod)}
                  className="mt-1 h-11 w-full rounded-xl border bg-cc-surface px-3 text-sm"
                  style={{ borderColor: BORDER }}
                >
                  {Object.entries(PREFERRED_CONTACT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-cc-muted">
                  Shown to your coordinator when they view your profile. Does not affect system notifications.
                </p>
              </div>
              <p className="md:col-span-2 text-xs text-cc-muted">
                Saving contact changes requires your current password confirmation.
              </p>
            </>
          ) : (
            <>
              <ReadOnlyField label="Email" value={profile.email} />
              <ReadOnlyField label="Mobile" value={profile.phone} />
              <ReadOnlyField label="Home address" value={profile.address} />
              <ReadOnlyField label="Suburb" value={profile.suburb} />
              <ReadOnlyField
                label="Preferred contact method"
                value={
                  profile.preferred_contact_method
                    ? PREFERRED_CONTACT_LABELS[profile.preferred_contact_method]
                    : "In-app message"
                }
              />
            </>
          )}
        </div>
      </section>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cc-bg">
            <LockKeyhole className="h-5 w-5 text-cc-plum" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-cc-text">Change password</h2>
            <p className="text-sm text-cc-muted">Minimum 8 characters with 1 uppercase letter and 1 number.</p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput
              id="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 rounded-xl"
              autoComplete="current-password"
            />
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
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
                      style={{ background: index < strength ? PLUM : "#E2DEF2" }}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs font-medium text-cc-muted">
                  Strength: {passwordStrengthLabel(strength)}
                </p>
              </div>
            ) : null}
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm new password</Label>
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
              style={{ background: PLUM }}
            >
              {changingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-5">
          <h2 className="text-lg font-bold text-cc-text">Desktop notifications</h2>
          <p className="text-sm text-cc-muted">
            Show system alerts (like Slack) when the tab is in the background or for urgent updates.
          </p>
        </div>
        {!getDesktopNotificationSupport() ? (
          <p className="text-sm text-cc-muted">Not supported in this browser.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-cc-text">
              {desktopPermission === "granted" && desktopEnabled
                ? "Enabled"
                : desktopPermission === "denied"
                  ? "Blocked by browser"
                  : "Not enabled"}
            </p>
            {desktopPermission !== "granted" || !desktopEnabled ? (
              <Button
                type="button"
                className="rounded-xl"
                style={{ background: PLUM }}
                onClick={() => void handleEnableDesktopNotifications()}
              >
                Enable desktop notifications
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={handleDisableDesktopNotifications}
              >
                Disable on this device
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-[1.5rem] border bg-cc-surface p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-5">
          <h2 className="text-lg font-bold text-cc-text">Notification preferences</h2>
          <p className="text-sm text-cc-muted">
            Saved for this device. Choose how you want to be notified for each event type.
          </p>
        </div>

        {notificationPrefs ? (
          <div className="space-y-4">
            <div className="hidden md:grid md:grid-cols-[1.4fr_repeat(3,0.5fr)] gap-3 px-2 text-[11px] font-bold uppercase tracking-wider text-cc-muted">
              <span>Event</span>
              {CHANNELS.map((channel) => (
                <span key={channel} className="text-center">{NOTIFICATION_CHANNEL_LABELS[channel]}</span>
              ))}
            </div>
            {EVENTS.map((event) => (
              <div
                key={event}
                className="grid gap-3 rounded-2xl border px-4 py-3 md:grid-cols-[1.4fr_repeat(3,0.5fr)] md:items-center"
                style={{ borderColor: BORDER }}
              >
                <p className="text-sm font-semibold text-cc-text">{NOTIFICATION_EVENT_LABELS[event]}</p>
                {CHANNELS.map((channel) => (
                  <div key={channel} className="flex items-center justify-between md:justify-center gap-3">
                    <span className="text-xs text-cc-muted md:hidden">{NOTIFICATION_CHANNEL_LABELS[channel]}</span>
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
