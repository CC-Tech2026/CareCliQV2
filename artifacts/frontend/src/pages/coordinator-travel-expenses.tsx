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
import {
  actionTravelSubmission,
  getCoordinatorTravelSettings,
  getCoordinatorTravelSubmissions,
  updateCoordinatorTravelRate,
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
    </div>
  );
}
