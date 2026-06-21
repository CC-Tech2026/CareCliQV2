import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ChevronDown, MessageSquare, Phone, Sparkles, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { compressImageFile } from "@/lib/task-evidence-storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createIncident, listIncidents, type IncidentPayload } from "@/services/incidentService";
import { listShiftMessages, sendShiftOfficeMessage, type ShiftOfficeMessage } from "@/services/shiftService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const INCIDENT_TYPES = [
  { value: "injury", label: "Fall / Injury" },
  { value: "medication_error", label: "Medication error" },
  { value: "behaviour_of_concern", label: "Behaviour" },
  { value: "near_miss", label: "Near miss" },
  { value: "other", label: "Other" },
] as const;

type IncidentListItem = {
  id: string;
  title?: string;
  incident_type?: string;
  incident_date?: string;
  severity?: string;
};

type Props = {
  shiftId: string;
  participantId?: string;
  participantName?: string;
  sessionId?: string | null;
  shiftAddress?: string;
  open?: boolean;
  onToggle?: () => void;
  officePhone?: string;
};

export function DuringShiftAccordion({
  shiftId,
  participantId,
  participantName,
  sessionId,
  shiftAddress,
  open = false,
  onToggle,
  officePhone = "1300 000 000",
}: Props) {
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [incidentType, setIncidentType] = useState("injury");
  const [incidentTime, setIncidentTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [description, setDescription] = useState("");
  const [peopleInvolved, setPeopleInvolved] = useState("");
  const [injuries, setInjuries] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");
  const [escalate, setEscalate] = useState(false);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [incidentHistory, setIncidentHistory] = useState<IncidentListItem[]>([]);

  const [officeMessage, setOfficeMessage] = useState("");
  const [messagePriority, setMessagePriority] = useState<"normal" | "urgent" | "emergency">("normal");
  const [messageHistory, setMessageHistory] = useState<ShiftOfficeMessage[]>([]);
  const [sendingMessage, setSendingMessage] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      if (participantId) {
        const incidents = await listIncidents<IncidentListItem[]>();
        const rows = Array.isArray(incidents) ? incidents : [];
        setIncidentHistory(
          rows
            .filter((row) => !sessionId || row.incident_date)
            .slice(0, 8),
        );
      }
      const messages = await listShiftMessages(shiftId);
      setMessageHistory(messages || []);
    } catch {
      /* optional history */
    }
  }, [participantId, sessionId, shiftId]);

  useEffect(() => {
    if (open) void loadHistory();
  }, [open, loadHistory]);

  const handlePhotoPick = async (file: File | null) => {
    if (!file) return;
    try {
      const { dataUrl } = await compressImageFile(file);
      setPhotoPreviews((prev) => [...prev, dataUrl].slice(0, 4));
    } catch {
      toast({ title: "Could not add photo", variant: "destructive" });
    }
  };

  const handleSubmitIncident = async () => {
    if (!description.trim()) {
      toast({ title: "Description required", description: "Describe what happened.", variant: "destructive" });
      return;
    }
    const typeLabel = INCIDENT_TYPES.find((t) => t.value === incidentType)?.label ?? "Incident";
    setSubmitting(true);
    try {
      const payload: IncidentPayload = {
        participant_id: participantId,
        session_id: sessionId ?? undefined,
        shift_id: shiftId,
        incident_type: incidentType,
        severity: escalate || incidentType === "injury" ? "high" : "medium",
        title: `${typeLabel} — ${participantName ?? "shift"}`,
        description: description.trim(),
        location: shiftAddress,
        witnesses: peopleInvolved.trim() || undefined,
        participant_impact: injuries.trim() || undefined,
        worker_actions: actionsTaken.trim() || undefined,
        incident_date: new Date(incidentTime).toISOString(),
        escalate,
        photo_data: photoPreviews.length ? photoPreviews : undefined,
      };
      await createIncident(payload);
      toast({ title: "Incident reported", description: "Your report has been submitted to the office." });
      setDescription("");
      setPeopleInvolved("");
      setInjuries("");
      setActionsTaken("");
      setPhotoPreviews([]);
      setEscalate(false);
      setShowIncidentForm(false);
      void loadHistory();
    } catch (err) {
      toast({
        title: "Could not submit report",
        description: (err as Error).message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendMessage = async () => {
    const text = officeMessage.trim();
    if (!text) return;
    setSendingMessage(true);
    try {
      await sendShiftOfficeMessage(shiftId, { message: text, priority: messagePriority });
      toast({ title: "Message sent", description: "Office has been notified." });
      setOfficeMessage("");
      setShowMessageForm(false);
      void loadHistory();
    } catch (err) {
      toast({
        title: "Could not send message",
        description: (err as Error).message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <Sparkles size={16} style={{ color: PLUM }} />
          During Shift
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="space-y-3 border-t px-4 py-4" style={{ borderColor: BORDER }}>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-11 rounded-xl text-xs font-bold text-red-600",
                showIncidentForm && "border-red-200 bg-red-50 text-red-700",
              )}
              onClick={() => {
                setShowIncidentForm(!showIncidentForm);
                setShowMessageForm(false);
              }}
            >
              <AlertTriangle size={14} className="mr-1.5" />
              Report incident
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-11 rounded-xl text-xs font-bold",
                showMessageForm && "border-violet-200 bg-violet-50 text-violet-700",
              )}
              onClick={() => {
                setShowMessageForm(!showMessageForm);
                setShowIncidentForm(false);
              }}
            >
              <MessageSquare size={14} className="mr-1.5" />
              Message office
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${officePhone}`}>
              <Button type="button" variant="outline" className="h-11 w-full rounded-xl text-xs font-bold">
                <Phone size={14} className="mr-1.5" />
                Call office
              </Button>
            </a>
            <a href="tel:000">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full rounded-xl border-red-200 text-xs font-bold text-red-700"
              >
                Emergency 000
              </Button>
            </a>
          </div>

          {showIncidentForm && (
            <div className="space-y-3 rounded-xl border border-red-100 bg-red-50/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-wider text-red-800">Incident report</p>
                <button type="button" onClick={() => setShowIncidentForm(false)} aria-label="Close incident form">
                  <X size={16} className="text-red-600" />
                </button>
              </div>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Incident type" />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
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
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened?"
                className="min-h-[80px] bg-white"
              />
              <Input
                value={peopleInvolved}
                onChange={(e) => setPeopleInvolved(e.target.value)}
                placeholder="People involved"
                className="bg-white"
              />
              <Input
                value={injuries}
                onChange={(e) => setInjuries(e.target.value)}
                placeholder="Injuries / impact"
                className="bg-white"
              />
              <Textarea
                value={actionsTaken}
                onChange={(e) => setActionsTaken(e.target.value)}
                placeholder="Actions taken"
                className="min-h-[60px] bg-white"
              />
              <label className="flex items-center gap-2 text-xs font-bold text-red-800">
                <input type="checkbox" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} />
                Escalate to coordinator immediately
              </label>
              <div className="flex flex-wrap gap-2">
                {photoPreviews.map((src, i) => (
                  <div key={`${i}-${src.slice(0, 32)}`} className="relative h-16 w-16 shrink-0">
                    <button
                      type="button"
                      className="h-full w-full overflow-hidden rounded-lg border bg-white shadow-sm ring-offset-1 transition hover:ring-2 hover:ring-violet-300"
                      onClick={() => setPreviewPhoto(src)}
                      aria-label={`View incident photo ${i + 1}`}
                    >
                      <img
                        src={src}
                        alt={`Incident photo ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      className="absolute -right-1 -top-1 rounded-full bg-black/70 p-0.5 text-white shadow"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhotoPreviews((prev) => prev.filter((_, idx) => idx !== i));
                        if (previewPhoto === src) setPreviewPhoto(null);
                      }}
                      aria-label={`Remove photo ${i + 1}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="grid h-16 w-16 place-items-center rounded-lg border border-dashed bg-white"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Camera size={18} style={{ color: PLUM }} />
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handlePhotoPick(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button
                type="button"
                className="w-full rounded-xl font-bold text-white"
                style={{ background: CORAL }}
                disabled={submitting}
                onClick={() => void handleSubmitIncident()}
              >
                {submitting ? "Submitting…" : "Submit incident"}
              </Button>
            </div>
          )}

          {showMessageForm && (
            <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-wider text-violet-800">Message office</p>
                <button type="button" onClick={() => setShowMessageForm(false)} aria-label="Close message form">
                  <X size={16} className="text-violet-600" />
                </button>
              </div>
              <Select value={messagePriority} onValueChange={(v) => setMessagePriority(v as typeof messagePriority)}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                value={officeMessage}
                onChange={(e) => setOfficeMessage(e.target.value)}
                placeholder="Write your message to the office…"
                className="min-h-[80px] bg-white"
              />
              <Button
                type="button"
                className="w-full rounded-xl font-bold text-white"
                style={{ background: PLUM }}
                disabled={sendingMessage}
                onClick={() => void handleSendMessage()}
              >
                {sendingMessage ? "Sending…" : "Send message"}
              </Button>
            </div>
          )}

          {messageHistory.length > 0 && (
            <div className="rounded-xl border bg-[#F8F6FE] p-3" style={{ borderColor: BORDER }}>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                Office messages
              </p>
              <ul className="max-h-28 space-y-2 overflow-y-auto text-xs">
                {messageHistory.map((msg) => (
                  <li key={msg.id} className="rounded-lg bg-white px-2 py-1.5">
                    <span className="font-bold capitalize">{msg.priority}</span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <span>{new Date(msg.created_at).toLocaleString()}</span>
                    <p className="mt-0.5">{msg.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {incidentHistory.length > 0 && (
            <div className="rounded-xl border bg-[#FFF7ED] p-3" style={{ borderColor: "#FED7AA" }}>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-amber-800">Recent incidents</p>
              <ul className="max-h-28 space-y-2 overflow-y-auto text-xs text-amber-950">
                {incidentHistory.map((item) => (
                  <li key={item.id} className="rounded-lg bg-white px-2 py-1.5">
                    <span className="font-bold">{item.title || item.incident_type}</span>
                    {item.incident_date && (
                      <span className="ml-1 text-muted-foreground">
                        · {new Date(item.incident_date).toLocaleString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Dialog open={Boolean(previewPhoto)} onOpenChange={(open) => !open && setPreviewPhoto(null)}>
        <DialogContent className="max-w-[min(92vw,640px)] gap-3 p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle>Incident photo</DialogTitle>
            <DialogDescription>Tap outside or close to return to the report.</DialogDescription>
          </DialogHeader>
          {previewPhoto && (
            <img
              src={previewPhoto}
              alt="Incident photo full size"
              className="max-h-[70vh] w-full rounded-lg object-contain bg-black/5"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
