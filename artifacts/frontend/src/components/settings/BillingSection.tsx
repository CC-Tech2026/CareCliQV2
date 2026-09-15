import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

type SubscriptionStatus = {
  plan_tier: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
};
const PLAN_NAMES: Record<string, string> = {
  micro: "Micro",
  small: "Small",
  medium: "Medium",
};
const STATUS_NAMES: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment overdue",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Setup incomplete",
  incomplete_expired: "Setup expired",
  paused: "Paused",
};

export function BillingSection() {
  const { user } = useAuth();
  const allowed = user?.role === "managing_director";
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiFetch("/api/platform-billing/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("Subscription unavailable");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, attempt]);
  if (!allowed) return null;
  const hasPlan = Boolean(status?.plan_tier || status?.subscription_status);
  const needsPayment = ["past_due", "unpaid", "incomplete"].includes(
    status?.subscription_status ?? "",
  );
  const trialDate = status?.trial_ends_at
    ? new Date(status.trial_ends_at)
    : null;
  const trialEnd =
    trialDate && Number.isFinite(trialDate.getTime())
      ? trialDate.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;
  return (
    <section
      className="min-w-0 space-y-5"
      aria-labelledby="subscription-heading"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="subscription-heading"
            className="text-2xl font-semibold tracking-tight text-cc-text"
          >
            Billing &amp; Subscription
          </h2>
          <p className="mt-1 text-sm text-cc-muted">
            Your organisation's CareCliQ plan and payment settings.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-cc-muted">
          <ShieldCheck size={15} /> Managing director access
        </span>
      </header>
      {loading ? (
        <div
          role="status"
          className="rounded-xl border border-cc-border bg-cc-card p-6"
        >
          <p className="text-sm text-cc-muted">Loading subscription...</p>
          <div className="mt-4 h-16 animate-pulse rounded-lg bg-cc-soft" />
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-cc-border bg-cc-card p-5"
        >
          <h3 className="font-semibold text-cc-text">
            Subscription details are unavailable
          </h3>
          <p className="mt-1 text-sm text-cc-muted">
            We couldn't retrieve your current plan. Try loading it again.
          </p>
          <Button
            variant="outline"
            className="mt-4 min-h-11"
            onClick={() => setAttempt((v) => v + 1)}
          >
            <RefreshCw size={16} /> Retry subscription
          </Button>
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-xl border border-cc-border bg-cc-card p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-cc-muted">Current plan</p>
              {status?.subscription_status && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${needsPayment ? "bg-amber-50 text-amber-900" : "bg-cc-soft text-cc-text"}`}
                >
                  {STATUS_NAMES[status.subscription_status] ??
                    status.subscription_status.replaceAll("_", " ")}
                </span>
              )}
            </div>
            <h3 className="mt-3 break-words text-2xl font-semibold text-cc-text">
              {status?.plan_tier
                ? (PLAN_NAMES[status.plan_tier] ?? status.plan_tier)
                : hasPlan
                  ? "Plan details pending"
                  : "No plan selected"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-cc-muted">
              {needsPayment
                ? "Review your payment method and outstanding balance in billing management."
                : status?.subscription_status === "canceled"
                  ? "Review your billing account to manage or restart your subscription."
                  : hasPlan
                    ? "View plan options, payment details and subscription invoices in billing management."
                    : "Choose a CareCliQ plan for your organisation to get started."}
            </p>
            {status?.subscription_status === "trialing" && trialEnd && (
              <p className="mt-4 border-t border-cc-border pt-4 text-sm text-cc-text">
                Trial ends <strong className="font-semibold">{trialEnd}</strong>
              </p>
            )}
            <Button asChild className="mt-5 min-h-11 w-full sm:w-auto">
              <Link href="/platform-billing">
                <CreditCard size={16} />
                {hasPlan || status?.stripe_customer_id
                  ? "Manage plan & billing"
                  : "Choose a plan"}
                <ArrowUpRight size={16} />
              </Link>
            </Button>
          </div>
          <aside className="min-w-0 rounded-xl border border-cc-border bg-cc-card p-5 sm:p-6">
            <h3 className="font-semibold text-cc-text">Billing management</h3>
            <dl className="mt-4 divide-y divide-cc-border text-sm">
              <div className="pb-3">
                <dt className="font-medium text-cc-text">Plan and payments</dt>
                <dd className="mt-1 leading-6 text-cc-muted">
                  Review available plans and manage your payment method.
                </dd>
              </div>
              <div className="py-3">
                <dt className="font-medium text-cc-text">
                  Subscription invoices
                </dt>
                <dd className="mt-1 leading-6 text-cc-muted">
                  Access payment history through your billing account.
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </section>
  );
}
