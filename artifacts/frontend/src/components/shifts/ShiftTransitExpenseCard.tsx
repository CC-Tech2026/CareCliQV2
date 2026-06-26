import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import {
  getShiftTransitDraft,
  saveTransitExpense,
} from "@/services/travelExpenseService";

const RECEIPT_THRESHOLD_AUD = 10;

const TRANSIT_TYPES = [
  { id: "bus", label: "Bus" },
  { id: "train", label: "Train" },
  { id: "tram", label: "Tram" },
  { id: "ferry", label: "Ferry" },
  { id: "other", label: "Other" },
] as const;

type Props = {
  shiftId: string;
  shiftStatus?: string;
};

export function ShiftTransitExpenseCard({ shiftId, shiftStatus }: Props) {
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
        throw new Error("Enter a valid amount in AUD.");
      }
      const amount_cents = Math.round(parsed * 100);
      if (amount_cents > RECEIPT_THRESHOLD_AUD * 100 && !receipt && !savedDraft?.receipt_storage_path) {
        throw new Error("Receipt photo is required for claims over $10.");
      }
      return saveTransitExpense(shiftId, {
        amount_cents,
        transit_type: transitType,
        receipt: receipt ?? undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Transit claim saved", description: "Added to your draft travel claims." });
      setReceipt(null);
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["worker", "transit-draft", shiftId] });
      queryClient.invalidateQueries({ queryKey: ["worker", "travel-drafts"] });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save transit claim", description: e.message, variant: "destructive" }),
  });

  if (shiftStatus === "cancelled") return null;

  const parsedAmount = Number(amountAud);
  const receiptRequired =
    !Number.isNaN(parsedAmount) && parsedAmount > RECEIPT_THRESHOLD_AUD;

  return (
    <section className="rounded-2xl border bg-cc-surface p-4 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-center gap-2">
        <Bus size={18} style={{ color: PLUM }} />
        <h3 className="text-sm font-black text-cc-text">Public transit</h3>
      </div>

      {isLoading ? (
        <p className="mt-3 text-sm text-cc-muted">Loading…</p>
      ) : (
        <>
          {savedDraft && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={14} />
              Transit claim saved (${(savedDraft.amount_cents / 100).toFixed(2)} · {savedDraft.transit_type})
            </p>
          )}

          <div className="mt-3 space-y-3">
            <div>
              <Label htmlFor={`transit-type-${shiftId}`} className="text-xs text-cc-muted">
                Transit type
              </Label>
              <select
                id={`transit-type-${shiftId}`}
                value={transitType}
                onChange={(e) => setTransitType(e.target.value)}
                className="mt-1 flex min-h-[44px] w-full rounded-xl border bg-cc-surface px-3 text-sm font-semibold text-cc-text"
                style={{ borderColor: BORDER }}
              >
                {TRANSIT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor={`transit-amount-${shiftId}`} className="text-xs text-cc-muted">
                Amount (AUD)
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
                Receipt photo{receiptRequired ? " (required over $10)" : " (optional)"}
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
                <p className="mt-1 text-xs text-cc-muted">Receipt already on file for this draft.</p>
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
                  {savedDraft ? "Update transit claim" : "Save transit claim"}
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
