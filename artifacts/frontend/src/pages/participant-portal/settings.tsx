import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, SlidersHorizontal } from "lucide-react";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { AccessibilityPanel } from "@/components/AccessibilityPanel";
import { changePassword } from "@/services/userService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const DANGER = "#B42318";

function SettingsSection({ icon: Icon, title, description, children }: {
  icon: typeof KeyRound;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--cc-plum-soft)" }}>
          <Icon size={18} style={{ color: PLUM }} />
        </span>
        <div>
          <h2 className="text-[16px] font-black" style={{ color: TEXT }}>{title}</h2>
          <p className="text-[13px]" style={{ color: MUTED }}>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword({ current_password: current, new_password: next, confirm_password: confirm });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-xl border px-3 py-2.5 text-[15px]";
  const fieldStyle = { borderColor: BORDER, color: TEXT, background: SURFACE };

  return (
    <form className="max-w-md space-y-4" onSubmit={submit}>
      <div>
        <label htmlFor="current-password" className="text-[13px] font-bold" style={{ color: TEXT }}>Current password</label>
        <input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={field} style={fieldStyle} />
      </div>
      <div>
        <label htmlFor="new-password" className="text-[13px] font-bold" style={{ color: TEXT }}>New password</label>
        <input id="new-password" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} className={field} style={fieldStyle} />
        <p className="mt-1 text-[12px]" style={{ color: MUTED }}>At least 10 characters, with a capital letter and a number.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="text-[13px] font-bold" style={{ color: TEXT }}>Confirm new password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} style={fieldStyle} />
      </div>
      {error && <p role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>{error}</p>}
      {done && (
        <p role="status" className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "#1F7A4D" }}>
          <CheckCircle2 size={15} /> Your password has been changed.
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
        style={{ background: PLUM }}
      >
        {busy && <Loader2 size={15} className="animate-spin" />} Change password
      </button>
    </form>
  );
}

/** Account settings for whoever is signed in — display & accessibility and password. */
export default function ParticipantSettingsPage() {
  return (
    <ParticipantPortalShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: TEXT }}>Settings</h1>
          <p className="mt-1 text-[13px]" style={{ color: MUTED }}>These settings apply to your account on every device.</p>
        </div>

        <SettingsSection
          icon={SlidersHorizontal}
          title="Display & accessibility"
          description="Text size, colours and language."
        >
          <AccessibilityPanel showHeader={false} />
        </SettingsSection>

        <SettingsSection icon={KeyRound} title="Password" description="Change the password you sign in with.">
          <PasswordForm />
        </SettingsSection>
      </div>
    </ParticipantPortalShell>
  );
}
