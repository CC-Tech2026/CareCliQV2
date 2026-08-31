import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Loader2, Pill } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  attachMedicationReason,
  getMedicationChecklist,
  getPrnMedications,
  logMedicationAdministration,
  logMedicationEffect,
  MEDICATION_ERROR_SUBTYPES,
  MEDICATION_REASON_CODES,
  uploadMedicationVerificationPhoto,
  type MedicationAdministrationAction,
  type MedicationChecklistItem,
  type MedicationErrorSubtype,
  type PrnMedication,
  type PrnPendingEffect,
} from "@/services/workerMedicationService";

type Props = {
  shiftId: string;
  disabled?: boolean;
  compact?: boolean;
};

const REASON_LABELS: Record<string, string> = {
  participant_asleep: "Participant was asleep",
  worker_delayed: "Worker was delayed",
  participant_off_site: "Participant was off site",
  participant_requested: "Participant requested it early",
  schedule_conflict: "Schedule conflict",
  verbal: "Verbal refusal",
  behavioural: "Behavioural",
  communication_device: "Via communication device",
  clinical_direction: "Clinical direction",
  other: "Other",
};

const ERROR_SUBTYPE_LABELS: Record<MedicationErrorSubtype, string> = {
  wrong_medication: "Wrong medication",
  wrong_dose: "Wrong dose",
  wrong_participant: "Wrong participant",
  wrong_route: "Wrong route",
  other: "Other",
};

function formatTimeLabel(value: string) {
  try {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return value;
  }
}

function dueMeta(item: MedicationChecklistItem) {
  const outcome = item.administration?.outcome ?? item.due_status;
  if (outcome === "given_on_time") return { label: "Given", tone: "bg-emerald-50 text-emerald-700" };
  if (outcome === "given_late") return { label: "Given late", tone: "bg-amber-50 text-amber-700" };
  if (outcome === "given_early") return { label: "Given early", tone: "bg-amber-50 text-amber-700" };
  if (outcome === "refused") return { label: "Refused", tone: "bg-red-50 text-red-700" };
  if (outcome === "missed") return { label: "Missed", tone: "bg-red-50 text-red-700" };
  if (outcome === "withheld") return { label: "Withheld", tone: "bg-amber-50 text-amber-700" };
  if (outcome === "overdue") return { label: "Overdue", tone: "bg-red-50 text-red-700" };
  if (outcome === "due_now") return { label: "Due now", tone: "bg-blue-50 text-blue-700" };
  return { label: "Upcoming", tone: "bg-slate-100 text-slate-600" };
}

function cardClass(compact?: boolean) {
  return compact
    ? "mx-3 mt-3 overflow-hidden rounded-2xl border bg-[var(--wm-surface,#fff)]"
    : "overflow-hidden rounded-2xl border border-cc-border bg-card shadow-sm";
}

