import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bus, Car, Check, Loader2, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  actionTravelSubmission,
  getCoordinatorTravelSettings,
  getCoordinatorTravelSubmissions,
  updateCoordinatorTravelRate,
  type TravelSubmission,
} from "@/services/coordinatorTravelService";

const PLUM = "var(--cc-plum)";
const BORDER = "var(--cc-border)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

function formatAud(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function CoordinatorTravelExpenses() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rateDraft, setRateDraft] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: settings } = useOrgQuery(["coordinator", "travel-settings"], {
    queryFn: getCoordinatorTravelSettings,
  });
  const { data, isLoading, refetch } = useOrgQuery(["coordinator", "travel-submissions"], {
    queryFn: getCoordinatorTravelSubmissions,
    refetchInterval: 30_000,
  });

  const submissions = data?.submissions ?? [];

  const rateMut = useMutation({
    mutationFn: () => {
      const cents = Math.round(Number(rateDraft) * 100);
      if (!rateDraft || Number.isNaN(cents) || cents <= 0) {
        throw new Error("Enter a valid rate per km.");
      }
      return updateCoordinatorTravelRate(cents);
    },
    onSuccess: (res) => {
      toast({ title: "Mileage rate updated", description: res.rate_display });
      queryClient.invalidateQueries({ queryKey: ["coordinator", "travel-settings"] });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
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
      toast({ title: "Submission updated" });
      setRejectId(null);
      setRejectReason("");
      void refetch();
    },
    onError: (e: Error) =>
      toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 pb-24 sm:p-6">
      <header>
        <p className="text-xs font-black uppercase tracking-wider" style={{ color: PLUM }}>
          Reimbursement
        </p>
        <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT }}>
          Travel expense approvals
        </h1>
        <p className="mt-2 text-sm font-medium" style={{ color: MUTED }}>
          Review worker mileage and transit claims, then approve or reject.
        </p>
      </header>

      <section className="rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-3 flex items-center gap-2">
          <Settings2 size={18} style={{ color: PLUM }} />
          <h2 className="text-sm font-black" style={{ color: TEXT }}>
            Organisation mileage rate
          </h2>
        </div>
        {settings?.rate_display && (
          <p className="mb-3 text-sm font-semibold" style={{ color: TEXT }}>
            {settings.rate_display}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="mileage-rate" className="text-xs text-cc-muted">
              New rate ($/km)
            </Label>
            <Input
              id="mileage-rate"
              type="number"
              min={0}
              step={0.01}
              placeholder="0.88"
              value={rateDraft}
              onChange={(e) => setRateDraft(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button
            type="button"
            className="font-black text-white"
            style={{ background: PLUM }}
            disabled={rateMut.isPending}
            onClick={() => rateMut.mutate()}
          >
            {rateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update rate"}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="text-sm font-black" style={{ color: TEXT }}>
          Pending submissions ({submissions.length})
        </h2>

        {isLoading ? (
          <p className="mt-4 text-sm" style={{ color: MUTED }}>
            Loading…
          </p>
        ) : submissions.length === 0 ? (
          <p className="mt-4 rounded-xl bg-cc-bg p-4 text-sm font-medium" style={{ color: MUTED }}>
            No pending travel expense submissions.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {submissions.map((sub: TravelSubmission) => (
              <li key={sub.id} className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black" style={{ color: TEXT }}>
                      {sub.worker_name}
                    </p>
                    <p className="text-xs" style={{ color: MUTED }}>
                      Submitted {formatDate(sub.submitted_at)} · {formatAud(sub.total_amount_cents)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1 bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                      disabled={actionMut.isPending}
                      onClick={() => actionMut.mutate({ id: sub.id, approve: true })}
                    >
                      <Check size={14} />
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1 font-bold"
                      disabled={actionMut.isPending}
                      onClick={() => setRejectId(sub.id)}
                    >
                      <X size={14} />
                      Reject
                    </Button>
                  </div>
                </div>

                <ul className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: BORDER }}>
                  {(sub.expenses || []).map((exp) => (
                    <li key={exp.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 capitalize" style={{ color: TEXT }}>
                        {exp.expense_type === "mileage" ? <Car size={14} /> : <Bus size={14} />}
                        {exp.expense_type}
                        {exp.claimed_km != null ? ` · ${exp.claimed_km} km` : ""}
                        {exp.transit_type ? ` · ${exp.transit_type}` : ""}
                      </span>
                      <span className="font-bold">{formatAud(exp.amount_cents)}</span>
                    </li>
                  ))}
                </ul>

                {rejectId === sub.id && (
                  <div className="mt-3 space-y-2 rounded-xl bg-red-50 p-3">
                    <Label htmlFor={`reject-${sub.id}`} className="text-xs font-bold text-red-800">
                      Rejection reason
                    </Label>
                    <Textarea
                      id={`reject-${sub.id}`}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Explain why this claim is rejected…"
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
                        Confirm reject
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRejectId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
