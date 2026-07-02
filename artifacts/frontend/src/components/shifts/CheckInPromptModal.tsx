import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CheckinStatus } from "@/services/longShiftService";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (status: CheckinStatus) => void;
  busy?: boolean;
  gapMinutes?: number;
};

export function CheckInPromptModal({ open, onClose, onSubmit, busy, gapMinutes }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageCircle size={18} />
            Shift check-in due
          </DialogTitle>
          <DialogDescription>
            {gapMinutes != null && gapMinutes >= 90
              ? `No activity for ${gapMinutes} minutes. Tap a status to confirm you are OK.`
              : "Please confirm how the shift is going."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          {(
            [
              ["GOING_WELL", "Going well"],
              ["NEEDS_ATTENTION", "Needs attention"],
              ["INCIDENT_REPORTED", "Report incident"],
            ] as const
          ).map(([status, label]) => (
            <Button
              key={status}
              type="button"
              variant={status === "INCIDENT_REPORTED" ? "destructive" : "outline"}
              className="w-full rounded-xl"
              disabled={busy}
              onClick={() => onSubmit(status)}
            >
              {label}
            </Button>
          ))}
          <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
            Dismiss for now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
