import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ChevronDown, MessageSquare, Phone, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { listIncidents } from "@/services/incidentService";
import { WorkerIncidentReportForm } from "@/components/shifts/WorkerIncidentReportForm";
import { listShiftMessages, sendShiftOfficeMessage, type ShiftOfficeMessage } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const DEFAULT_OFFICE_PHONE = "1300 000 000";

type IncidentListItem = {
  id: string;
  title?: string;
  reference_number?: string;
  incident_type?: string;
  incident_date?: string;
  severity?: string;
  shift_id?: string;
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
  officePhone,
}: Props) {
  const resolvedOfficePhone = (officePhone || DEFAULT_OFFICE_PHONE).replace(/\s/g, "");
  const { toast } = useToast();

  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [incidentHistory, setIncidentHistory] = useState<IncidentListItem[]>([]);

  const [officeMessage, setOfficeMessage] = useState("");
  const [messagePriority, setMessagePriority] = useState<"normal" | "urgent" | "emergency">("normal");
  const [messageHistory, setMessageHistory] = useState<ShiftOfficeMessage[]>([]);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messagePhotoPreviews, setMessagePhotoPreviews] = useState<string[]>([]);
  const messagePhotoInputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const incidents = await listIncidents<IncidentListItem[]>({ shift_id: shiftId });
      const rows = Array.isArray(incidents) ? incidents : [];
      setIncidentHistory(rows.slice(0, 8));
      const messages = await listShiftMessages(shiftId);
      setMessageHistory(messages || []);
    } catch {
      /* optional history */
    }
  }, [shiftId]);

  useEffect(() => {
    if (open) void loadHistory();
  }, [open, loadHistory]);

  const handleMessagePhotoPick = async (file: File | null) => {
    if (!file) return;
    try {
      const { dataUrl } = await compressImageFile(file);
      setMessagePhotoPreviews((prev) => [...prev, dataUrl].slice(0, 2));
    } catch {
      toast({ title: "Could not add photo", variant: "destructive" });
    }
  };

  const handleSendMessage = async () => {
    const text = officeMessage.trim();
    if (!text) return;
    setSendingMessage(true);
    try {
      await sendShiftOfficeMessage(shiftId, {
        message: text,
        priority: messagePriority,
        attachment_data: messagePhotoPreviews.length ? messagePhotoPreviews : undefined,
      });
      toast({ title: "Message sent", description: "Office has been notified." });
      setOfficeMessage("");
      setMessagePhotoPreviews([]);
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
    <section className="overflow-hidden rounded-2xl border bg-cc-surface shadow-sm" style={{ borderColor: BORDER }}>
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
            <a href={`tel:${resolvedOfficePhone}`}>
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
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-black uppercase tracking-wider text-red-800">Incident report</p>
                <button type="button" onClick={() => setShowIncidentForm(false)} aria-label="Close incident form">
                  <X size={16} className="text-red-600" />
                </button>
              </div>
              <WorkerIncidentReportForm
                shiftId={shiftId}
                participantId={participantId}
                participantName={participantName}
                sessionId={sessionId}
                shiftAddress={shiftAddress}
                onSubmitted={() => {
                  void loadHistory();
                }}
                onCancel={() => setShowIncidentForm(false)}
              />
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
                <SelectTrigger className="bg-cc-surface">
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
                className="min-h-[80px] bg-cc-surface"
              />
              <div className="flex flex-wrap gap-2">
                {messagePhotoPreviews.map((src, i) => (
                  <div key={`${i}-${src.slice(0, 24)}`} className="relative h-14 w-14 shrink-0">
                    <img src={src} alt="" className="h-full w-full rounded-lg border object-cover" />
                    <button
                      type="button"
                      className="absolute -right-1 -top-1 rounded-full bg-black/70 p-0.5 text-white"
                      onClick={() => setMessagePhotoPreviews((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="grid h-14 w-14 place-items-center rounded-lg border border-dashed bg-cc-surface"
                  onClick={() => messagePhotoInputRef.current?.click()}
                >
                  <Camera size={16} style={{ color: PLUM }} />
                </button>
                <input
                  ref={messagePhotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleMessagePhotoPick(e.target.files?.[0] ?? null)}
                />
              </div>
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
            <div className="rounded-xl border bg-cc-bg p-3" style={{ borderColor: BORDER }}>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                Office messages
              </p>
              <ul className="max-h-28 space-y-2 overflow-y-auto text-xs">
                {messageHistory.map((msg) => (
                  <li key={msg.id} className="rounded-lg bg-cc-surface px-2 py-1.5">
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
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-amber-800">This shift</p>
              <ul className="max-h-28 space-y-2 overflow-y-auto text-xs text-amber-950">
                {incidentHistory.map((item) => (
                  <li key={item.id} className="rounded-lg bg-cc-surface px-2 py-1.5">
                    <span className="font-bold">{item.reference_number || item.title || item.incident_type}</span>
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
    </section>
  );
}
