import type { SearchableOption } from "@/components/ui/searchable-select";
import { birthDateForms, suburbFromAddress, workerDetail } from "@/lib/person-identity";

/** What a participant record might carry; pickers pass whatever they have. */
export type ParticipantLike = {
  id: string;
  full_name?: string | null;
  name?: string | null;
  preferred_name?: string | null;
  ndis_number?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  suburb?: string | null;
};

/** What a staff record might carry. */
export type StaffLike = {
  id: string;
  full_name?: string | null;
  name?: string | null;
  employee_id?: string | null;
  email?: string | null;
  phone?: string | null;
  suburb?: string | null;
  address?: string | null;
  role?: string | null;
};

const ROLE_WORDS: Record<string, string> = {
  support_worker: "Support worker",
  support_coordinator: "Care coordinator",
  managing_director: "Director",
  allied_health: "Allied health",
};

export function roleWords(role?: string | null): string | null {
  if (!role) return null;
  return ROLE_WORDS[role] ?? role.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * A participant as a picker option: their name, a line that tells them apart
 * from anyone with the same name (NDIS number and suburb), and everything
 * they can be found by: name, preferred name, NDIS number, phone, email,
 * address and date of birth (as 1992-05-14, 14/05/1992 or 14/5/1992).
 */
export function participantOption(p: ParticipantLike): SearchableOption {
  const label = (p.full_name || p.name || "Unnamed participant").trim();
  const suburb = p.suburb?.trim() || suburbFromAddress(p.address);
  const detail = [
    p.ndis_number ? `NDIS ${p.ndis_number}` : null,
    p.preferred_name && p.preferred_name !== label ? `Prefers ${p.preferred_name}` : null,
    suburb,
  ].filter(Boolean).join(" · ");
  return {
    value: p.id,
    label,
    detail: detail || null,
    keywords: [p.preferred_name, p.ndis_number, p.phone, p.email, p.address, suburb, ...birthDateForms(p.date_of_birth)]
      .filter((k): k is string => !!k),
  };
}

/**
 * A staff member as a picker option: name, a line with their staff ID and
 * suburb (else email or phone) and their role, found by any of those.
 */
export function staffOption(w: StaffLike): SearchableOption {
  const label = (w.full_name || w.name || "Unnamed").trim();
  const who = workerDetail({ full_name: label, employee_id: w.employee_id, suburb: w.suburb ?? suburbFromAddress(w.address), email: w.email, phone: w.phone });
  const role = roleWords(w.role);
  return {
    value: w.id,
    label,
    detail: [role, who].filter(Boolean).join(" · ") || null,
    keywords: [w.employee_id, w.email, w.phone, w.suburb, w.address, role].filter((k): k is string => !!k),
  };
}

export const PARTICIPANT_SEARCH = "Search by name, NDIS number, phone or date of birth";
export const STAFF_SEARCH = "Search by name, staff ID, phone or email";
