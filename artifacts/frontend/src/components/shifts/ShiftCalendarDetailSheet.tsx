import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { Clock3, MapPin, Navigation, X } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { BORDER, TEXT, MUTED, PLUM, formatShiftTimeRange } from "@/lib/shift-utils";
import type { CalendarShift } from "@/services/workerCalendarService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  shift: CalendarShift | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShiftCalendarDetailSheet({ shift, open, onOpenChange }: Props) {
  const { translate, translateParams } = useAccessibility();
  if (!shift) return null;

  const navUrl = shift.participant_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shift.participant_address)}`
    : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="border-b pb-4" style={{ borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle className="text-left text-lg font-black" style={{ color: TEXT }}>
                {shift.participant_name || translate("shift.calendar.fallbackTitle")}
              </DrawerTitle>
              <p className="mt-1 text-sm font-semibold" style={{ color: MUTED }}>
                {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
              </p>
            </div>
            <DrawerClose className="rounded-full p-2 hover:bg-slate-100">
              <X size={18} />
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-8 pt-4">
          {shift.participant_suburb && (
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: TEXT }}>
              <MapPin size={16} style={{ color: PLUM }} />
              {shift.participant_suburb}
            </div>
          )}
          {shift.participant_address && (
            <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
              {shift.participant_address}
            </p>
          )}
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>
            <Clock3 size={14} />
            {translateParams("shift.calendar.status", { status: shift.calendar_status })}
          </div>
          {shift.coordinator_notes && (
            <div className="rounded-xl border bg-cc-bg p-3 text-sm" style={{ borderColor: BORDER }}>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
                {translate("shift.calendar.coordinatorNotes")}
              </p>
              <p className="mt-1 font-medium" style={{ color: TEXT }}>{shift.coordinator_notes}</p>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            {navUrl && (
              <a
                href={navUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-xs font-black text-white"
                style={{ background: PLUM }}
              >
                <Navigation size={16} />
                {translate("shift.calendar.navigate")}
              </a>
            )}
            <Link href={`/my-shifts/${shift.id}`} className="flex-1">
              <button
                type="button"
                className="w-full rounded-full border py-3 text-xs font-black"
                style={{ borderColor: BORDER, color: PLUM }}
              >
                {translate("shift.calendar.fullDetails")}
              </button>
            </Link>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function anonymiseName(fullName?: string) {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return `${parts[0][0]}.`;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function shiftBlockStyle(shift: CalendarShift) {
  const colour = shift.participant_colour || PLUM;
  if (shift.calendar_status === "cancelled") {
    return {
      background: "#F1F5F9",
      borderLeft: "3px solid #94A3B8",
      color: "#64748B",
      textDecoration: "line-through",
    };
  }
  if (shift.calendar_status === "tentative") {
    return {
      background: `repeating-linear-gradient(45deg, ${colour}22, ${colour}22 6px, ${colour}11 6px, ${colour}11 12px)`,
      borderLeft: `3px solid ${colour}`,
      color: colour,
    };
  }
  return {
    background: `${colour}22`,
    borderLeft: `3px solid ${colour}`,
    color: colour,
  };
}

export function formatShiftBlockTime(start?: string, end?: string) {
  if (!start) return "";
  try {
    const s = format(parseISO(start), "h:mm a");
    const e = end ? format(parseISO(end), "h:mm a") : "";
    return e ? `${s} – ${e}` : s;
  } catch {
    return "";
  }
}
