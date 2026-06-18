import { format, parseISO } from "date-fns";
import type { ParticipantProfile } from "@/services/shiftService";
import { participantAge } from "@/lib/shift-utils";

export const PREFERENCE_COLLAPSE_CHARS = 180;

export function formatParticipantDob(dob?: string | null) {
  if (!dob) return null;
  try {
    return format(parseISO(dob), "d MMM yyyy");
  } catch {
    return dob;
  }
}

export function formatDobWithAge(dob?: string | null) {
  const formatted = formatParticipantDob(dob);
  if (!formatted) return null;
  const age = participantAge(dob);
  return age != null ? `${formatted} (${age} yrs)` : formatted;
}

export function emergencyContactDisplay(contact: ParticipantProfile["emergency_contact"]) {
  if (!contact) return null;
  if (typeof contact === "string") {
    return { text: contact, phone: contact.match(/[\d+() -]{8,}/)?.[0] };
  }
  return {
    text: contact.display || [contact.name, contact.relationship, contact.phone].filter(Boolean).join(" — "),
    phone: contact.phone || undefined,
  };
}

export function isLongPreferenceContent(body: string) {
  return body.length > PREFERENCE_COLLAPSE_CHARS;
}
