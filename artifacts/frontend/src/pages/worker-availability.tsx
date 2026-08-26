import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { cn } from "@/lib/utils";
import { SectionInfo } from "@/components/ui/section-info";
import {
  getWorkerAvailability,
  nextSlotStatus,
  setEmergencyAvailabilityOverride,
  updateAvailabilityBlackouts,
  updateAvailabilityPreferences,
  updateAvailabilitySlots,
  type AvailabilitySlot,
  type BlackoutDate,
  type SlotStatus,
  type TimeSlot,
} from "@/services/workerAvailabilityService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];

const SLOT_KEYS: Record<TimeSlot, string> = {
  morning: "availability.slot.morning",
  afternoon: "availability.slot.afternoon",
  evening: "availability.slot.evening",
};

const DAY_KEYS = [
  "scheduleRequests.days.mon",
  "scheduleRequests.days.tue",
  "scheduleRequests.days.wed",
  "scheduleRequests.days.thu",
  "scheduleRequests.days.fri",
  "scheduleRequests.days.sat",
  "scheduleRequests.days.sun",
] as const;

const STATUS_STYLES: Record<SlotStatus, { className: string; key: string }> = {
  available: {
    className: "cc-status-success border",
    key: "availability.status.available",
  },
  unavailable: {
    className: "cc-status-critical border",
    key: "availability.status.unavailable",
  },
  preferred: {
    className: "border border-cc-border bg-cc-active-bg text-cc-plum",
    key: "availability.status.preferred",
  },
};

