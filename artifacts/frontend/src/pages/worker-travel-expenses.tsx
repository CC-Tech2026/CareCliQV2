import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Car, ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionInfo } from "@/components/ui/section-info";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  downloadTravelTaxCsv,
  getRejectedTravelExpenses,
  getTravelDrafts,
  getTravelRate,
  getTravelSummary,
  requestTravelCorrection,
  submitTravelExpenses,
  type TravelExpense,
} from "@/services/travelExpenseService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

function formatAud(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso?: string | null) {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ExpenseIcon({ type }: { type: string }) {
  return type === "mileage" ? <Car size={16} style={{ color: PLUM }} /> : <Bus size={16} style={{ color: PLUM }} />;
}

function travelStatusLabel(status: string, translate: (key: string) => string): string {
  if (status === "submitted") return translate("travel.status.pending");
  if (status === "approved") return translate("travel.status.approved");
  if (status === "paid") return translate("travel.status.paid");
  if (status === "rejected") return translate("travel.status.rejected");
  return status;
}

function ClaimDetailRow({ item }: { item: TravelExpense }) {
  const { translate, translateParams } = useAccessibility();

  const statusLabel = travelStatusLabel(item.status, translate);

  const expenseTypeLabel =
    item.expense_type === "mileage"
      ? translate("travel.mileage")
      : item.expense_type === "transit"
        ? translate("travel.transit")
        : item.expense_type;

  return (
    <li className="rounded-lg border px-3 py-3" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ExpenseIcon type={item.expense_type} />
          <div>
            <p className="text-sm font-bold" style={{ color: TEXT }}>
              {expenseTypeLabel}
              {item.claimed_km != null ? ` · ${translateParams("travel.km", { km: String(item.claimed_km) })}` : ""}
              {item.transit_type ? ` · ${item.transit_type}` : ""}
            </p>
            <p className="text-xs" style={{ color: MUTED }}>
              {translateParams("travel.shiftPrefix", { id: String(item.shift_id).slice(0, 8) })} · {statusLabel}
            </p>
          </div>
        </div>
        <p className="text-sm font-black" style={{ color: TEXT }}>
          {formatAud(item.amount_cents)}
        </p>
      </div>
      <dl className="mt-2 grid gap-1 text-xs" style={{ color: MUTED }}>
        <div className="flex justify-between gap-4">
          <dt>{translate("travel.submitted")}</dt>
          <dd className="font-semibold text-cc-text">{formatDate(item.submitted_at)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{translate("travel.approved")}</dt>
          <dd className="font-semibold text-cc-text">{formatDate(item.approved_at)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{translate("travel.paid")}</dt>
          <dd className="font-semibold text-cc-text">{formatDate(item.paid_at)}</dd>
        </div>
        {item.status === "rejected" && item.rejection_reason && (
          <div className="mt-1 rounded-md bg-red-50 px-2 py-1.5 text-red-700">
            <span className="font-bold">{translate("travel.rejectedPrefix")} </span>
            {item.rejection_reason}
          </div>
        )}
      </dl>
    </li>
  );
}

function CorrectionCard({ item, onDone }: { item: TravelExpense; onDone: () => void }) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [km, setKm] = useState(item.claimed_km != null ? String(item.claimed_km) : "");
  const [amount, setAmount] = useState(
    item.amount_cents != null ? (item.amount_cents / 100).toFixed(2) : "",
  );

  const expenseTypeLabel =
    item.expense_type === "mileage"
      ? translate("travel.mileage")
      : item.expense_type === "transit"
        ? translate("travel.transit")
        : item.expense_type;

  const mut = useMutation({
    mutationFn: () => {
      if (item.expense_type === "mileage") {
        return requestTravelCorrection(item.id, { claimed_km: Number(km) });
      }
      return requestTravelCorrection(item.id, {
        amount_cents: Math.round(Number(amount) * 100),
        transit_type: item.transit_type ?? "other",
      });
    },
    onSuccess: () => {
      toast({
        title: translate("travel.toast.correctionCreated"),
        description: translate("travel.toast.correctionCreatedDesc"),
      });
      onDone();
    },
    onError: (e: Error) =>
      toast({ title: translate("travel.toast.correctionFailed"), description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <p className="text-sm font-bold text-cc-text">
        {expenseTypeLabel} · {formatAud(item.amount_cents)}
      </p>
      {item.rejection_reason && (
        <p className="mt-1 text-xs text-red-700">{item.rejection_reason}</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        {item.expense_type === "mileage" ? (
          <div className="flex-1">
            <Label className="text-xs text-cc-muted">{translate("travel.correctedDistance")}</Label>
            <Input value={km} onChange={(e) => setKm(e.target.value)} className="mt-1" type="number" step={0.1} />
          </div>
        ) : (
          <div className="flex-1">
            <Label className="text-xs text-cc-muted">{translate("travel.correctedAmount")}</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" type="number" step={0.01} />
          </div>
        )}
        <Button
          type="button"
          size="sm"
          className="gap-1 font-bold text-white"
          style={{ background: PLUM }}
          disabled={mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
          {translate("travel.correction")}
        </Button>
      </div>
    </div>
  );
}

export default function WorkerTravelExpenses() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const { data: rate } = useOrgQuery(["worker", "travel-rate"], { queryFn: getTravelRate });
  const { data: draftsData, isLoading: draftsLoading } = useOrgQuery(["worker", "travel-drafts"], {
    queryFn: getTravelDrafts,
  });
  const { data: summaryData, isLoading: summaryLoading } = useOrgQuery(["worker", "travel-summary"], {
    queryFn: getTravelSummary,
  });
  const { data: rejectedData, refetch: refetchRejected } = useQuery({
    queryKey: ["worker", "travel-rejected"],
    queryFn: getRejectedTravelExpenses,
  });

  const drafts = draftsData?.drafts ?? [];
  const rejected = rejectedData?.items ?? [];
  const draftTotal = useMemo(
    () => drafts.reduce((sum, d) => sum + (d.amount_cents || 0), 0),
    [drafts],
  );

  const submitMut = useMutation({
    mutationFn: submitTravelExpenses,
    onSuccess: (res) => {
      toast({
        title: translate("travel.toast.claimsSubmitted"),
        description: translateParams("travel.toast.claimsSubmittedDesc", {
          count: String(res.expense_count),
          total: formatAud(res.total_amount_cents),
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["worker", "travel-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["worker", "travel-summary"] });
      setConfirmOpen(false);
    },
    onError: (e: Error) =>
      toast({ title: translate("travel.toast.submissionFailed"), description: e.message, variant: "destructive" }),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["worker", "travel-drafts"] });
    void refetchRejected();
  };

  const expenseTypeLabel = (type: string) =>
    type === "mileage" ? translate("travel.mileage") : type === "transit" ? translate("travel.transit") : type;

  return (
    <div className="w-full space-y-6 pb-24 text-safe">
      <header>
        <p className="text-xs font-black uppercase tracking-wider" style={{ color: PLUM }}>
          {translate("travel.eyebrow")}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-black" style={{ color: TEXT }}>
          {translate("travel.title")}
          <SectionInfo text={translate("travel.subtitle")} />
        </h1>
        {rate?.rate_display && (
          <p className="mt-3 inline-flex rounded-full bg-cc-bg px-3 py-1 text-sm font-bold" style={{ color: TEXT }}>
            {rate.rate_display}
          </p>
        )}
      </header>

      {rejected.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/30 p-5 shadow-sm">
          <h2 className="text-sm font-black text-cc-text">{translate("travel.rejectedTitle")}</h2>
          <p className="mt-1 text-xs text-cc-muted">{translate("travel.rejectedHint")}</p>
          <div className="mt-4 space-y-3">
            {rejected.map((item) => (
              <CorrectionCard key={item.id} item={item} onDone={invalidateAll} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-card p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black" style={{ color: TEXT }}>
              {translate("travel.unsubmitted")}
            </h2>
            <p className="text-xs font-medium" style={{ color: MUTED }}>
              {translateParams("travel.draftSummary", {
                count: String(drafts.length),
                total: formatAud(draftTotal),
              })}
            </p>
          </div>
          <Button
            type="button"
            disabled={!drafts.length || submitMut.isPending}
            onClick={() => setConfirmOpen(true)}
            className="gap-2 font-black text-white"
            style={{ background: PLUM }}
          >
            <Send size={16} />
            {translate("travel.submit")}
          </Button>
        </div>

        {draftsLoading ? (
          <p className="mt-4 text-sm" style={{ color: MUTED }}>
            {translate("travel.loadingDrafts")}
          </p>
        ) : drafts.length === 0 ? (
          <p className="mt-4 rounded-xl bg-cc-bg p-4 text-sm font-medium" style={{ color: MUTED }}>
            {translate("travel.noDrafts")}
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {drafts.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between rounded-xl border px-4 py-3"
                style={{ borderColor: BORDER }}
              >
                <div className="flex items-center gap-2">
                  <ExpenseIcon type={item.expense_type} />
                  <div>
                    <p className="text-sm font-bold" style={{ color: TEXT }}>
                      {expenseTypeLabel(item.expense_type)}
                      {item.claimed_km != null ? ` · ${translateParams("travel.km", { km: String(item.claimed_km) })}` : ""}
                      {item.transit_type ? ` · ${item.transit_type}` : ""}
                    </p>
                    <p className="text-xs" style={{ color: MUTED }}>
                      {translateParams("travel.shiftPrefix", { id: String(item.shift_id).slice(0, 8) })}
                      {item.correction_of_id ? ` · ${translate("travel.correctionLabel")}` : ""}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-black" style={{ color: TEXT }}>
                  {formatAud(item.amount_cents)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-black" style={{ color: TEXT }}>
            {translate("travel.monthly")}
          </h2>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => downloadTravelTaxCsv()}>
            <Download size={14} />
            {translate("travel.downloadTax")}
          </Button>
        </div>

        {summaryLoading ? (
          <p className="text-sm" style={{ color: MUTED }}>
            {translate("travel.loadingHistory")}
          </p>
        ) : !summaryData?.months?.length ? (
          <p className="rounded-xl bg-cc-bg p-4 text-sm font-medium" style={{ color: MUTED }}>
            {translate("travel.noSubmitted")}
          </p>
        ) : (
          <div className="space-y-2">
            {summaryData.months.map((month) => {
              const open = expandedMonth === month.month;
              return (
                <div key={month.month} className="rounded-xl border" style={{ borderColor: BORDER }}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    onClick={() => setExpandedMonth(open ? null : month.month)}
                  >
                    {open ? <ChevronDown size={16} color={PLUM} /> : <ChevronRight size={16} color={MUTED} />}
                    <div className="flex-1">
                      <p className="text-sm font-black" style={{ color: TEXT }}>
                        {month.month}
                      </p>
                      <p className="text-xs" style={{ color: MUTED }}>
                        {translateParams("travel.claimedSummary", {
                          claimed: formatAud(month.claimed_cents),
                          approved: formatAud(month.approved_cents),
                          paid: formatAud(month.paid_cents),
                        })}
                      </p>
                    </div>
                  </button>
                  {open && (
                    <ul className="space-y-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
                      {(month.items || []).map((item) => (
                        <ClaimDetailRow key={item.id} item={item} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{translate("travel.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translateParams("travel.confirmDesc", {
                count: String(drafts.length),
                total: formatAud(draftTotal),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{translate("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => submitMut.mutate()}
              disabled={submitMut.isPending}
              className="gap-2"
            >
              {submitMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {translate("travel.confirmSubmit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
