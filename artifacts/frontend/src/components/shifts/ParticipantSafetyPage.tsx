import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Phone, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  acknowledgeWorkerSafetyProtocol,
  type SafetyProtocol,
} from "@/services/safetyProtocolService";

type Props = {
  open: boolean;
  protocol: SafetyProtocol | null;
  participantName?: string;
  mandatory?: boolean;
  onClose: () => void;
  onAcknowledged?: () => void;
};

export function ParticipantSafetyPage({
  open,
  protocol,
  participantName,
  mandatory = false,
  onClose,
  onAcknowledged,
}: Props) {
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [busy, setBusy] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    setScrolledToEnd(atEnd || el.scrollHeight <= el.clientHeight + 8);
  }, []);

  useEffect(() => {
    if (!open) {
      setScrolledToEnd(false);
      return;
    }
    const timer = window.setTimeout(checkScroll, 100);
    return () => window.clearTimeout(timer);
  }, [open, protocol, checkScroll]);

  const handleAcknowledge = async () => {
    if (!protocol?.participant_id) return;
    setBusy(true);
    try {
      await acknowledgeWorkerSafetyProtocol(
        protocol.participant_id,
        protocol.content_version,
      );
      toast({ title: "Safety card acknowledged" });
      onAcknowledged?.();
      onClose();
    } catch (err) {
      toast({
        title: "Could not save acknowledgement",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const contacts = protocol?.escalation_contacts ?? [];
  const hasVisibleContent = Boolean(
    protocol?.safety_card_body?.trim()
      || (protocol?.scenarios ?? []).some((s) => s.trigger?.trim() || s.response?.trim())
      || (protocol?.deescalation_techniques ?? []).some(
        (t) => t.title?.trim() || (t.steps ?? []).some((step) => step.trim()),
      )
      || (protocol?.physical_safety_notes ?? []).some((n) => n.note?.trim())
      || contacts.some((c) => c.phone?.trim()),
  );
  const showAck = (mandatory || Boolean(protocol?.requires_safety_ack)) && hasVisibleContent;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (mandatory) return;
        onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[92vh] max-w-2xl flex-col gap-0 p-0"
        hideCloseButton={mandatory}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Shield size={18} className="text-violet-700" />
            Safety protocols — {participantName ?? "participant"}
          </DialogTitle>
          <DialogDescription>
            Review participant-specific safety procedures before and during your shift.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
          onScroll={checkScroll}
        >
          {!hasVisibleContent && (
            <section className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-6 text-center">
              <Shield size={28} className="mx-auto mb-3 text-violet-400" />
              <p className="text-sm font-bold text-violet-900">No safety content yet</p>
              <p className="mt-2 text-sm leading-relaxed text-violet-700">
                Your coordinator has not published a safety card for this participant yet.
                Check risk alerts above, or contact your coordinator before starting support.
              </p>
            </section>
          )}

          {protocol?.safety_card_body?.trim() && (
            <section className="rounded-xl border border-violet-100 bg-violet-50/50 p-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-violet-800">
                Safety card
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-violet-950">
                {protocol.safety_card_body}
              </p>
            </section>
          )}

          {(protocol?.scenarios ?? []).map((scenario, i) => (
            <section key={i} className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">If</p>
              <p className="mt-1 text-sm font-semibold">{scenario.trigger}</p>
              <div className="my-2 flex items-center gap-1 text-violet-600">
                <ChevronRight size={14} />
                <span className="text-[10px] font-black uppercase">Then</span>
              </div>
              <p className="text-sm leading-relaxed">{scenario.response}</p>
            </section>
          ))}

          {(protocol?.deescalation_techniques ?? []).map((tech, i) => (
            <section key={i} className="rounded-xl border bg-white p-4 shadow-sm">
              <h4 className="text-sm font-black">{tech.title}</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {tech.steps.map((step, si) => (
                  <li key={si}>{step}</li>
                ))}
              </ol>
            </section>
          ))}

          {(protocol?.physical_safety_notes ?? []).map((item, i) => (
            <section
              key={i}
              className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-950"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange-600" />
              <p className="text-sm font-semibold leading-relaxed">{item.note}</p>
            </section>
          ))}

          {contacts.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                Who to call
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Try the coordinator first unless there is immediate danger.
              </p>
              <ul className="mt-3 space-y-2">
                {contacts.map((contact) => (
                  <li key={`${contact.role}-${contact.phone}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                    <div>
                      <p className="text-sm font-bold">{contact.label}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {contact.role.replace("_", " ")}
                      </p>
                    </div>
                    <a href={`tel:${contact.phone.replace(/\s/g, "")}`}>
                      <Button type="button" size="sm" variant="outline" className="gap-1 font-bold">
                        <Phone size={14} />
                        Call now
                      </Button>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          {showAck ? (
            <Button
              type="button"
              className="w-full font-bold"
              disabled={!scrolledToEnd || busy}
              onClick={() => void handleAcknowledge()}
            >
              {scrolledToEnd
                ? "I have read and understood this"
                : "Scroll to the bottom to continue"}
            </Button>
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
