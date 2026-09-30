import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { usePortalDocumentTitle } from "@/components/participant-portal/PortalAuthLayout";
import {
  acceptPortalInvite,
  getPortalInvite,
  verifyPortalInviteIdentity,
  type PortalInviteSummary,
} from "@/services/participantPortalAccessService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const DANGER = "#B42318";

type Step = "loading" | "invalid" | "identity" | "password" | "done";

const IDENTITY_PROMPT: Record<string, { label: (possessive: string) => string; hint: string; type: string; inputMode?: "numeric" }> = {
  participant_dob: {
    label: (possessive) => `${possessive} date of birth`,
    hint: "We use this to confirm the invitation reached the right person.",
    type: "date",
  },
  ndis_number: {
    label: (possessive) => `${possessive} NDIS number`,
    hint: "The 9-digit number on the NDIS plan.",
    type: "text",
    inputMode: "numeric",
  },
  code: {
    label: () => "Your 6-digit code",
    hint: "Your care provider will have given you this code by phone or in person.",
    type: "text",
    inputMode: "numeric",
  },
};

/**
 * Public page the Participants Portal invite email links to. Confirm
 * identity against something already on file, then set a password. The
 * account's sign-in is always the invited email address.
 */
export default function ParticipantInvitePage() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [step, setStep] = useState<Step>("loading");
  const [invite, setInvite] = useState<PortalInviteSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkedExisting, setLinkedExisting] = useState(false);
  usePortalDocumentTitle("Set up your account");

  useEffect(() => {
    if (!token) {
      setError("This link is missing its invitation code.");
      setStep("invalid");
      return;
    }
    getPortalInvite(token)
      .then((data) => {
        setInvite(data);
        setStep(data.identity_verified ? "password" : "identity");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "This invitation isn't valid.");
        setStep("invalid");
      });
  }, [token]);

  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyPortalInviteIdentity(token, answer);
      setStep("password");
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(err instanceof Error ? err.message : "That didn't match.");
      if (status === 423 || status === 410 || status === 404) setStep("invalid");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await acceptPortalInvite(token, password);
      setLinkedExisting(result.linked_existing_login);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up your account.");
    } finally {
      setBusy(false);
    }
  }

  const possessive =
    invite && invite.relationship !== "self" ? `${invite.participant_first_name || "The participant"}'s` : "Your";
  const prompt = IDENTITY_PROMPT[invite?.identity_method ?? "participant_dob"] ?? IDENTITY_PROMPT.participant_dob;
  const promptLabel = prompt.label(possessive);

  const inputClass = "mt-1 w-full rounded-xl border px-3 py-3 text-[16px]";
  const buttonClass = "flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[15px] font-bold text-white disabled:opacity-60";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: "var(--cc-bg)" }}>
      <div className="w-full max-w-md rounded-3xl border p-6 shadow-sm sm:p-8" style={{ borderColor: BORDER, background: SURFACE }}>
        <div className="mb-6 flex justify-center">
          <CareCliQLogo size={64} />
        </div>

        {step === "loading" && (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin" size={28} style={{ color: PLUM }} />
          </div>
        )}

        {step === "invalid" && (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-black" style={{ color: TEXT }}>This invitation can't be used</h1>
            <p className="text-[14px]" style={{ color: MUTED }}>{error}</p>
            <button className={buttonClass} style={{ background: PLUM }} onClick={() => navigate("/portal/login")}>
              Go to sign in
            </button>
          </div>
        )}

        {step === "identity" && invite && (
          <form className="space-y-5" onSubmit={submitIdentity}>
            <div>
              <h1 className="text-xl font-black" style={{ color: TEXT }}>Hi {invite.invitee_first_name}</h1>
              <p className="mt-1 text-[14px]" style={{ color: MUTED }}>
                {invite.organization_name} has invited you to their Participants Portal. First, please confirm who you are.
              </p>
            </div>
            <div>
              <label htmlFor="identity-answer" className="text-[13px] font-bold" style={{ color: TEXT }}>{promptLabel}</label>
              <input
                id="identity-answer"
                type={prompt.type}
                inputMode={prompt.inputMode}
                autoComplete="off"
                required
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className={inputClass}
                style={{ borderColor: BORDER, color: TEXT, background: SURFACE }}
              />
              <p className="mt-1 text-[12px]" style={{ color: MUTED }}>{prompt.hint}</p>
            </div>
            {error && <p role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>{error}</p>}
            <button type="submit" disabled={busy} className={buttonClass} style={{ background: PLUM }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Continue
            </button>
          </form>
        )}

        {step === "password" && invite && (
          <form className="space-y-5" onSubmit={submitPassword}>
            <div>
              <h1 className="text-xl font-black" style={{ color: TEXT }}>Set your password</h1>
              <p className="mt-1 text-[14px]" style={{ color: MUTED }}>
                You'll sign in with your email address: <strong style={{ color: TEXT }}>{invite.email}</strong>
              </p>
            </div>
            <div>
              <label htmlFor="new-password" className="text-[13px] font-bold" style={{ color: TEXT }}>Password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                style={{ borderColor: BORDER, color: TEXT, background: SURFACE }}
              />
              <p className="mt-1 text-[12px]" style={{ color: MUTED }}>At least 10 characters, with a capital letter and a number.</p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="text-[13px] font-bold" style={{ color: TEXT }}>Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
                style={{ borderColor: BORDER, color: TEXT, background: SURFACE }}
              />
            </div>
            {error && <p role="alert" className="text-[13px] font-semibold" style={{ color: DANGER }}>{error}</p>}
            <button type="submit" disabled={busy} className={buttonClass} style={{ background: PLUM }}>
              {busy && <Loader2 size={16} className="animate-spin" />} Create my account
            </button>
          </form>
        )}

        {step === "done" && invite && (
          <div className="space-y-4 text-center">
            <CheckCircle2 size={40} className="mx-auto" style={{ color: PLUM }} />
            <h1 className="text-xl font-black" style={{ color: TEXT }}>You're all set</h1>
            <p className="text-[14px]" style={{ color: MUTED }}>
              {linkedExisting
                ? "This access has been added to your existing account. Sign in with your usual password."
                : "Your account is ready."}{" "}
              Sign in with <strong style={{ color: TEXT }}>{invite.email}</strong>.
            </p>
            <button className={buttonClass} style={{ background: PLUM }} onClick={() => navigate("/portal/login")}>
              Go to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
