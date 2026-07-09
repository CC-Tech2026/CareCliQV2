import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { BORDER, PLUM } from "@/lib/shift-utils";
import {
  getShiftTransitDraft,
  saveTransitExpense,
} from "@/services/travelExpenseService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const RECEIPT_THRESHOLD_AUD = 10;

const TRANSIT_TYPE_KEYS = [
  { id: "bus", labelKey: "shift.transit.type.bus" },
  { id: "train", labelKey: "shift.transit.type.train" },
  { id: "tram", labelKey: "shift.transit.type.tram" },
  { id: "ferry", labelKey: "shift.transit.type.ferry" },
  { id: "other", labelKey: "shift.transit.type.other" },
] as const;

type Props = {
  shiftId: string;
  shiftStatus?: string;
};

export function ShiftTransitExpenseCard({ shiftId, shiftStatus }: Props) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [amountAud, setAmountAud] = useState("");
  const [transitType, setTransitType] = useState<string>("bus");
  const [receipt, setReceipt] = useState<File | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["worker", "transit-draft", shiftId],
    queryFn: () => getShiftTransitDraft(shiftId),
    enabled: Boolean(shiftId),
  });

  const savedDraft = data?.draft_transit;

  useEffect(() => {
    if (!savedDraft || amountAud) return;
    if (savedDraft.amount_cents != null) {
      setAmountAud((savedDraft.amount_cents / 100).toFixed(2));
    }
    if (savedDraft.transit_type) setTransitType(savedDraft.transit_type);
  }, [savedDraft, amountAud]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsed = Number(amountAud);
      if (!amountAud.trim() || Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(translate("shift.transit.invalidAmount"));
      }
      const amount_cents = Math.round(parsed * 100);
      if (amount_cents > RECEIPT_THRESHOLD_AUD * 100 && !receipt && !savedDraft?.receipt_storage_path) {
        throw new Error(translate("shift.transit.receiptRequiredError"));
      }
      return saveTransitExpense(shiftId, {
        amount_cents,
        transit_type: transitType,
        receipt: receipt ?? undefined,
      });
    },
    onSuccess: () => {
      toast({ title: translate("shift.transit.toastSaved"), description: translate("shift.transit.toastSavedDesc") });
      setReceipt(null);
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["worker", "transit-draft", shiftId] });
      queryClient.invalidateQueries({ queryKey: ["worker", "travel-drafts"] });
    },
    onError: (e: Error) =>
      toast({ title: translate("shift.transit.toastFailed"), description: e.message, variant: "destructive" }),
  });

  if (shiftStatus === "cancelled") return null;

  const parsedAmount = Number(amountAud);
  const receiptRequired =
    !Number.isNaN(parsedAmount) && parsedAmount > RECEIPT_THRESHOLD_AUD;

  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-sm"
      style={{ borderColor: BORDER }}
      data-tutorial="shift-travel-transit"
    >
      <div className="flex items-center gap-2">
        <Bus size={18} style={{ color: PLUM }} />
        <h3 className="text-sm font-black text-cc-text">{translate("shift.transit.title")}</h3>
      </div>

      {isLoading ? (
        <p className="mt-3 text-sm text-cc-muted">{translate("common.loading")}</p>
      ) : (
        <>
          {savedDraft && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={14} />
              {translateParams("shift.transit.saved", {
                amount: (savedDraft.amount_cents / 100).toFixed(2),
                type: savedDraft.transit_type,
              })}
            </p>
          )}

          <div className="mt-3 space-y-3">
            <div>
              <Label htmlFor={`transit-type-${shiftId}`} className="text-xs text-cc-muted">
                {translate("shift.transit.type")}
              </Label>
              <select
                id={`transit-type-${shiftId}`}
                value={transitType}
                onChange={(e) => setTransitType(e.target.value)}
                className="mt-1 flex min-h-[44px] w-full rounded-xl border bg-card px-3 text-sm font-semibold text-cc-text"
                style={{ borderColor: BORDER }}
              >
                {TRANSIT_TYPE_KEYS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {translate(t.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor={`transit-amount-${shiftId}`} className="text-xs text-cc-muted">
                {translate("shift.transit.amount")}
              </Label>
              <Input
                id={`transit-amount-${shiftId}`}
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={amountAud}
                onChange={(e) => setAmountAud(e.target.value)}
                className="mt-1 min-h-[44px]"
              />
            </div>

            <div>
              <Label htmlFor={`transit-receipt-${shiftId}`} className="text-xs text-cc-muted">
                {receiptRequired ? translate("shift.transit.receiptRequired") : translate("shift.transit.receiptOptional")}
              </Label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  id={`transit-receipt-${shiftId}`}
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="min-h-[44px]"
                  onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                />
              </div>
              {savedDraft?.receipt_storage_path && !receipt && (
                <p className="mt-1 text-xs text-cc-muted">{translate("shift.transit.receiptOnFile")}</p>
              )}
            </div>

            <Button
              type="button"
              className="min-h-[44px] w-full gap-2 font-black text-white sm:w-auto"
              style={{ background: PLUM }}
              disabled={saveMut.isPending || !amountAud}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Upload size={16} />
                  {savedDraft ? translate("shift.transit.update") : translate("shift.transit.save")}
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
