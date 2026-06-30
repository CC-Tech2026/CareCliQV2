import { jsonFetch } from "@/services/http";

export type SlotStatus = "available" | "unavailable" | "preferred";
export type TimeSlot = "morning" | "afternoon" | "evening";

export type AvailabilitySlot = {
  day_of_week: number;
  time_slot: TimeSlot;
  status: SlotStatus;
};

export type BlackoutDate = {
  id?: string;
  start_date: string;
  end_date: string;
  reason?: string | null;
};

export type WorkerAvailabilityResponse = {
  slots: AvailabilitySlot[];
  preferences: {
    max_shifts_per_week: number;
    emergency_override_date?: string | null;
    emergency_override_expires_at?: string | null;
    updated_at?: string;
    days_since_updated?: number;
    is_stale?: boolean;
  };
  blackout_dates: BlackoutDate[];
};

export const SLOT_LABELS: Record<TimeSlot, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_CYCLE: SlotStatus[] = ["available", "unavailable", "preferred"];

export function nextSlotStatus(current: SlotStatus): SlotStatus {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

export function getWorkerAvailability() {
  return jsonFetch<WorkerAvailabilityResponse>("/api/worker/availability");
}

export function updateAvailabilitySlots(slots: AvailabilitySlot[]) {
  return jsonFetch<WorkerAvailabilityResponse>("/api/worker/availability/slots", {
    method: "PUT",
    body: JSON.stringify({ slots }),
  });
}

export function updateAvailabilityPreferences(max_shifts_per_week: number) {
  return jsonFetch<WorkerAvailabilityResponse>("/api/worker/availability/preferences", {
    method: "PUT",
    body: JSON.stringify({ max_shifts_per_week }),
  });
}

export function updateAvailabilityBlackouts(blackout_dates: BlackoutDate[]) {
  return jsonFetch<WorkerAvailabilityResponse>("/api/worker/availability/blackouts", {
    method: "PUT",
    body: JSON.stringify({ blackout_dates }),
  });
}

export function setEmergencyAvailabilityOverride(target_date: string) {
  return jsonFetch<WorkerAvailabilityResponse>("/api/worker/availability/emergency-override", {
    method: "POST",
    body: JSON.stringify({ target_date }),
  });
}