export function ShiftMedicationPanel({ shiftId, disabled, compact = false }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const photoRef = useRef<HTMLInputElement>(null);
  const prnPhotoRef = useRef<HTMLInputElement>(null);
  const [activeItem, setActiveItem] = useState<MedicationChecklistItem | null>(null);
  const [reasonAction, setReasonAction] = useState<MedicationAdministrationAction | null>(null);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [followUp, setFollowUp] = useState<{ administrationId: string; outcome: "given_late" | "given_early" } | null>(null);
  const [verificationPhotoUrl, setVerificationPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [doseTarget, setDoseTarget] = useState<PrnMedication | null>(null);
  const [doseReason, setDoseReason] = useState("");
  const [doseGiven, setDoseGiven] = useState("");
  const [prnPhotoUrl, setPrnPhotoUrl] = useState<string | null>(null);
  const [uploadingPrnPhoto, setUploadingPrnPhoto] = useState(false);
  const [confirmPrnOverride, setConfirmPrnOverride] = useState(false);
  const [effectTarget, setEffectTarget] = useState<PrnPendingEffect | null>(null);
  const [effectText, setEffectText] = useState("");

  const checklistQuery = useQuery({
    queryKey: ["worker", "medication-checklist", shiftId],
    queryFn: () => getMedicationChecklist(shiftId),
    enabled: !!shiftId,
    refetchInterval: 5 * 60 * 1000,
  });
  const prnQuery = useQuery({
    queryKey: ["worker", "prn-medications", shiftId],
    queryFn: () => getPrnMedications(shiftId),
    enabled: !!shiftId,
    refetchInterval: 5 * 60 * 1000,
  });

  const checklist = checklistQuery.data?.checklist ?? [];
  const prnMedications = prnQuery.data?.medications ?? [];
  const pendingEffects = prnQuery.data?.pending_effects ?? [];

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["worker", "medication-checklist", shiftId] }),
      queryClient.invalidateQueries({ queryKey: ["worker", "prn-medications", shiftId] }),
    ]);
  };

  const resetChecklist = () => {
    setActiveItem(null);
    setReasonAction(null);
    setReasonCode(null);
    setNoteText("");
    setVerificationPhotoUrl(null);
    setUploadingPhoto(false);
  };

  const resetPrn = () => {
    setDoseTarget(null);
    setDoseReason("");
    setDoseGiven("");
    setPrnPhotoUrl(null);
    setUploadingPrnPhoto(false);
    setConfirmPrnOverride(false);
  };

  const scheduleMutation = useMutation({
    mutationFn: ({
      item,
      action,
      reason_code,
      notes,
      error_subtype,
      verification_photo_url,
    }: {
      item: MedicationChecklistItem;
      action: MedicationAdministrationAction;
      reason_code?: string;
      notes?: string;
      error_subtype?: MedicationErrorSubtype;
      verification_photo_url?: string;
    }) =>
      logMedicationAdministration(shiftId, item.medication_id, {
        scheduled_time: item.scheduled_time,
        action,
        reason_code,
        notes: notes || undefined,
        error_subtype,
        verification_photo_url,
      }),
    onSuccess: async (result) => {
      await invalidate();
      if (result.outcome === "given_late" || result.outcome === "given_early") {
        toast({
          title: "Medication logged",
          description: result.outcome === "given_late" ? "Add why the dose was late." : "Add why the dose was early.",
        });
        resetChecklist();
        setFollowUp({ administrationId: result.id, outcome: result.outcome });
        return;
      }
      toast({ title: "Medication logged" });
      resetChecklist();
    },
    onError: (error: Error) =>
      toast({ title: "Could not log medication", description: error.message, variant: "destructive" }),
  });

  const followUpMutation = useMutation({
    mutationFn: () =>
      attachMedicationReason(followUp!.administrationId, reasonCode ?? undefined, noteText.trim() || undefined),
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Reason recorded" });
      setFollowUp(null);
      setReasonCode(null);
      setNoteText("");
    },
    onError: (error: Error) =>
      toast({ title: "Could not save reason", description: error.message, variant: "destructive" }),
  });

  const prnDoseMutation = useMutation({
    mutationFn: () => {
      if (!doseTarget) throw new Error("No medication selected.");
      return logMedicationAdministration(shiftId, doseTarget.id, {
        action: "given",
        prn_reason: doseReason.trim(),
        dose_given: doseGiven.trim() || undefined,
        verification_photo_url: prnPhotoUrl ?? undefined,
      });
    },
    onSuccess: async () => {
      await invalidate();
      toast({ title: "PRN dose logged" });
      resetPrn();
    },
    onError: (error: Error) =>
      toast({ title: "Could not log PRN dose", description: error.message, variant: "destructive" }),
  });

  const effectMutation = useMutation({
    mutationFn: () => {
      if (!effectTarget) throw new Error("No administration selected.");
      return logMedicationEffect(effectTarget.id, effectText.trim());
    },
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Effect recorded" });
      setEffectTarget(null);
      setEffectText("");
    },
    onError: (error: Error) =>
      toast({ title: "Could not record effect", description: error.message, variant: "destructive" }),
  });

  const uploadPhoto = async (file: File | null, medicationId: string, target: "scheduled" | "prn") => {
    if (!file) return;
    if (target === "scheduled") setUploadingPhoto(true);
    else setUploadingPrnPhoto(true);
    try {
      const result = await uploadMedicationVerificationPhoto(shiftId, medicationId, file);
      if (target === "scheduled") setVerificationPhotoUrl(result.url);
      else setPrnPhotoUrl(result.url);
      toast({ title: "Verification photo uploaded" });
    } catch (error) {
      toast({
        title: "Could not upload verification photo",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      if (target === "scheduled") setUploadingPhoto(false);
      else setUploadingPrnPhoto(false);
    }
  };

  const submitScheduledAction = () => {
    if (!activeItem || !reasonAction) return;
    if (reasonAction === "given") {
      if (activeItem.is_high_risk && !verificationPhotoUrl) {
        toast({ title: "Verification photo required", description: "Upload a photo before logging this dose.", variant: "destructive" });
        return;
      }
      scheduleMutation.mutate({
        item: activeItem,
        action: "given",
        verification_photo_url: verificationPhotoUrl ?? undefined,
      });
      return;
    }
    if (reasonAction === "administration_error") {
      if (!reasonCode) {
        toast({ title: "Pick what went wrong", variant: "destructive" });
        return;
      }
      if (reasonCode === "other" && !noteText.trim()) {
        toast({ title: "A note is required for 'Other'", variant: "destructive" });
        return;
      }
      scheduleMutation.mutate({
        item: activeItem,
        action: reasonAction,
        error_subtype: reasonCode as MedicationErrorSubtype,
        notes: noteText.trim() || undefined,
      });
      return;
    }
    if (!noteText.trim()) {
      toast({ title: "A note is required for this outcome", variant: "destructive" });
      return;
    }
    scheduleMutation.mutate({
      item: activeItem,
      action: reasonAction,
      reason_code: reasonCode ?? undefined,
      notes: noteText.trim(),
    });
  };

  const submitFollowUp = () => {
    if (!reasonCode && !noteText.trim()) {
      toast({ title: "Pick a reason or add a note", variant: "destructive" });
      return;
    }
    followUpMutation.mutate();
  };

  const submitPrnDose = () => {
    if (!doseTarget) return;
    if (!doseReason.trim()) {
      toast({ title: "Reason for administering is required", variant: "destructive" });
      return;
    }
    if (doseTarget.at_or_over_max && !confirmPrnOverride) {
      toast({ title: "Confirm the PRN override first", variant: "destructive" });
      return;
    }
    if (doseTarget.is_high_risk && !prnPhotoUrl) {
      toast({ title: "Verification photo required", description: "Upload a photo before logging this dose.", variant: "destructive" });
      return;
    }
    prnDoseMutation.mutate();
  };

  const isLoading = checklistQuery.isLoading || prnQuery.isLoading;
  if (!isLoading && checklist.length === 0 && prnMedications.length === 0 && pendingEffects.length === 0) {
    return null;
  }

  const busy =
    scheduleMutation.isPending ||
    followUpMutation.isPending ||
    prnDoseMutation.isPending ||
    effectMutation.isPending;

  const reasonCodes = reasonAction
    ? reasonAction === "administration_error"
      ? MEDICATION_ERROR_SUBTYPES
      : MEDICATION_REASON_CODES[reasonAction as Exclude<MedicationAdministrationAction, "given" | "administration_error">] ?? []
    : followUp
      ? MEDICATION_REASON_CODES[followUp.outcome]
      : [];

  return (
    <>
      <section className={cardClass(compact)} style={compact ? { borderColor: "var(--wm-border, var(--cc-border))" } : undefined}>
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: compact ? "var(--wm-border, var(--cc-border))" : "var(--cc-border)" }}>
          <ClipboardList size={15} />
          <div>
            <p className="text-sm font-black text-cc-text">Medication administration</p>
            <p className="text-xs font-medium text-cc-muted">Scheduled doses and PRN follow-up for this shift.</p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 px-4 py-4 text-sm font-medium text-cc-muted">
            <Loader2 size={16} className="animate-spin" /> Loading medications…
          </div>
        )}

        {!isLoading && (
          <div className="space-y-4 px-4 py-4">
            {checklist.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Pill size={14} className="text-cc-plum" />
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-cc-muted">Scheduled medications</p>
                </div>
                <div className="overflow-hidden rounded-xl border border-cc-border">
                  {checklist.map((item) => {
                    const meta = dueMeta(item);
                    const logged = Boolean(item.administration);
                    return (
                      <button
                        key={`${item.medication_id}-${item.scheduled_time}`}
                        type="button"
                        disabled={logged || disabled || busy}
                        onClick={() => {
                          setActiveItem(item);
                          setReasonAction(null);
                          setReasonCode(null);
                          setNoteText("");
                          setVerificationPhotoUrl(null);
                        }}
                        className="flex w-full items-center justify-between gap-3 border-b border-cc-border px-3 py-3 text-left last:border-b-0 disabled:cursor-default disabled:opacity-100"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-cc-text">
                            {item.name}{item.strength ? ` · ${item.strength}` : ""}
                          </p>
                          <p className="text-xs text-cc-muted">
                            {item.dosage ? `${item.dosage} · ` : ""}{item.route} · {formatTimeLabel(item.scheduled_time)}
                            {item.is_high_risk ? " · high risk" : ""}
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${meta.tone}`}>
                          {meta.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(pendingEffects.length > 0 || prnMedications.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Pill size={14} className="text-cc-plum" />
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-cc-muted">PRN medications</p>
                </div>
                {pendingEffects.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
                    {pendingEffects.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 border-b border-amber-200 px-3 py-3 last:border-b-0">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-amber-900">Effect still needed</p>
                          <p className="truncate text-xs text-amber-800">{item.prn_reason}</p>
                        </div>
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={disabled || busy}
                          onClick={() => {
                            setEffectTarget(item);
                            setEffectText("");
                          }}
                        >
                          Log effect
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {prnMedications.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-cc-border">
                    {prnMedications.map((med) => (
                      <div key={med.id} className="flex items-center justify-between gap-3 border-b border-cc-border px-3 py-3 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-cc-text">
                            {med.name}{med.strength ? ` · ${med.strength}` : ""}
                          </p>
                          <p className={`text-xs ${med.at_or_over_max ? "text-red-600" : "text-cc-muted"}`}>
                            {med.dosage ? `${med.dosage} · ` : ""}{med.route} · {med.doses_given_today} given today
                            {med.prn_max_per_day ? ` / ${med.prn_max_per_day} max` : ""}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={med.at_or_over_max ? "destructive" : "default"}
                          className="rounded-full"
                          disabled={disabled || busy}
                          onClick={() => {
                            setDoseTarget(med);
                            setDoseReason("");
                            setDoseGiven("");
                            setPrnPhotoUrl(null);
                            setConfirmPrnOverride(false);
                          }}
                        >
                          Log dose
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(activeItem) || Boolean(followUp)}
        onOpenChange={(open) => {
          if (open) return;
          resetChecklist();
          setFollowUp(null);
          setReasonCode(null);
          setNoteText("");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{followUp ? "Why was the dose off schedule?" : activeItem?.name ?? "Medication"}</DialogTitle>
            <DialogDescription>
              {followUp
                ? "Add a reason or note for the early or late administration."
                : "Record the administration outcome for this scheduled dose."}
            </DialogDescription>
          </DialogHeader>

          {followUp ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {reasonCodes.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setReasonCode(code)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold ${reasonCode === code ? "border-cc-plum bg-violet-50 text-violet-700" : "border-cc-border text-cc-text"}`}
                  >
                    {REASON_LABELS[code] ?? code}
                  </button>
                ))}
              </div>
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add detail if needed"
                className="min-h-[110px]"
              />
              <Button className="w-full rounded-xl" disabled={busy} onClick={submitFollowUp}>
                {followUpMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : "Save reason"}
              </Button>
            </div>
          ) : activeItem ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["given", "Given"],
                  ["refused", "Refused"],
                  ["missed", "Missed"],
                  ["withheld", "Withheld"],
                  ["administration_error", "Error"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setReasonAction(value);
                      setReasonCode(null);
                      setNoteText("");
                    }}
                    className={`rounded-xl border px-3 py-3 text-sm font-bold ${reasonAction === value ? "border-cc-plum bg-violet-50 text-violet-700" : "border-cc-border text-cc-text"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeItem.is_high_risk && reasonAction === "given" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 text-amber-700" />
                    <div className="space-y-2">
                      <p className="text-sm font-bold text-amber-900">High-risk medication</p>
                      <p className="text-xs text-amber-800">A verification photo is required before this dose can be logged.</p>
                      <input
                        ref={photoRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void uploadPhoto(e.target.files?.[0] ?? null, activeItem.medication_id, "scheduled")}
                      />
                      <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={disabled || uploadingPhoto} onClick={() => photoRef.current?.click()}>
                        {uploadingPhoto ? <Loader2 size={14} className="animate-spin" /> : "Upload verification photo"}
                      </Button>
                      {verificationPhotoUrl && <p className="text-xs font-medium text-emerald-700">Verification photo ready.</p>}
                    </div>
                  </div>
                </div>
              )}

              {reasonCodes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {reasonCodes.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setReasonCode(code)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold ${reasonCode === code ? "border-cc-plum bg-violet-50 text-violet-700" : "border-cc-border text-cc-text"}`}
                    >
                      {reasonAction === "administration_error"
                        ? ERROR_SUBTYPE_LABELS[code as MedicationErrorSubtype]
                        : REASON_LABELS[code] ?? code}
                    </button>
                  ))}
                </div>
              )}

              {reasonAction && reasonAction !== "given" && (
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={
                    reasonAction === "administration_error"
                      ? "Describe what happened"
                      : "Add a note about this outcome"
                  }
                  className="min-h-[110px]"
                />
              )}

              <Button className="w-full rounded-xl" disabled={!reasonAction || busy} onClick={submitScheduledAction}>
                {scheduleMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : "Log medication"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(doseTarget)} onOpenChange={(open) => !open && resetPrn()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{doseTarget?.name ?? "PRN medication"}</DialogTitle>
            <DialogDescription>Log an as-needed dose and why it was given.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {doseTarget?.at_or_over_max && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                Already at or over the daily max for this medication.
              </div>
            )}
            <Textarea
              value={doseReason}
              onChange={(e) => setDoseReason(e.target.value)}
              placeholder="Why is this being given now?"
              className="min-h-[110px]"
            />
            <Input
              value={doseGiven}
              onChange={(e) => setDoseGiven(e.target.value)}
              placeholder="Dose given (optional)"
            />
            {doseTarget?.is_high_risk && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <input
                  ref={prnPhotoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void uploadPhoto(e.target.files?.[0] ?? null, doseTarget.id, "prn")}
                />
                <p className="text-sm font-bold text-amber-900">High-risk medication</p>
                <p className="mt-1 text-xs text-amber-800">A verification photo is required before this PRN dose can be logged.</p>
                <Button type="button" variant="outline" size="sm" className="mt-2 rounded-full" disabled={disabled || uploadingPrnPhoto} onClick={() => prnPhotoRef.current?.click()}>
                  {uploadingPrnPhoto ? <Loader2 size={14} className="animate-spin" /> : "Upload verification photo"}
                </Button>
                {prnPhotoUrl && <p className="mt-2 text-xs font-medium text-emerald-700">Verification photo ready.</p>}
              </div>
            )}
            {doseTarget?.at_or_over_max && (
              <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <input
                  type="checkbox"
                  checked={confirmPrnOverride}
                  onChange={(e) => setConfirmPrnOverride(e.target.checked)}
                  className="mt-1"
                />
                <span>I confirm this override has been clinically directed and should still be logged.</span>
              </label>
            )}
            <Button
              className="w-full rounded-xl"
              disabled={busy || (doseTarget?.at_or_over_max === true && !confirmPrnOverride)}
              onClick={submitPrnDose}
            >
              {prnDoseMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : "Log PRN dose"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(effectTarget)}
        onOpenChange={(open) => {
          if (open) return;
          setEffectTarget(null);
          setEffectText("");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log PRN effect</DialogTitle>
            <DialogDescription>Record the effect observed after the PRN dose.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={effectText}
              onChange={(e) => setEffectText(e.target.value)}
              placeholder="What effect was observed?"
              className="min-h-[110px]"
            />
            <Button
              className="w-full rounded-xl"
              disabled={busy || !effectText.trim()}
              onClick={() => effectMutation.mutate()}
            >
              {effectMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : "Save effect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
