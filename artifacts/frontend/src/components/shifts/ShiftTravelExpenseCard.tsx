import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import {
  getShiftMileageEstimate,
  saveMileageExpense,
  type MileageEstimate,
} from "@/services/travelExpenseService";
import { useAccessibility } from "@/contexts/AccessibilityContext";


const REASON_KEYS: Record<string, string> = {
  missing_destination: "shift.travel.missingDestination",
  maps_api_not_configured: "shift.travel.mapsNotConfigured",
  maps_request_failed: "shift.travel.mapsFailed",
};

export type MileageDraftState = {
  claimedKm: number | null;
  calculatedKm: number | null;
  isOverridden: boolean;
};

type Props = {
  shiftId: string;
  shiftStatus?: string;
  clockedInAt?: string | null;
  mileageDraftRef?: MutableRefObject<MileageDraftState>;
};

function kmEqual(a: number | null | undefined, b: number | null | undefined) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.05;
}

export function ShiftTravelExpenseCard({
  shiftId,
  shiftStatus,
  clockedInAt,
  mileageDraftRef,
}: Props) {
  const { translate, translateParams } = useAccessibility();
  const queryClient = useQueryClient();
  const [claimedKm, setClaimedKm] = useState("");
  const [isOverridden, setIsOverridden] = useState(false);
  const autoSavedRef = useRef(false);
  const postClockInSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userEditedRef = useRef(false);
  const initializedKeyRef = useRef<string | null>(null);

  const { data: estimate, isLoading } = useQuery<MileageEstimate>({
    queryKey: ["worker", "mileage-estimate", shiftId, clockedInAt ?? "pending"],
    queryFn: () => getShiftMileageEstimate(shiftId),
    enabled: Boolean(shiftId),
  });

  const savedDraft = estimate?.draft_mileage;
  const calculatedKm = estimate?.distance_km ?? savedDraft?.calculated_km ?? null;
  const isClockedIn = Boolean(clockedInAt);

  useEffect(() => {
    userEditedRef.current = false;
    initializedKeyRef.current = null;
    autoSavedRef.current = false;
  }, [shiftId]);

  useEffect(() => {
    if (userEditedRef.current) return;

    const initKey = savedDraft?.id ?? `estimate-${estimate?.distance_km ?? "none"}`;
    if (initializedKeyRef.current === initKey) return;

    if (savedDraft?.claimed_km != null) {
      const saved = Number(savedDraft.claimed_km);
      setClaimedKm(String(saved));
      setIsOverridden(
        savedDraft.calculated_km != null && !kmEqual(saved, Number(savedDraft.calculated_km)),
      );
      initializedKeyRef.current = initKey;
      return;
    }
    if (estimate?.distance_km != null) {
      setClaimedKm(String(estimate.distance_km));
      setIsOverridden(false);
      initializedKeyRef.current = initKey;
    }
  }, [savedDraft?.id, savedDraft?.claimed_km, savedDraft?.calculated_km, estimate?.distance_km]);

  useEffect(() => {
    if (!mileageDraftRef) return;
    const parsed = claimedKm.trim() ? Number(claimedKm) : null;
    mileageDraftRef.current = {
      claimedKm: parsed != null && !Number.isNaN(parsed) && parsed > 0 ? parsed : null,
      calculatedKm: calculatedKm != null ? Number(calculatedKm) : null,
      isOverridden,
    };
  }, [claimedKm, calculatedKm, isOverridden, mileageDraftRef]);

  useEffect(() => {
    if (!isClockedIn || isOverridden || savedDraft || autoSavedRef.current) return;
    if (!estimate?.available || estimate.distance_km == null) return;

    autoSavedRef.current = true;
    void saveMileageExpense(shiftId, estimate.distance_km, estimate.distance_km)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["worker", "mileage-estimate", shiftId] });
        queryClient.invalidateQueries({ queryKey: ["worker", "travel-drafts"] });
      })
      .catch(() => {
        autoSavedRef.current = false;
      });
  }, [isClockedIn, isOverridden, savedDraft, estimate?.available, estimate?.distance_km, shiftId, queryClient]);

  useEffect(() => {
    if (!isClockedIn || !isOverridden) return;
    const parsed = Number(claimedKm);
    if (!claimedKm.trim() || Number.isNaN(parsed) || parsed <= 0) return;

    if (postClockInSaveRef.current) clearTimeout(postClockInSaveRef.current);
    postClockInSaveRef.current = setTimeout(() => {
      void saveMileageExpense(
        shiftId,
        parsed,
        calculatedKm != null ? Number(calculatedKm) : undefined,
      )
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["worker", "mileage-estimate", shiftId] });
          queryClient.invalidateQueries({ queryKey: ["worker", "travel-drafts"] });
        })
        .catch(() => undefined);
    }, 600);

    return () => {
      if (postClockInSaveRef.current) clearTimeout(postClockInSaveRef.current);
    };
  }, [claimedKm, isClockedIn, isOverridden, calculatedKm, shiftId, queryClient]);

  const handleKmChange = (value: string) => {
    userEditedRef.current = true;
    setClaimedKm(value);
    const parsed = value.trim() ? Number(value) : null;
    const overridden =
      parsed != null &&
      !Number.isNaN(parsed) &&
      calculatedKm != null &&
      !kmEqual(parsed, Number(calculatedKm));
    setIsOverridden(overridden || (parsed != null && calculatedKm == null && value.trim() !== ""));
  };

  if (shiftStatus === "cancelled") return null;

  const hasSavedMileage = Boolean(savedDraft);

  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-sm"
      style={{ borderColor: BORDER }}
      data-tutorial="shift-travel-mileage"
    >
      <div className="flex items-center gap-2">
        <Car size={18} style={{ color: PLUM }} />
        <h3 className="text-sm font-black text-cc-text">{translate("shift.travel.title")}</h3>
      </div>

      {isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-cc-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {translate("shift.travel.calculating")}
        </p>
      ) : !estimate?.home_address_set ? (
        <p className="mt-3 text-sm text-cc-muted">
          {translate("shift.travel.setHome").split("{link}")[0]}
          <Link href="/worker/profile" className="font-bold underline" style={{ color: PLUM }}>
            {translate("shift.travel.myProfile")}
          </Link>
          {translate("shift.travel.setHome").split("{link}")[1] ?? ""}
        </p>
      ) : (
        <>
          {hasSavedMileage && isClockedIn && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={14} />
              {translate("shift.travel.autoSaved")}
            </p>
          )}
          {!isClockedIn && isOverridden && (
            <p className="mt-2 text-xs font-semibold text-cc-plum">
              {translate("shift.travel.customOnClockIn")}
            </p>
          )}

          <p className="mt-2 text-xs font-bold text-cc-muted">{estimate.rate_display}</p>

          {estimate.available && estimate.distance_km != null && (
            <p className="mt-1 text-sm font-semibold text-cc-text">
              {translateParams("shift.travel.estimatedDistance", { km: String(estimate.distance_km) })}
              {(estimate.estimated_amount_cents ?? savedDraft?.amount_cents) != null &&
                translateParams("shift.travel.estimatedAmount", {
                  amount: ((estimate.estimated_amount_cents ?? savedDraft?.amount_cents ?? 0) / 100).toFixed(2),
                })}
            </p>
          )}

          {!estimate.available && estimate.reason && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              {translate(REASON_KEYS[estimate.reason] ?? "shift.travel.calcFailed")}
            </p>
          )}

          <div className="mt-3 space-y-2">
            <Label htmlFor={`mileage-${shiftId}`} className="text-xs text-cc-muted">
              {translate("shift.travel.distanceKm")}
            </Label>
            <Input
              id={`mileage-${shiftId}`}
              type="number"
              min={0}
              step={0.1}
              value={claimedKm}
              onChange={(e) => handleKmChange(e.target.value)}
              className="min-h-[44px]"
            />
            {!isClockedIn && (
              <p className="text-xs text-cc-muted">
                {isOverridden
                  ? translate("shift.travel.customSavesClockIn")
                  : translate("shift.travel.autoSavesClockIn")}
              </p>
            )}
            {isClockedIn && isOverridden && (
              <p className="text-xs text-cc-muted">{translate("shift.travel.changesAutoSave")}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
