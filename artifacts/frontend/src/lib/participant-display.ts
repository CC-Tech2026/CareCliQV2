import { format, parseISO } from "date-fns";
import { displayDate } from "@/lib/datetime";
import type { ParticipantProfile } from "@/services/shiftService";
import { participantAge } from "@/lib/shift-utils";

export const PREFERENCE_COLLAPSE_CHARS = 180;

export function formatParticipantDob(dob?: string | null) {
  if (!dob) return null;
  try {
    return format(displayDate(dob), "d MMM yyyy");
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

// A phone number starts with a digit, "+" or "(0" and ends with a digit:
// "0491 570 159", "+61 491 570 159", "(08) 8123 4567". Starting there keeps
// a closing bracket before the number ("(Mother) 0491...") out of it.
const PHONE_IN_TEXT = /(?:\+\d|\(\d|\d)[\d\s()-]{6,}\d/;

/** "Kate Williams (Mother) 0491 570 159" or "Sam Lee — Brother — 0400 999 888"
 *  as name, relationship and phone. Unrecognised text keeps its words as
 *  the name, so nothing typed is ever hidden. */
export function parseContactText(raw: string) {
  const text = raw.trim();
  const phone = text.match(PHONE_IN_TEXT)?.[0]?.trim() || undefined;
  let rest = phone ? text.replace(phone, " ") : text;
  let relationship: string | null = null;
  const bracketed = rest.match(/\(([^()\d]{2,40})\)/);
  if (bracketed) {
    relationship = bracketed[1].trim();
    rest = rest.replace(bracketed[0], " ");
  }
  const parts = rest
    .split(/\s[—–-]\s|[,;:·|]/)
    .map((p) => p.replace(/\s+/g, " ").replace(/^[—–-]\s*|\s*[—–-]$/g, "").trim())
    .filter(Boolean);
  const name = parts[0] || null;
  if (!relationship && parts.length > 1) relationship = parts.slice(1).join(", ");
  const detail = [relationship, phone].filter(Boolean).join(" · ");
  return { text, name, relationship, phone, detail };
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
    return parseContactText(contact);
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
