import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { compressImageFile } from "@/lib/task-evidence-storage";
import {
  BEHAVIOUR_SUBTYPES,
  WORKER_REPORT_TYPES,
  WORKER_SEVERITIES,
  createWorkerIncident,
  type IncidentPhotoItem,
} from "@/services/incidentService";
import { CORAL } from "@/lib/shift-utils";

const BEHAVIOUR_TEMPLATES: Record<string, { description: string; worker_actions?: string }> = {
  verbal: {
    description: "Participant displayed verbal behaviour of concern during the shift. ",
    worker_actions: "Maintained safe distance, used calm tone, and followed de-escalation steps.",
  },
  physical: {
    description: "Participant displayed physical behaviour of concern during the shift. ",
    worker_actions: "Ensured safety of all people present and followed participant safety protocol.",
  },
  property: {
    description: "Participant behaviour resulted in property damage during the shift. ",
    worker_actions: "Secured the area and documented visible damage.",
  },
};

type PhotoDraft = IncidentPhotoItem & { preview: string };

type Props = {
  shiftId: string;
  participantId?: string;
  participantName?: string;
  sessionId?: string | null;
  shiftAddress?: string;
  onSubmitted?: (referenceNumber?: string) => void;
  onCancel?: () => void;
};

export function WorkerIncidentReportForm({
  shiftId,
  participantId,
  participantName,
  sessionId,
  shiftAddress,
  onSubmitted,
  onCancel,
}: Props) {
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [reportType, setReportType] = useState("safety_hazard");
  const [behaviourSubtype, setBehaviourSubtype] = useState<string>("");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [workerActions, setWorkerActions] = useState("");
  const [participantPresent, setParticipantPresent] = useState<boolean | null>(null);
  const [participantHarmed, setParticipantHarmed] = useState<"yes" | "no" | "unknown" | "">("");
  const [incidentTime, setIncidentTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationRef, setConfirmationRef] = useState<string | null>(null);

  const descLen = description.trim().length;
  const canSubmit = descLen >= 20 && descLen <= 2000 && !submitting;

  const applyBehaviourSubtype = (subtype: string) => {
    setBehaviourSubtype(subtype);
    const template = BEHAVIOUR_TEMPLATES[subtype];
    if (template) {
      setDescription(template.description);
      setWorkerActions(template.worker_actions ?? "");
    }
  };

  const captureLocation = (): Promise<Pick<IncidentPhotoItem, "latitude" | "longitude">> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({});
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    });

  const handlePhotoPick = async (file: File | null) => {
    if (!file || photos.length >= 3) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Photo too large", description: "Maximum size is 10 MB.", variant: "destructive" });
      return;
    }
    try {
      const [{ dataUrl }, geo] = await Promise.all([compressImageFile(file), captureLocation()]);
      setPhotos((prev) => [
        ...prev,
        {
          data: dataUrl,
          preview: dataUrl,
          captured_at: new Date().toISOString(),
          ...geo,
        },
      ]);
    } catch {
      toast({ title: "Could not add photo", variant: "destructive" });
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await createWorkerIncident<{
        id: string;
        reference_number?: string;
      }>({
        shift_id: shiftId,
        participant_id: participantId,
        session_id: sessionId ?? undefined,
        worker_report_type: reportType,
        behaviour_subtype: reportType === "participant_behaviour" ? behaviourSubtype || undefined : undefined,
        severity,
        description: description.trim(),
        worker_actions: workerActions.trim() || undefined,
        incident_date: new Date(incidentTime).toISOString(),
        location: shiftAddress,
        participant_present: participantPresent ?? undefined,
        participant_harmed:
          participantPresent && participantHarmed
            ? (participantHarmed as "yes" | "no" | "unknown")
            : undefined,
        photo_items: photos.map(({ data, captured_at, latitude, longitude }) => ({
          data,
          captured_at,
          latitude,
          longitude,
        })),
      });
      const ref = result.reference_number;
      setConfirmationRef(ref ?? result.id.slice(0, 8).toUpperCase());
      toast({
        title: "Incident reported",
        description: ref ? `Reference ${ref}` : "Your report has been submitted.",
      });
      onSubmitted?.(ref);
    } catch (err) {
      toast({
        title: "Could not submit report",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmationRef) {
    return (
      <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-center">
        <p className="text-sm font-black text-emerald-900">Incident submitted</p>
        <p className="text-2xl font-black tracking-wide text-emerald-800">{confirmationRef}</p>
        <p className="text-xs text-emerald-700">
          Keep this reference number. The coordinator has been notified.
        </p>
        <Button type="button" className="w-full" variant="outline" onClick={onCancel}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-100 bg-red-50/40 p-3">
      <Select value={reportType} onValueChange={setReportType}>
        <SelectTrigger className="bg-white">
          <SelectValue placeholder="Incident type" />
        </SelectTrigger>
        <SelectContent>
          {WORKER_REPORT_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {reportType === "participant_behaviour" && (
        <Select value={behaviourSubtype || undefined} onValueChange={applyBehaviourSubtype}>
          <SelectTrigger className="bg-white">
            <SelectValue placeholder="Behaviour sub-type" />
          </SelectTrigger>
          <SelectContent>
            {BEHAVIOUR_SUBTYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={severity} onValueChange={setSeverity}>
        <SelectTrigger className="bg-white">
          <SelectValue placeholder="Severity" />
        </SelectTrigger>
        <SelectContent>
          {WORKER_SEVERITIES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="datetime-local"
        value={incidentTime}
        onChange={(e) => setIncidentTime(e.target.value)}
        className="bg-white"
      />

      <div>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what happened (min 20 characters)…"
          className="min-h-[100px] bg-white"
          spellCheck
        />
        <p
          className={`mt-1 text-right text-[11px] font-semibold ${
            descLen < 20 ? "text-red-600" : descLen > 2000 ? "text-red-600" : "text-muted-foreground"
          }`}
        >
          {descLen}/2000
        </p>
      </div>

      <Textarea
        value={workerActions}
        onChange={(e) => setWorkerActions(e.target.value)}
        placeholder="Actions you took (optional)"
        className="min-h-[60px] bg-white"
        spellCheck
      />

      <fieldset className="space-y-2 rounded-lg border bg-white p-3">
        <legend className="px-1 text-xs font-bold">Was the participant present?</legend>
        <div className="flex gap-4 text-sm font-semibold">
          {(["yes", "no"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="participant-present"
                checked={participantPresent === (value === "yes")}
                onChange={() => {
                  setParticipantPresent(value === "yes");
                  if (value === "no") setParticipantHarmed("");
                }}
              />
              {value === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
        {participantPresent && (
          <Select
            value={participantHarmed || undefined}
            onValueChange={(v) => setParticipantHarmed(v as typeof participantHarmed)}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Was participant harmed?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        {photos.map((photo, i) => (
          <div key={i} className="relative h-16 w-16">
            <img src={photo.preview} alt="" className="h-full w-full rounded-lg border object-cover" />
            <button
              type="button"
              className="absolute -right-1 -top-1 rounded-full bg-black/70 p-0.5 text-white"
              onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {photos.length < 3 && (
          <button
            type="button"
            className="grid h-16 w-16 place-items-center rounded-lg border border-dashed bg-white"
            onClick={() => photoInputRef.current?.click()}
          >
            <Camera size={18} />
          </button>
        )}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void handlePhotoPick(e.target.files?.[0] ?? null)}
        />
      </div>

      <Button
        type="button"
        className="w-full rounded-xl font-bold text-white"
        style={{ background: CORAL }}
        disabled={!canSubmit}
        onClick={() => void handleSubmit()}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
          </>
        ) : (
          `Submit incident${participantName ? ` — ${participantName}` : ""}`
        )}
      </Button>
    </div>
  );
}
