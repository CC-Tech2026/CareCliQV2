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
import { formatAppDate } from "@/lib/datetime";
import type { CalendarShift } from "@/services/workerCalendarService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";


type Props = {
  shift: CalendarShift | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewDetails: () => void;
};

export function WorkerShiftConfirmDialog({ shift, open, onOpenChange, onViewDetails }: Props) {
  const { translate, translateParams } = useAccessibility();
  if (!shift) return null;

  const dateLabel = shift.scheduled_start
    ? formatAppDate(shift.scheduled_start, shift.timezone, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : translate("shift.confirm.thisDay");
  const timeLabel = formatShiftBlockTime(shift.scheduled_start, shift.scheduled_end, shift.timezone);
  const participant = shift.participant_name || translate("shift.confirm.yourParticipant");
  const schedule = timeLabel
    ? translateParams("shift.confirm.onDateAtTime", { date: dateLabel, time: timeLabel })
    : translateParams("shift.confirm.onDate", { date: dateLabel });

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
              {translate("shift.confirm.title")}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed" style={{ color: MUTED }}>
              {translate("shift.confirm.intro")}{" "}
              <span className="font-bold" style={{ color: TEXT }}>
                {participant}
              </span>{" "}
              {schedule}. {translate("shift.confirm.prompt")}
            </DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="flex-col gap-2 border-t px-6 py-4 sm:flex-col sm:space-x-0">
          <button
            type="button"
            onClick={onViewDetails}
            className="w-full rounded-full py-3 text-sm font-black text-white"
            style={{ background: PLUM }}
          >
            {translate("shift.confirm.viewDetails")}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-full border py-3 text-sm font-black"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            {translate("shift.confirm.notNow")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
