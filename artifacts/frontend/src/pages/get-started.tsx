import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { MailCheck, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-fetch";
import { SIGNATURE, DISPLAY_FONT } from "@/components/get-started/shared";
import { GetStartedFlow } from "@/components/get-started/GetStartedFlow";

export default function GetStarted() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [paidSuccess, setPaidSuccess] = useState(false);
  const [signupEmail, setSignupEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (checkout === "success") {
      setPaidSuccess(true);
      if (sessionId) {
        apiFetch(`/api/platform-billing/signup/session-email?session_id=${encodeURIComponent(sessionId)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => setSignupEmail(data?.email ?? null))
          .catch(() => setSignupEmail(null));
      }
    } else if (checkout === "canceled") {
      toast({ title: "Checkout canceled", description: "No charge was made. Pick a plan whenever you're ready." });
    }
    if (checkout) {
      window.history.replaceState({}, "", "/get-started");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleResend() {
    if (!signupEmail || resending) return;
    setResending(true);
    try {
      await apiFetch("/api/platform-billing/signup/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: signupEmail }),
      });
      setResent(true);
    } catch {
      // Silently fine either way - the endpoint always returns a generic
      // success-shaped response so it can't be used to probe emails.
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  if (paidSuccess) {
    return (
      <div className="min-h-screen bg-[var(--auth-shell-bg)] flex items-center justify-center px-6">
        <div
          className="w-full max-w-md rounded-2xl border p-8 bg-[var(--auth-form-bg)]"
          style={{ borderColor: "var(--auth-card-border)" }}
        >
          <div
            className="h-12 w-12 rounded-full flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--cc-plum) 14%, transparent)" }}
          >
            <MailCheck size={22} style={{ color: SIGNATURE }} />
          </div>
          <h1
            className="mt-5 text-2xl font-black"
            style={{ color: "var(--cc-text)", fontFamily: DISPLAY_FONT }}
          >
            Check your email
          </h1>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--cc-muted)" }}>
            Payment confirmed. We've sent a welcome email with a link to set your password and
            get started. It usually arrives within a minute or two.
          </p>

          {signupEmail && (
            <p className="mt-4 text-[13px]" style={{ color: "var(--cc-muted)" }}>
              {resent ? (
                "Sent again — check your inbox (and spam folder)."
              ) : (
                <>
                  Didn't get it?{" "}
                  <button
                    type="button"
                    onClick={() => void handleResend()}
                    disabled={resending}
                    className="font-bold underline underline-offset-2 disabled:opacity-50 inline-flex items-center gap-1"
                    style={{ color: SIGNATURE }}
                  >
                    {resending && <Loader2 size={12} className="animate-spin" />}
                    Resend the email
                  </button>
                </>
              )}
            </p>
          )}

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-4 font-bold underline underline-offset-2 text-sm"
            style={{ color: SIGNATURE }}
          >
            Already set your password? Sign in
          </button>
        </div>
      </div>
    );
  }

  return <GetStartedFlow />;
}
