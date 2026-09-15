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
    // emergency_contact is a legacy TEXT column: most rows are free text,
    // but some were written as a JSON-encoded {name, phone, relationship}
    // object before next_of_kin's native JSONB shape existed. Parse that
    // shape here instead of falling through to raw-JSON-as-text below.
    const trimmed = contact.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          contact = parsed as NonNullable<ParticipantProfile["emergency_contact"]>;
        }
      } catch {
        // not valid JSON — treat as free text below
      }
    }
  }
  if (typeof contact === "string") {
    return { text: contact, phone: contact.match(/[\d+() -]{8,}/)?.[0], name: null, relationship: null };
  }
  const name = contact.name?.trim() || null;
  const relationship = contact.relationship?.trim() || null;
  const phone = contact.phone?.trim() || undefined;
  const detail = [relationship, phone].filter(Boolean).join(" · ");
  return {
    name,
    relationship,
    phone,
    text: contact.display || [name, detail].filter(Boolean).join(" — ") || phone || name || "",
    detail,
  };
}

export function isLongPreferenceContent(body: string) {
  return body.length > PREFERENCE_COLLAPSE_CHARS;
}