export default function WorkerAvailabilityPage() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useOrgQuery(["worker", "availability"], {
    queryFn: getWorkerAvailability,
  });

  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [maxShifts, setMaxShifts] = useState(5);
  const [blackouts, setBlackouts] = useState<BlackoutDate[]>([]);
  const [newBlackout, setNewBlackout] = useState({ start_date: "", end_date: "", reason: "" });

  useEffect(() => {
    if (!data) return;
    setSlots(data.slots);
    setMaxShifts(data.preferences.max_shifts_per_week);
    setBlackouts(data.blackout_dates);
  }, [data]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["worker", "availability"] });

  const slotsMut = useMutation({
    mutationFn: () => updateAvailabilitySlots(slots),
    onSuccess: () => { toast({ title: translate("availability.saved") }); invalidate(); },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const prefsMut = useMutation({
    mutationFn: () => updateAvailabilityPreferences(maxShifts),
    onSuccess: () => { toast({ title: translate("availability.preferenceSaved") }); invalidate(); },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const blackoutsMut = useMutation({
    mutationFn: () => updateAvailabilityBlackouts(blackouts),
    onSuccess: () => { toast({ title: translate("availability.blackoutsSaved") }); invalidate(); },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const emergencyMut = useMutation({
    mutationFn: (date: string) => setEmergencyAvailabilityOverride(date),
    onSuccess: () => { toast({ title: translate("availability.emergencyActive") }); invalidate(); },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const toggleSlot = (day: number, time_slot: TimeSlot) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.day_of_week === day && s.time_slot === time_slot
          ? { ...s, status: nextSlotStatus(s.status) }
          : s,
      ),
    );
  };

  const getSlot = (day: number, time_slot: TimeSlot) =>
    slots.find((s) => s.day_of_week === day && s.time_slot === time_slot)?.status ?? "available";

  const addBlackout = () => {
    if (!newBlackout.start_date || !newBlackout.end_date) return;
    if (blackouts.length >= 12) {
      toast({ title: translate("availability.maxBlackouts"), variant: "destructive" });
      return;
    }
    setBlackouts((prev) => [...prev, { ...newBlackout }]);
    setNewBlackout({ start_date: "", end_date: "", reason: "" });
  };

  const prefs = data?.preferences;
  const overrideActive = prefs?.emergency_override_expires_at && prefs.emergency_override_date;

  return (
    <div className="w-full space-y-5 pb-10">
      <header>
        <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: CORAL }}>{translate("common.supportWorker")}</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-black" style={{ color: TEXT }}>
          {translate("availability.title")}
          <SectionInfo text="Set the days and times you're available to work, so coordinators can offer you shifts that fit." />
        </h1>
        <Link href="/calendar" className="mt-2 inline-block text-xs font-black" style={{ color: PLUM }}>
          {translate("availability.backToCalendar")}
        </Link>
        {prefs?.updated_at && (
          <p className="mt-2 text-xs font-semibold" style={{ color: prefs.is_stale ? "var(--cc-coral)" : MUTED }}>
            {translateParams("availability.lastUpdatedDays", { days: String(prefs.days_since_updated ?? 0) })}
            {prefs.is_stale && translate("availability.staleSuffix")}
          </p>
        )}
      </header>

      {isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}

      <section className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
        <h2 className="text-sm font-black mb-3" style={{ color: TEXT }}>{translate("availability.weekly")}</h2>
        <p className="text-xs mb-3" style={{ color: MUTED }}>{translate("availability.tapHint")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-center text-[10px]">
            <thead>
              <tr>
                <th />
                {DAY_KEYS.map((key) => (
                  <th key={key} className="pb-2 font-black" style={{ color: MUTED }}>{translate(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLOTS.map((slot) => (
                <tr key={slot}>
                  <td className="pr-2 text-left font-black" style={{ color: MUTED }}>{translate(SLOT_KEYS[slot])}</td>
                  {DAY_KEYS.map((_, i) => {
                    const day = i + 1;
                    const status = getSlot(day, slot);
                    const style = STATUS_STYLES[status];
                    return (
                      <td key={day} className="p-0.5">
                        <button
                          type="button"
                          onClick={() => toggleSlot(day, slot)}
                          className={cn("h-9 w-full rounded-lg text-[8px] font-bold transition-colors", style.className)}
                          title={translate(style.key)}
                        >
                          {status[0].toUpperCase()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={() => slotsMut.mutate()}
          disabled={slotsMut.isPending}
          className="cc-btn-primary mt-4 w-full cursor-pointer rounded-full py-2.5 text-xs font-black disabled:opacity-50"
        >
          {translate("availability.saveGrid")}
        </button>
      </section>

      <section className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
        <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("availability.maxShifts")}</h2>
        <p className="text-xs mt-1 mb-3" style={{ color: MUTED }}>{translate("availability.maxShiftsHint")}</p>
        <input
          type="range"
          min={1}
          max={7}
          value={maxShifts}
          onChange={(e) => setMaxShifts(Number(e.target.value))}
          className="w-full accent-[var(--cc-plum)]"
        />
        <p className="text-center text-lg font-black mt-1" style={{ color: PLUM }}>{maxShifts}</p>
        <button
          type="button"
          onClick={() => prefsMut.mutate()}
          disabled={prefsMut.isPending}
          className="cc-btn-primary mt-2 w-full cursor-pointer rounded-full py-2.5 text-xs font-black disabled:opacity-50"
        >
          {translate("availability.savePreference")}
        </button>
      </section>

      <section className="rounded-2xl border bg-card p-4 space-y-3" style={{ borderColor: BORDER }}>
        <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("availability.blackoutDates")}</h2>
        <p className="text-xs" style={{ color: MUTED }}>{translate("availability.blackoutHint")}</p>
        {blackouts.map((b, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg bg-cc-soft px-3 py-2 text-xs" style={{ color: TEXT }}>
            <span>{b.start_date} – {b.end_date}{b.reason ? ` (${b.reason})` : ""}</span>
            <button
              type="button"
              onClick={() => setBlackouts((prev) => prev.filter((_, idx) => idx !== i))}
              className="font-bold text-red-600 dark:text-red-400"
            >
              {translate("availability.remove")}
            </button>
          </div>
        ))}
        <div className="grid gap-2 sm:grid-cols-2">
          <input type="date" className="cc-field" value={newBlackout.start_date} onChange={(e) => setNewBlackout((p) => ({ ...p, start_date: e.target.value }))} />
          <input type="date" className="cc-field" value={newBlackout.end_date} onChange={(e) => setNewBlackout((p) => ({ ...p, end_date: e.target.value }))} />
        </div>
        <input
          type="text"
          placeholder={translate("availability.noteOptional")}
          className="cc-field"
          value={newBlackout.reason}
          onChange={(e) => setNewBlackout((p) => ({ ...p, reason: e.target.value }))}
        />
        <div className="flex gap-2">
          <button type="button" onClick={addBlackout} className="cc-btn-outline flex-1 cursor-pointer rounded-full py-2 text-xs font-black">
            {translate("availability.addRange")}
          </button>
          <button
            type="button"
            onClick={() => blackoutsMut.mutate()}
            disabled={blackoutsMut.isPending}
            className="cc-btn-primary flex-1 cursor-pointer rounded-full py-2 text-xs font-black disabled:opacity-50"
          >
            {translate("availability.saveBlackouts")}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border cc-status-warning p-4">
        <h2 className="text-sm font-black">{translate("availability.emergency")}</h2>
        <p className="text-xs mt-1 mb-3 opacity-90">
          {translate("availability.emergencyHint")}
        </p>
        {overrideActive && (
          <p className="text-xs font-bold mb-2 opacity-90">
            {translateParams("availability.emergencyActiveFor", { date: prefs?.emergency_override_date ?? "" })}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => emergencyMut.mutate(format(new Date(), "yyyy-MM-dd"))}
            disabled={emergencyMut.isPending}
            className="cc-btn-amber flex-1 cursor-pointer rounded-full py-2.5 text-xs font-black disabled:opacity-50"
          >
            {translate("availability.today")}
          </button>
          <button
            type="button"
            onClick={() => emergencyMut.mutate(format(addDays(new Date(), 1), "yyyy-MM-dd"))}
            disabled={emergencyMut.isPending}
            className="cc-btn-amber flex-1 cursor-pointer rounded-full py-2.5 text-xs font-black disabled:opacity-50"
          >
            {translate("availability.tomorrow")}
          </button>
        </div>
      </section>
    </div>
  );
}
