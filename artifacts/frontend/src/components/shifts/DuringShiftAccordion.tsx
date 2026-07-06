import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Sparkles, X } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { unlockPageInteraction } from "@/lib/unlock-page-interaction";
import { listIncidents } from "@/services/incidentService";
import { WorkerIncidentReportForm } from "@/components/shifts/WorkerIncidentReportForm";
import { listShiftMessages, type ShiftOfficeMessage } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { DuringShiftActionsSidebar } from "@/components/shifts/DuringShiftActionsSidebar";
import { ShiftOfficeMessagePanel } from "@/components/shifts/ShiftOfficeMessagePanel";

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
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();

  const [internalIncidentOpen, setInternalIncidentOpen] = useState(false);
  const isIncidentControlled = onIncidentFormOpenChange !== undefined;
  const showIncidentForm = isIncidentControlled ? Boolean(incidentFormOpen) : internalIncidentOpen;
  const setShowIncidentForm = (next: boolean) => {
    onIncidentFormOpenChange?.(next);
    if (!isIncidentControlled) setInternalIncidentOpen(next);
  };
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [incidentHistory, setIncidentHistory] = useState<IncidentListItem[]>([]);
  const [messageHistory, setMessageHistory] = useState<ShiftOfficeMessage[]>([]);

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
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (messageModalOpen) void loadHistory();
  }, [messageModalOpen, loadHistory]);

  useEffect(() => {
    if (!showIncidentForm) return;
    unlockPageInteraction();
  }, [showIncidentForm]);

  const toggleIncidentForm = () => {
    unlockPageInteraction();
    setShowIncidentForm(!showIncidentForm);
  };

  const panelExpanded = showIncidentForm;

  const handleMessageOffice = () => {
    unlockPageInteraction();
    if (isMobile) {
      navigate(`/my-shifts/${shiftId}/message-office`);
      return;
    }
    setMessageModalOpen(true);
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
          <div className="grid grid-cols-1 gap-2">
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

      <DuringShiftActionsSidebar
        onMessageOffice={handleMessageOffice}
        officePhone={officePhone}
      />

      <Dialog open={messageModalOpen} onOpenChange={setMessageModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{translate("shift.during.messageOffice")}</DialogTitle>
          </DialogHeader>
          <ShiftOfficeMessagePanel
            shiftId={shiftId}
            messageHistory={messageHistory}
            showHeader={false}
            onSent={() => {
              void loadHistory();
              setMessageModalOpen(false);
            }}
            onCancel={() => setMessageModalOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
