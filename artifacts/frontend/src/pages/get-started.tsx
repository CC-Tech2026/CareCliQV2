import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Check, Loader2, MailCheck } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";

type PlanTier = "micro" | "small" | "medium";

const TIERS: Array<{
  tier: PlanTier;
  name: string;
  seats: string;
  price: number;
  popular?: boolean;
}> = [
  { tier: "micro", name: "Micro", seats: "1-4 users", price: 125 },
  { tier: "small", name: "Small", seats: "5-10 users", price: 250, popular: true },
  { tier: "medium", name: "Medium", seats: "11-25 users", price: 400 },
];

const FEATURES = [
  "All CareCliQ features included",
  "Unlimited progress notes and participants",
  "Audit-ready evidence exports",
];

export default function GetStarted() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [paidSuccess, setPaidSuccess] = useState(false);

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") {
      setPaidSuccess(true);
    } else if (checkout === "canceled") {
      toast({ title: "Checkout canceled", description: "No charge was made — pick a plan whenever you're ready." });
    }
    if (checkout) {
      window.history.replaceState({}, "", "/get-started");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleChoose(tier: PlanTier) {
    if (busyTier) return;
    setBusyTier(tier);
    try {
      const res = await apiFetch("/api/platform-billing/signup/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_tier: tier }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "Could not start checkout.");
      }
      const data = await res.json();
      if (!data.checkout_url) throw new Error("Could not start checkout.");
      window.location.href = data.checkout_url;
    } catch (err) {
      toast({
        title: "Couldn't start checkout",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setBusyTier(null);
    }
  }

  if (paidSuccess) {
    return (
      <div className="min-h-screen bg-[var(--auth-shell-bg)] flex items-center justify-center px-6">
        <div
          className="w-full max-w-md rounded-3xl border p-8 text-center space-y-4 bg-[var(--auth-form-bg)]"
          style={{ borderColor: "var(--auth-card-border)" }}
        >
          <MailCheck size={48} className="mx-auto" style={{ color: CORAL }} />
          <h1 className="text-2xl font-black" style={{ color: "var(--cc-text)" }}>
            Check your email
          </h1>
          <p className="text-sm" style={{ color: "var(--cc-muted)" }}>
            Payment confirmed — we've sent a welcome email with a link to set your password and
            get started. It usually arrives within a minute or two.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-2 font-bold underline underline-offset-2 text-sm"
            style={{ color: PLUM }}
          >
            Already set your password? Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--auth-shell-bg)]">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-10">
          <CareCliQLogo size={40} />
          <AuthThemeToggle />
        </div>

        <div className="text-center mb-10">
          <h1 className="text-3xl font-black" style={{ color: "var(--cc-text)" }}>
            Start your free trial
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--cc-muted)" }}>
            1 month free, then billed monthly. Cancel anytime.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {TIERS.map(({ tier, name, seats, price, popular }) => (
            <div
              key={tier}
              className="relative rounded-3xl border p-6 flex flex-col bg-[var(--auth-form-bg)]"
              style={{
                borderColor: popular ? PLUM : "var(--auth-card-border)",
                borderWidth: popular ? 2 : 1,
              }}
            >
              {popular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-black text-white"
                  style={{ background: PLUM }}
                >
                  Most popular
                </div>
              )}
              <h2 className="text-lg font-black" style={{ color: "var(--cc-text)" }}>{name}</h2>
              <p className="text-[12px] font-bold uppercase tracking-wider mt-1" style={{ color: "var(--cc-muted)" }}>
                {seats}
              </p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-black" style={{ color: "var(--cc-text)" }}>${price}</span>
                <span className="text-sm font-bold" style={{ color: "var(--cc-muted)" }}>/ month</span>
              </div>
              <ul className="mt-5 space-y-2.5 flex-1">
                {FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13px]" style={{ color: "var(--cc-text)" }}>
                    <Check size={16} style={{ color: CORAL }} className="shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void handleChoose(tier)}
                disabled={busyTier !== null}
                className="mt-6 w-full h-11 rounded-xl text-white font-black transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                style={{ background: popular ? PLUM : "var(--cc-text)" }}
              >
                {busyTier === tier ? <Loader2 size={16} className="animate-spin" /> : null}
                Start free trial
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-[13px] font-medium mt-8" style={{ color: "var(--cc-muted)" }}>
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="font-bold underline underline-offset-2"
            style={{ color: PLUM }}
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
