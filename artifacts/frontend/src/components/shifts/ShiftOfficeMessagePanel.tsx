import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { compressImageFile } from "@/lib/task-evidence-storage";
import { cn } from "@/lib/utils";
import { sendShiftOfficeMessage, type ShiftOfficeMessage } from "@/services/shiftService";

const PRIORITY_DOT: Record<"normal" | "urgent" | "emergency", string> = {
  normal: "bg-cc-muted",
  urgent: "bg-amber-500",
  emergency: "bg-red-500",
};

type Props = {
  shiftId: string;
  messageHistory?: ShiftOfficeMessage[];
  onSent?: () => void;
  onCancel?: () => void;
  showHeader?: boolean;
  variant?: "embedded" | "page";
};

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-cc-muted">{label}</span>
      {children}
    </div>
  );
}

export function ShiftOfficeMessagePanel({
  shiftId,
  messageHistory = [],
  onSent,
  onCancel,
  showHeader = true,
  variant = "embedded",
}: Props) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [officeMessage, setOfficeMessage] = useState("");
  const [messagePriority, setMessagePriority] = useState<"normal" | "urgent" | "emergency">("normal");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messagePhotoPreviews, setMessagePhotoPreviews] = useState<string[]>([]);
  const messagePhotoInputRef = useRef<HTMLInputElement>(null);
  const isPage = variant === "page";

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
      onSent?.();
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

  const canSend = officeMessage.trim().length > 0 && !sendingMessage;

  return (
    <div className={cn("space-y-4", isPage ? "" : "space-y-3")}>
      {showHeader && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-wider text-cc-plum">
            {translate("shift.during.messageOffice")}
          </p>
          {onCancel && (
            <button type="button" onClick={onCancel} aria-label={translate("shift.during.closeMessage")}>
              <X size={16} className="text-cc-muted" />
            </button>
          )}
        </div>
      )}

      <FormField label={translate("shift.during.priorityLabel")}>
        <div className="cc-field flex h-10 items-center gap-2.5 overflow-hidden p-0 pl-3 pr-3 focus-within:border-cc-plum focus-within:shadow-[0_0_0_1px_var(--cc-plum)]">
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[messagePriority])}
          />
          <select
            value={messagePriority}
            onChange={(e) => setMessagePriority(e.target.value as typeof messagePriority)}
            className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent py-0 pl-0 pr-6 text-sm text-cc-text focus:outline-none focus:ring-0"
            aria-label={translate("shift.during.priorityLabel")}
          >
            <option value="normal">{translate("shift.during.priority.normal")}</option>
            <option value="urgent">{translate("shift.during.priority.urgent")}</option>
            <option value="emergency">{translate("shift.during.priority.emergency")}</option>
          </select>
        </div>
      </FormField>

      <FormField label={translate("shift.during.messageLabel")}>
        <textarea
          value={officeMessage}
          onChange={(e) => setOfficeMessage(e.target.value)}
          placeholder={translate("shift.during.messagePlaceholder")}
          className="cc-field min-h-[120px] resize-none py-3"
          rows={5}
        />
      </FormField>

      <FormField label={translate("shift.during.addPhoto")}>
        <div className="rounded-xl border border-dashed border-cc-border bg-cc-bg/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {messagePhotoPreviews.map((src, i) => (
              <div key={`${i}-${src.slice(0, 24)}`} className="relative h-16 w-16 shrink-0">
                <img src={src} alt="" className="h-full w-full rounded-lg border border-cc-border object-cover" />
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-cc-text text-cc-surface"
                  onClick={() => setMessagePhotoPreviews((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={translate("shift.evidence.removePhoto")}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            {messagePhotoPreviews.length < 2 && (
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-cc-border bg-cc-surface px-3 text-sm font-semibold text-cc-text transition-colors hover:border-cc-plum hover:text-cc-plum"
                onClick={() => messagePhotoInputRef.current?.click()}
              >
                <Camera size={15} className="text-cc-plum" />
                {translate("shift.during.addPhoto")}
              </button>
            )}
          </div>
          <input
            ref={messagePhotoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleMessagePhotoPick(e.target.files?.[0] ?? null)}
          />
        </div>
      </FormField>

      <Button
        type="button"
        className="h-11 w-full rounded-xl font-bold text-white shadow-sm"
        style={{ background: "var(--cc-plum)" }}
        disabled={!canSend}
        onClick={() => void handleSendMessage()}
      >
        {sendingMessage ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            {translate("shift.during.sending")}
          </span>
        ) : (
          translate("shift.during.sendMessage")
        )}
      </Button>

      {messageHistory.length > 0 && (
        <div className="rounded-xl border border-cc-border bg-cc-bg/60 p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-cc-muted">
            {translate("shift.during.officeMessages")}
          </p>
          <ul className="max-h-40 space-y-2 overflow-y-auto">
            {messageHistory.map((msg) => (
              <li key={msg.id} className="rounded-lg border border-cc-border/60 bg-cc-surface px-3 py-2.5">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-cc-muted">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      PRIORITY_DOT[msg.priority as keyof typeof PRIORITY_DOT] ?? PRIORITY_DOT.normal,
                    )}
                  />
                  <span className="capitalize text-cc-text">{msg.priority}</span>
                  <span>·</span>
                  <span>{new Date(msg.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-cc-text">{msg.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
