import { AlertTriangle, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";

type SubscriptionStatus = {
  subscription_status: string | null;
  stripe_customer_id: string | null;
};

const PROBLEM_STATUSES: Record<string, string> = {
  past_due: "Your last payment failed",
  unpaid: "Your subscription is unpaid",
  canceled: "Your subscription has been cancelled",
};

/** MD-only, app-wide warning when the org's Stripe subscription has a
 * payment problem — shown regardless of what page they're on, since
 * nothing else in the app surfaces this beyond a small status badge on the
 * billing pages themselves. Deliberately warn-only: never restricts access,
 * an NDIS provider should never lose the ability to manage participant
 * care over a billing issue. */
export function PaymentIssueBanner({ isMD }: { isMD: boolean }) {
  const { toast } = useToast();
  const [openingPortal, setOpeningPortal] = useState(false);
  const { data } = useOrgQuery<SubscriptionStatus>(["platform-billing-status", "banner"], {
    queryFn: () => apiFetch("/api/platform-billing/status").then((res) => (res.ok ? res.json() : null)),
    enabled: isMD,
    staleTime: 5 * 60 * 1000,
  });

  if (!isMD || !data?.stripe_customer_id) return null;
  const message = data.subscription_status ? PROBLEM_STATUSES[data.subscription_status] : null;
  if (!message) return null;

  async function handleUpdatePayment() {
    if (openingPortal) return;
    setOpeningPortal(true);
    try {
      const res = await apiFetch("/api/platform-billing/portal", { method: "POST" });
      if (!res.ok) throw new Error("Could not open the billing portal.");
      const portal = await res.json();
      window.location.href = portal.portal_url;
    } catch (err) {
      toast({
        title: "Couldn't open billing portal",
        description: err instanceof Error ? err.message : "Please try again, or visit Settings → Billing.",
        variant: "destructive",
      });
      setOpeningPortal(false);
    }
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: "#FCA5A5", background: "#FEF2F2" }}
    >
      <AlertTriangle size={16} className="shrink-0" style={{ color: "#DC2626" }} />
      <p className="flex-1 min-w-0 text-[13px] font-semibold" style={{ color: "#991B1B" }}>
        {message} — update your payment method to keep your CareCliQ subscription active.
      </p>
      <button
        type="button"
        onClick={() => void handleUpdatePayment()}
        disabled={openingPortal}
        className="shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 flex items-center gap-1.5"
        style={{ background: "#DC2626" }}
      >
        {openingPortal && <Loader2 size={12} className="animate-spin" />}
        Update payment method
      </button>
      <Link href="/platform-billing" className="shrink-0 text-[12px] font-bold underline underline-offset-2" style={{ color: "#991B1B" }}>
        View billing
      </Link>
    </div>
  );
}
