import { jsonFetch } from "@/services/http";
import { apiFetch } from "@/lib/api-fetch";
import { downloadBlob } from "@/lib/download-file";
import {
  demoInvoices,
  demoPlan,
  demoServiceAgreements,
  demoShifts,
  isPortalDemoOn,
  withDemoOverview,
} from "@/lib/portal-demo-data";

export type ParticipantShift = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  clocked_in_at?: string | null;
  clocked_out_at?: string | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  worker_id?: string | null;
  worker_name?: string | null;
};

export type ParticipantServiceAgreement = {
  id: string;
  plan_management_type: string;
  start_date: string;
  end_date?: string | null;
  status: string;
  [key: string]: unknown;
};

// The onboarding pipeline's "service agreement" stage uploads a signed PDF
// onto the participant's intake record — the mechanism actually in use
// today, separate from (and ahead of) the structured agreements above,
// which nothing yet creates through the UI.
export type ParticipantSignedDocument = {
  name: string | null;
  url: string | null;
  updated_at: string | null;
};

export type ParticipantServiceAgreementsResponse = {
  agreements: ParticipantServiceAgreement[];
  signed_document: ParticipantSignedDocument | null;
};

export type ParticipantInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  period_start: string;
  period_end: string;
  total_amount: number;
  status: string;
  pdf_url?: string | null;
};

export type PortalParticipant = {
  participant_id: string;
  full_name: string | null;
  preferred_name?: string | null;
  profile_photo_url?: string | null;
  relationship: string;
  relationship_label: string;
};

function forParticipant(path: string, participantId: string) {
  return `${path}?participant_id=${encodeURIComponent(participantId)}`;
}

export function listMyParticipants() {
  return jsonFetch<PortalParticipant[]>("/api/participant-portal/access");
}

export type NextOfKin = { name?: string; relationship?: string; phone?: string; email?: string };

/** Home page data — see GET /api/participant-portal/overview. Only
 * allowlisted fields; no clinical, internal or staff-contact details. */
export type PortalOverview = {
  profile: {
    id: string;
    full_name: string;
    preferred_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    date_of_birth?: string;
    ndis_number?: string;
    profile_photo_url?: string;
    plan_management_type?: string;
    emergency_contact_name?: string;
    emergency_contact_relationship?: string;
    emergency_contact_number?: string;
    interests?: string;
    favourite_activities?: string;
    preferred_activities?: string[] | string;
    daily_routine?: string;
    preferred_schedule?: string;
    service_category?: string | null;
    service_hours_required?: number | null;
    active_since?: string | null;
    intake: {
      given_name?: string;
      surname?: string;
      preferred_name?: string;
      pronouns?: string;
      gender?: string;
      preferred_language?: string;
      street_address?: string;
      suburb?: string;
      state?: string;
      postcode?: string;
      funding_type?: string;
      plan_status?: string;
      plan_start?: string;
      plan_end?: string;
      plan_manager_name?: string;
      plan_manager_org?: string;
      plan_manager_phone?: string;
      plan_manager_email?: string;
      next_of_kin?: NextOfKin[];
      presenting_needs?: string[];
    };
  };
  support_team: {
    id: string;
    full_name: string | null;
    profile_photo_url: string | null;
    role_label: string;
    is_assigned: boolean;
  }[];
  upcoming_shifts: ParticipantShift[];
  recent_shifts: ParticipantShift[];
  pinned: {
    service_agreement: { available: boolean; name?: string | null; updated_at?: string | null };
    ndis_plan: { available: boolean; plan_start?: string | null; plan_end?: string | null; status?: string | null };
  };
};

export type PortalPlan = {
  plan: {
    plan_number?: string | null;
    plan_start: string;
    plan_end: string;
    status: string;
    total_funding: number;
    plan_management_type?: string | null;
    budgets: { category: string; allocated: number; used: number; remaining: number }[];
  } | null;
  goals: { name: string; goal_area?: string | null; description?: string | null; target_date?: string | null; status?: string | null }[];
};

export async function getPortalOverview(participantId: string) {
  const real = await jsonFetch<PortalOverview>(forParticipant("/api/participant-portal/overview", participantId));
  return isPortalDemoOn() ? withDemoOverview(real) : real;
}

export async function getPortalPlan(participantId: string) {
  const real = await jsonFetch<PortalPlan>(forParticipant("/api/participant-portal/plan", participantId));
  if (!isPortalDemoOn()) return real;
  const demo = demoPlan();
  return { plan: real.plan ?? demo.plan, goals: real.goals.length ? real.goals : demo.goals };
}

// Dev-only design aid: with `?demo=on`, empty sections are filled with
// made-up examples (see lib/portal-demo-data.ts). Never active in production.

export async function listMyShifts(participantId: string) {
  const real = await jsonFetch<ParticipantShift[]>(forParticipant("/api/participant-portal/shifts", participantId));
  return isPortalDemoOn() && real.length === 0 ? demoShifts() : real;
}

export async function listMyServiceAgreements(participantId: string) {
  const real = await jsonFetch<ParticipantServiceAgreementsResponse>(
    forParticipant("/api/participant-portal/service-agreements", participantId),
  );
  return isPortalDemoOn() && !real.signed_document && real.agreements.length === 0 ? demoServiceAgreements() : real;
}

export async function listMyInvoices(participantId: string) {
  const real = await jsonFetch<ParticipantInvoice[]>(forParticipant("/api/participant-portal/invoices", participantId));
  return isPortalDemoOn() && real.length === 0 ? demoInvoices() : real;
}

// ── File downloads ──────────────────────────────────────────────────────
// Portal files need the signed-in token, so they're fetched here and then
// saved, rather than linked directly.

const DEMO_FILE_MESSAGE = "This is a demo invoice — there's no real file to download.";

function filenameFrom(disposition: string | null): string | null {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : null;
}

async function downloadPortalFile(path: string, fallbackName: string) {
  const response = await apiFetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || "The download didn't work. Please try again.");
  }
  downloadBlob(await response.blob(), filenameFrom(response.headers.get("content-disposition")) ?? fallbackName);
}

export function downloadInvoicePdf(participantId: string, invoice: Pick<ParticipantInvoice, "id" | "invoice_number">) {
  if (invoice.id.startsWith("demo-")) return Promise.reject(new Error(DEMO_FILE_MESSAGE));
  return downloadPortalFile(
    forParticipant(`/api/participant-portal/invoices/${encodeURIComponent(invoice.id)}/pdf`, participantId),
    `${invoice.invoice_number}.pdf`,
  );
}

export function downloadAllInvoices(participantId: string, invoices: Pick<ParticipantInvoice, "id">[]) {
  if (invoices.length > 0 && invoices.every((inv) => inv.id.startsWith("demo-"))) {
    return Promise.reject(new Error("These are demo invoices — there are no real files to download."));
  }
  return downloadPortalFile(forParticipant("/api/participant-portal/invoices/download-all", participantId), "invoices.zip");
}
