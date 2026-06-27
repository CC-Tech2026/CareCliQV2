import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatShiftBlockTime } from "@/components/shifts/ShiftCalendarDetailSheet";
import type { CalendarShift } from "@/services/workerCalendarService";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";


type Props = {
  shift: CalendarShift | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewDetails: () => void;
};

export function WorkerShiftConfirmDialog({ shift, open, onOpenChange, onViewDetails }: Props) {
  if (!shift) return null;

  const dateLabel = shift.scheduled_start
    ? format(parseISO(shift.scheduled_start), "EEEE, d MMMM yyyy")
    : "this day";
  const timeLabel = formatShiftBlockTime(shift.scheduled_start, shift.scheduled_end);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border-0 p-0 overflow-hidden sm:max-w-md">
        <div className="px-6 pt-6 pb-2">
          <DialogHeader className="space-y-3 text-center sm:text-center">
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: 'var(--cc-active)' }}
            >
              <CalendarDays size={22} style={{ color: PLUM }} />
            </div>
            <DialogTitle className="text-xl font-black" style={{ color: TEXT }}>
              View full shift details?
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed" style={{ color: MUTED }}>
              You have a shift with{" "}
              <span className="font-bold" style={{ color: TEXT }}>
                {shift.participant_name || "your participant"}
              </span>
              {timeLabel ? (
                <>
                  {" "}
                  on <span className="font-semibold">{dateLabel}</span> at{" "}
                  <span className="font-semibold">{timeLabel}</span>.
                </>
              ) : (
                <> on <span className="font-semibold">{dateLabel}</span>.</>
              )}{" "}
              Would you like to open the full details?
            </DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="flex-col gap-2 border-t px-6 py-4 sm:flex-col sm:space-x-0">
          <button
            type="button"
            onClick={onViewDetails}
            className="w-full rounded-full py-3 text-sm font-black text-white"
            style={{ background: `linear-gradient(135deg, ${PLUM}, ${CORAL})` }}
          >
            View full details
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-full border py-3 text-sm font-black"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            Not now
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
