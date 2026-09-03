import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { MailCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SIGNATURE, DISPLAY_FONT } from "@/components/get-started/shared";
import { GetStartedFlow } from "@/components/get-started/GetStartedFlow";

export default function GetStarted() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [paidSuccess, setPaidSuccess] = useState(false);

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") {
      setPaidSuccess(true);
    } else if (checkout === "canceled") {
      toast({ title: "Checkout canceled", description: "No charge was made. Pick a plan whenever you're ready." });
    }
    if (checkout) {
      window.history.replaceState({}, "", "/get-started");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-6 font-bold underline underline-offset-2 text-sm"
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
