import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bus, Car, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageHeader, Section, SkeletonBlocks, outlineClass } from "@/components/layout/PageKit";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import {
  actionTravelSubmission,
  getCoordinatorTravelSettings,
  getCoordinatorTravelSubmissions,
  getTravelToPay,
  markTravelClaimsPaid,
  updateCoordinatorTravelRate,
  type TravelClaimToPay,
  type TravelSubmission,
} from "@/services/coordinatorTravelService";
import { formatAppDate } from "@/lib/datetime";

const BORDER = "var(--cc-border)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

function formatAud(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso?: string | null, tz?: string | null) {
  if (!iso) return "N/A";
  return formatAppDate(iso, tz);
}

export default function CoordinatorTravelExpenses() {
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const queryClient = useQueryClient();
  const [rateDraft, setRateDraft] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: settings } = useOrgQuery(["coordinator", "travel-settings"], {
    queryFn: getCoordinatorTravelSettings,
  });
  const { data, isLoading, refetch } = useOrgQuery(["coordinator", "travel-submissions"], {
    queryFn: getCoordinatorTravelSubmissions,
    refetchInterval: 60_000,
  });

  const submissions = data?.submissions ?? [];

  const rateMut = useMutation({
    mutationFn: () => {
      const cents = Math.round(Number(rateDraft) * 100);
      if (!rateDraft || Number.isNaN(cents) || cents <= 0) {
        throw new Error(translate("coordinator.travel.error.invalidRate"));
      }
      return updateCoordinatorTravelRate(cents);
    },
    onSuccess: (res) => {
      toast({ title: translate("coordinator.travel.toast.rateUpdated"), description: res.rate_display });
      queryClient.invalidateQueries({ queryKey: [orgId, "coordinator", "travel-settings"] });
    },
    onError: (e: Error) =>
      toast({ title: translate("coordinator.travel.toast.updateFailed"), description: e.message, variant: "destructive" }),
  });

  const actionMut = useMutation({
    mutationFn: ({
      id,
      approve,
      rejection_reason,
      mark_paid,
    }: {
      id: string;
      approve: boolean;
      rejection_reason?: string;
      mark_paid?: boolean;
    }) => actionTravelSubmission(id, { approve, rejection_reason, mark_paid }),
    onSuccess: () => {
      toast({ title: translate("coordinator.travel.toast.submissionUpdated") });
      setRejectId(null);
      setRejectReason("");
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes("travel-to-pay") });
      void refetch();
    },
    onError: (e: Error) =>
      toast({ title: translate("coordinator.travel.toast.actionFailed"), description: e.message, variant: "destructive" }),
  });

  return (
    <div className="w-full space-y-5 pb-24">
      <PageHeader
        eyebrow={translate("coordinator.travel.eyebrow")}
        title={translate("coordinator.travel.title")}
        description={translate("coordinator.travel.subtitle")}
      />

      <Section
        title={translate("coordinator.travel.mileageRate")}
        description={settings?.rate_display}
      >
        <div className="flex w-full flex-wrap items-end gap-2 rounded-2xl border border-cc-border bg-cc-surface p-4 sm:w-fit sm:p-5">
          <div className="w-full sm:w-48">
            <Label htmlFor="mileage-rate" className="text-xs text-cc-muted">
              {translate("coordinator.travel.newRate")}
            </Label>
            <Input
              id="mileage-rate"
              type="number"
              min={0}
              step={0.01}
              placeholder="0.88"
              value={rateDraft}
              onChange={(e) => setRateDraft(e.target.value)}
              className="mt-1 h-10 rounded-full px-4"
            />
          </div>
          <button
            type="button"
            className={outlineClass}
            disabled={rateMut.isPending}
            onClick={() => rateMut.mutate()}
          >
            {rateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : translate("coordinator.travel.updateRate")}
          </button>
        </div>
      </Section>

      <Section title={translateParams("coordinator.travel.pendingSubmissions", { count: String(submissions.length) })}>
        {isLoading ? (
          <SkeletonBlocks count={2} height="h-16" />
        ) : submissions.length === 0 ? (
          <EmptyState icon={Car} title={translate("coordinator.travel.noSubmissions")} />
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border border-cc-border bg-cc-surface" style={{ borderColor: BORDER }}>
            {submissions.map((sub: TravelSubmission) => (
              <li key={sub.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: TEXT }}>
                      {sub.worker_name}
                    </p>
                    <p className="text-xs" style={{ color: MUTED }}>
                      {translateParams("coordinator.travel.submitted", {
                        date: formatDate(sub.submitted_at, sub.timezone),
                        amount: formatAud(sub.total_amount_cents),
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                      disabled={actionMut.isPending}
                      onClick={() => actionMut.mutate({ id: sub.id, approve: true })}
                    >
                      <Check size={14} />
                      {translate("coordinator.travel.approve")}
                    </button>
                    <button
                      type="button"
                      className={outlineClass}
                      disabled={actionMut.isPending}
                      onClick={() => setRejectId(sub.id)}
                    >
                      <X size={14} />
                      {translate("coordinator.travel.reject")}
                    </button>
                  </div>
                </div>

                <ul className="mt-3 space-y-1.5 rounded-xl bg-cc-soft px-3 py-2.5">
                  {(sub.expenses || []).map((exp) => (
                    <li key={exp.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2" style={{ color: TEXT }}>
                        {exp.expense_type === "mileage" ? <Car size={14} /> : <Bus size={14} />}
                        {exp.expense_type ? exp.expense_type.charAt(0).toUpperCase() + exp.expense_type.slice(1) : ""}
                        {exp.claimed_km != null ? translateParams("coordinator.travel.kmSuffix", { km: String(exp.claimed_km) }) : ""}
                        {exp.transit_type ? ` · ${exp.transit_type}` : ""}
                      </span>
                      <span className="font-medium tabular-nums">{formatAud(exp.amount_cents)}</span>
                    </li>
                  ))}
                </ul>

                {rejectId === sub.id && (
                  <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: "var(--cc-status-danger-bg)" }}>
                    <Label htmlFor={`reject-${sub.id}`} className="text-xs font-medium" style={{ color: "var(--cc-danger-text)" }}>
                      {translate("coordinator.travel.rejectionReason")}
                    </Label>
                    <Textarea
                      id={`reject-${sub.id}`}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder={translate("coordinator.travel.rejectionPlaceholder")}
                      className="bg-cc-surface"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={!rejectReason.trim() || actionMut.isPending}
                        onClick={() =>
                          actionMut.mutate({
                            id: sub.id,
                            approve: false,
                            rejection_reason: rejectReason.trim(),
                          })
                        }
                      >
                        {translate("coordinator.travel.confirmReject")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRejectId(null)}>
                        {translate("common.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <TravelPaidWithWages />
    </div>
  );
}

const PAID_VIA: Record<string, string> = {
  payroll_export: "Paid with wages (Payroll page)",
  xero_payroll: "Paid with wages (Xero Payroll)",
  employment_hero: "Paid with wages (Employment Hero)",
  manual: "Marked paid",
};

function claimLabel(c: TravelClaimToPay) {
  if (c.kind === "km") return `${c.km ?? 0} km vehicle allowance`;
  return `${c.transit_type ? c.transit_type.charAt(0).toUpperCase() + c.transit_type.slice(1) : "Travel"} fare`;
}

/** Approved claims are paid in the worker's next pay. This shows what's
 *  still owed (and anything payroll couldn't take), and what was paid. */
function TravelPaidWithWages() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const query = useOrgQuery(["coordinator", "travel-to-pay"], { queryFn: getTravelToPay, refetchInterval: 60_000 });
  const toPay = query.data?.to_pay ?? [];
  const paid = query.data?.paid ?? [];
  const owed = toPay.reduce((sum, c) => sum + c.amount_cents, 0);
  const markPaid = useMutation({
    mutationFn: (ids: string[]) => markTravelClaimsPaid(ids),
    onSuccess: (res) => {
      toast({ title: res.marked_paid === 1 ? "1 claim marked paid" : `${res.marked_paid} claims marked paid` });
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes("travel-to-pay") });
    },
    onError: (e: Error) => toast({ title: "Couldn't mark it paid", description: e.message, variant: "destructive" }),
  });

  const row = (c: TravelClaimToPay, done: boolean) => (
    <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
      {c.kind === "km" ? <Car size={14} style={{ color: MUTED }} /> : <Bus size={14} style={{ color: MUTED }} />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium" style={{ color: TEXT }}>{c.worker_name}</span>
        <span className="block text-xs" style={{ color: c.payroll_error && !done ? "var(--cc-danger-text)" : MUTED }}>
          {claimLabel(c)}
          {done
            ? ` · ${PAID_VIA[c.paid_via ?? ""] ?? "Paid"}${c.paid_at ? ` ${formatDate(c.paid_at)}` : ""}`
            : c.payroll_error ? ` · ${c.payroll_error}` : ` · Approved ${formatDate(c.approved_at)}`}
        </span>
      </span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: TEXT }}>{formatAud(c.amount_cents)}</span>
      {!done && (
        <button type="button" className="text-xs font-medium underline" style={{ color: MUTED }}
          disabled={markPaid.isPending} onClick={() => markPaid.mutate([c.id])}>
          Paid another way
        </button>
      )}
    </li>
  );

  return (
    <Section
      title={toPay.length ? `To pay with wages · ${formatAud(owed)}` : "To pay with wages"}
      description="Approved claims are paid in the worker's next pay: kilometres as a vehicle allowance, fares as a reimbursement. They're on the Payroll page with the hours."
      action={<Link href="/payroll" className={outlineClass}>Open Payroll</Link>}
    >
      {query.isLoading ? (
        <SkeletonBlocks count={1} height="h-16" />
      ) : toPay.length === 0 && paid.length === 0 ? (
        <EmptyState icon={Car} title="Nothing to pay yet" />
      ) : (
        <div className="space-y-3">
          {toPay.length > 0 ? (
            <ul className="divide-y overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">{toPay.map((c) => row(c, false))}</ul>
          ) : (
            <p className="text-sm" style={{ color: MUTED }}>Every approved claim has been paid.</p>
          )}
          {paid.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium" style={{ color: TEXT }}>Recently paid ({paid.length})</summary>
              <ul className="mt-2 divide-y overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">{paid.map((c) => row(c, true))}</ul>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}
