import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ChevronDown, MessageSquare, Phone, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { compressImageFile } from "@/lib/task-evidence-storage";
import { unlockPageInteraction } from "@/lib/unlock-page-interaction";
import { listIncidents } from "@/services/incidentService";
import { WorkerIncidentReportForm } from "@/components/shifts/WorkerIncidentReportForm";
import { listShiftMessages, sendShiftOfficeMessage, type ShiftOfficeMessage } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const DEFAULT_OFFICE_PHONE = "1300 000 000";

const FIELD_SELECT =
  "flex h-9 w-full rounded-md border border-cc-border bg-cc-surface px-3 py-2 text-sm text-cc-text shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

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
  incidentFormOpen?: boolean;
  onIncidentFormOpenChange?: (open: boolean) => void;
  onIncidentSubmitted?: () => void;
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
  incidentFormOpen,
  onIncidentFormOpenChange,
  onIncidentSubmitted,
}: Props) {
  const { translate } = useAccessibility();
  const resolvedOfficePhone = (officePhone || DEFAULT_OFFICE_PHONE).replace(/\s/g, "");
  const { toast } = useToast();

  const [internalIncidentOpen, setInternalIncidentOpen] = useState(false);
  const isIncidentControlled = onIncidentFormOpenChange !== undefined;
  const showIncidentForm = isIncidentControlled ? Boolean(incidentFormOpen) : internalIncidentOpen;
  const setShowIncidentForm = (next: boolean) => {
    onIncidentFormOpenChange?.(next);
    if (!isIncidentControlled) setInternalIncidentOpen(next);
  };
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

  useEffect(() => {
    if (!showIncidentForm && !showMessageForm) return;
    unlockPageInteraction();
  }, [showIncidentForm, showMessageForm]);

  const toggleIncidentForm = () => {
    unlockPageInteraction();
    setShowIncidentForm(!showIncidentForm);
    setShowMessageForm(false);
  };

  const toggleMessageForm = () => {
    unlockPageInteraction();
    setShowMessageForm(!showMessageForm);
    setShowIncidentForm(false);
  };

  const panelExpanded = showIncidentForm || showMessageForm;

  const handleMessagePhotoPick = async (file: File | null) => {
    if (!file) return;
    try {
      const { dataUrl } = await compressImageFile(file);
      setMessagePhotoPreviews((prev) => [...prev, dataUrl].slice(0, 2));
    } catch {
      toast({ title: translate("shift.during.photoFailed"), variant: "destructive" });
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
      toast({ title: translate("shift.during.messageSent"), description: translate("shift.during.messageSentDesc") });
      setOfficeMessage("");
      setMessagePhotoPreviews([]);
      setShowMessageForm(false);
      void loadHistory();
    } catch (err) {
      toast({
        title: translate("shift.during.messageFailed"),
        description: (err as Error).message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <section
      className={cn("rounded-2xl border bg-cc-surface shadow-sm", panelExpanded ? "overflow-visible" : "overflow-hidden")}
      style={{ borderColor: BORDER }}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <Sparkles size={16} style={{ color: PLUM }} />
          {translate("shift.during.title")}
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
              onClick={(e) => {
                e.stopPropagation();
                toggleIncidentForm();
              }}
            >
              <AlertTriangle size={14} className="mr-1.5" />
              {translate("shift.during.reportIncident")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-11 rounded-xl text-xs font-bold",
                showMessageForm && "border-violet-200 bg-violet-50 text-violet-700",
              )}
              onClick={(e) => {
                e.stopPropagation();
                toggleMessageForm();
              }}
            >
              <MessageSquare size={14} className="mr-1.5" />
              {translate("shift.during.messageOffice")}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${resolvedOfficePhone}`}>
              <Button type="button" variant="outline" className="h-11 w-full rounded-xl text-xs font-bold">
                <Phone size={14} className="mr-1.5" />
                {translate("shift.during.callOffice")}
              </Button>
            </a>
            <a href="tel:000">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full rounded-xl border-red-200 text-xs font-bold text-red-700"
              >
                {translate("shift.during.emergency")}
              </Button>
            </a>
          </div>

          {showIncidentForm && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-black uppercase tracking-wider text-red-800">{translate("shift.during.incidentReport")}</p>
                <button type="button" onClick={() => setShowIncidentForm(false)} aria-label={translate("shift.during.closeIncident")}>
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
                  onIncidentSubmitted?.();
                }}
                onCancel={() => setShowIncidentForm(false)}
              />
            </div>
          )}

          {showMessageForm && (
            <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-wider text-violet-800">{translate("shift.during.messageOffice")}</p>
                <button type="button" onClick={() => setShowMessageForm(false)} aria-label={translate("shift.during.closeMessage")}>
                  <X size={16} className="text-violet-600" />
                </button>
              </div>
              <select
                value={messagePriority}
                onChange={(e) => setMessagePriority(e.target.value as typeof messagePriority)}
                className={FIELD_SELECT}
                aria-label={translate("shift.during.messageOffice")}
              >
                <option value="normal">{translate("shift.during.priority.normal")}</option>
                <option value="urgent">{translate("shift.during.priority.urgent")}</option>
                <option value="emergency">{translate("shift.during.priority.emergency")}</option>
              </select>
              <Textarea
                value={officeMessage}
                onChange={(e) => setOfficeMessage(e.target.value)}
                placeholder={translate("shift.during.messagePlaceholder")}
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
                {sendingMessage ? translate("shift.during.sending") : translate("shift.during.sendMessage")}
              </Button>
            </div>
          )}

          {messageHistory.length > 0 && (
            <div className="rounded-xl border bg-cc-bg p-3" style={{ borderColor: BORDER }}>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                {translate("shift.during.officeMessages")}
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
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-amber-800">{translate("shift.during.thisShift")}</p>
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
