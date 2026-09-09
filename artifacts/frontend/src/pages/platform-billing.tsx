import { useEffect, useState } from "react";
import { Check, Loader2, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { HubLayout } from "@/components/layout/HubLayout";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

type PlanTier = "micro" | "small" | "medium";

const TIERS: Array<{ tier: PlanTier; name: string; seats: string; price: number }> = [
  { tier: "micro", name: "Micro", seats: "1-4 users", price: 125 },
  { tier: "small", name: "Small", seats: "5-10 users", price: 250 },
  { tier: "medium", name: "Medium", seats: "11-25 users", price: 400 },
];

type SubscriptionStatus = {
  plan_tier: PlanTier | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  trialing: { label: "Free trial", color: CORAL },
  active: { label: "Active", color: "#22C55E" },
  past_due: { label: "Payment failed", color: "#EF4444" },
  canceled: { label: "Cancelled", color: MUTED },
  unpaid: { label: "Unpaid", color: "#EF4444" },
};

export default function PlatformBilling() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"portal" | PlanTier | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/platform-billing/status")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load subscription status.");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: "Couldn't load billing",
            description: err instanceof Error ? err.message : "Please try again.",
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePortal() {
    if (busy) return;
    setBusy("portal");
    try {
      const res = await apiFetch("/api/platform-billing/portal", { method: "POST" });
      if (!res.ok) throw new Error("Could not open the billing portal.");
      const data = await res.json();
      window.location.href = data.portal_url;
    } catch (err) {
      toast({
        title: "Couldn't open billing portal",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setBusy(null);
    }
  }

  async function handleChoose(tier: PlanTier) {
    if (busy) return;
    setBusy(tier);
    try {
      const res = await apiFetch("/api/platform-billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_tier: tier }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "Could not start checkout.");
      }
      const data = await res.json();
      window.location.href = data.checkout_url;
    } catch (err) {
      toast({
        title: "Couldn't start checkout",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <HubLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin" style={{ color: PLUM }} size={28} />
        </div>
      </HubLayout>
    );
  }

  const statusInfo = status?.subscription_status ? STATUS_LABELS[status.subscription_status] : null;
  const hasSubscription = Boolean(status?.stripe_customer_id);

  return (
    <HubLayout>
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-black" style={{ color: TEXT }}>Subscription &amp; billing</h1>
        <p className="text-sm mt-1" style={{ color: MUTED }}>
          Manage CareCliQ's platform subscription for your organisation.
        </p>
      </div>

      {hasSubscription && (
        <div
          className="rounded-2xl border p-5 flex items-center justify-between"
          style={{ borderColor: BORDER, background: "var(--cc-card)" }}
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              Current plan
            </p>
            <p className="text-lg font-black mt-1" style={{ color: TEXT }}>
              {status?.plan_tier ? TIERS.find((t) => t.tier === status.plan_tier)?.name ?? status.plan_tier : "—"}
              {statusInfo && (
                <span className="ml-2 text-[12px] font-bold" style={{ color: statusInfo.color }}>
                  {statusInfo.label}
                </span>
              )}
            </p>
            {status?.trial_ends_at && status.subscription_status === "trialing" && (
              <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                Trial ends {new Date(status.trial_ends_at).toLocaleDateString("en-AU")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handlePortal()}
            disabled={busy !== null}
            className="h-10 px-4 rounded-xl border font-bold text-[13px] flex items-center gap-2 transition-all hover:bg-[var(--cc-soft)] disabled:opacity-40"
            style={{ borderColor: BORDER, color: PLUM }}
          >
            {busy === "portal" ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
            Manage billing
          </button>
        </div>
      )}

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: MUTED }}>
          {hasSubscription ? "Change plan" : "Choose a plan"}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIERS.map(({ tier, name, seats, price }) => {
            const isCurrent = status?.plan_tier === tier;
            return (
              <div
                key={tier}
                className="rounded-2xl border p-5 flex flex-col"
                style={{
                  borderColor: isCurrent ? PLUM : BORDER,
                  borderWidth: isCurrent ? 2 : 1,
                  background: "var(--cc-card)",
                }}
              >
                <h3 className="font-black" style={{ color: TEXT }}>{name}</h3>
                <p className="text-[11px] font-bold uppercase tracking-wider mt-0.5" style={{ color: MUTED }}>
                  {seats}
                </p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-2xl font-black" style={{ color: TEXT }}>${price}</span>
                  <span className="text-[12px] font-bold" style={{ color: MUTED }}>/mo</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleChoose(tier)}
                  disabled={busy !== null || isCurrent}
                  className="mt-4 w-full h-10 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-50"
                  style={{
                    background: isCurrent ? "transparent" : PLUM,
                    color: isCurrent ? PLUM : "#FFFFFF",
                    border: isCurrent ? `1.5px solid ${PLUM}` : "none",
                  }}
                >
                  {busy === tier ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : isCurrent ? (
                    <Check size={14} />
                  ) : null}
                  {isCurrent ? "Current plan" : "Select"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </HubLayout>
  );
}
