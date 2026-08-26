/**
 * Shared bridge between three separate, deliberately backend-less pieces —
 * the public referral form (participant-referral.tsx), the Participant
 * Onboarding board (onboard-participant.tsx, in-memory only), and the Hub
 * dashboard's "Waiting list" cards — so a referral submitted publicly can
 * actually show up as an Enquiry-stage card on the board, and its requested
 * service hours can be totalled for the Hub, without giving onboarding a
 * real backend table (out of scope — see onboard-participant.tsx's own note
 * on why: intake records even hold local blob URLs that can't survive a
 * reload anyway).
 *
 * Flow:
 *   1. participant-referral.tsx calls addPendingReferral() on submit.
 *   2. onboard-participant.tsx reads readPendingReferrals() once on mount
 *      and turns each into an Enquiry-column Intake card (re-derived fresh
 *      every mount, same as the rest of that page's state).
 *   3. onboard-participant.tsx calls writeWaitlistSnapshot() whenever its
 *      intakes change, mirroring just the enquiry-stage count + total
 *      requested hours (not full records) for the Hub to read.
 */

export type PendingReferral = {
  id: string;
  full_name: string;
  service_category: "aged_care" | "disability";
  service_hours_required: number;
  phone?: string;
  email?: string;
  ndis_number?: string;
  primary_disability?: string;
  support_needs?: string;
  referrer_name: string;
  referrer_relationship: string;
  referrer_phone?: string;
  referrer_email?: string;
  submitted_at: string;
};

const PENDING_REFERRALS_KEY = "cc:onboarding:pending-referrals";

export function readPendingReferrals(): PendingReferral[] {
  try {
    const raw = localStorage.getItem(PENDING_REFERRALS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addPendingReferral(referral: PendingReferral): void {
  try {
    const existing = readPendingReferrals();
    localStorage.setItem(PENDING_REFERRALS_KEY, JSON.stringify([...existing, referral]));
  } catch {
    // Private browsing / storage disabled — the referral just won't appear
    // on the board or count toward Hub demand.
  }
}

export type WaitlistSnapshot = { count: number; hours: number };

const WAITLIST_SNAPSHOT_KEY = "cc:onboarding:waitlist-snapshot";

export function readWaitlistSnapshot(): WaitlistSnapshot {
  try {
    const raw = localStorage.getItem(WAITLIST_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const count = Number(parsed?.count);
    const hours = Number(parsed?.hours);
    return {
      count: Number.isFinite(count) && count >= 0 ? count : 0,
      hours: Number.isFinite(hours) && hours >= 0 ? hours : 0,
    };
  } catch {
    return { count: 0, hours: 0 };
  }
}

export function writeWaitlistSnapshot(snapshot: WaitlistSnapshot): void {
  try {
    localStorage.setItem(WAITLIST_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Private browsing / storage disabled — the Hub cards just show 0.
  }
}
