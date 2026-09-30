/**
 * Participants Portal DEMO DATA — for design work only.
 *
 * Fills EMPTY portal sections (shifts, invoices, NDIS plan, support team,
 * intake details…) with made-up examples so layouts can be judged with
 * realistic content. Real data is never replaced, only gaps are filled.
 *
 * Safety:
 *  - Only in the Vite dev server (`import.meta.env.DEV`); production builds
 *    strip this path entirely, so it can never reach real users.
 *  - Off until switched on: "Show demo data" in the portal's account menu
 *    (dev only), or `?demo=on` / `?demo=off` on any URL. Remembered in this
 *    browser.
 *  - The portal top bar shows a "Demo data" badge whenever it's on.
 */
import type {
  ParticipantInvoice,
  ParticipantServiceAgreementsResponse,
  ParticipantShift,
  PortalOverview,
  PortalPlan,
} from "@/services/participantPortalService";

const FLAG_KEY = "cc.participantPortal.demoData";

function readFlag(): boolean {
  try {
    return window.localStorage.getItem(FLAG_KEY) === "on";
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) window.localStorage.setItem(FLAG_KEY, "on");
    else window.localStorage.removeItem(FLAG_KEY);
  } catch {
    // Unavailable storage just means the flag lasts for this page only.
  }
}

let memoryFlag: boolean | null = null;

export function isPortalDemoOn(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  const param = new URLSearchParams(window.location.search).get("demo");
  if (param === "on" || param === "off") {
    memoryFlag = param === "on";
    writeFlag(memoryFlag);
  }
  return memoryFlag ?? readFlag();
}

// Record `?demo=on|off` as soon as the app loads, on whatever page — the
// sign-in page and the profile picker redirect without keeping the query.
isPortalDemoOn();

export function setPortalDemo(on: boolean) {
  memoryFlag = on;
  writeFlag(on);
}

export function turnPortalDemoOff() {
  setPortalDemo(false);
}

// ── Builders ────────────────────────────────────────────────────────────

function at(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function day(daysFromNow: number): string {
  return at(daysFromNow, 12).slice(0, 10);
}

const WORKERS = [
  { id: "demo-w1", name: "Sarah Kim" },
  { id: "demo-w2", name: "Daniel Okafor" },
];

function shift(id: string, dayOffset: number, startHour: number, hours: number, status: ParticipantShift["status"], worker = 0): ParticipantShift {
  return {
    id,
    scheduled_start: at(dayOffset, startHour),
    scheduled_end: at(dayOffset, startHour + hours),
    clocked_in_at: status === "completed" ? at(dayOffset, startHour) : null,
    clocked_out_at: status === "completed" ? at(dayOffset, startHour + hours) : null,
    status,
    worker_id: WORKERS[worker].id,
    worker_name: WORKERS[worker].name,
  };
}

export function demoShifts(): ParticipantShift[] {
  return [
    shift("demo-s1", 1, 9, 3, "scheduled"),
    shift("demo-s2", 3, 9, 3, "scheduled"),
    shift("demo-s3", 5, 13, 2, "scheduled", 1),
    shift("demo-s4", 8, 9, 3, "scheduled"),
    shift("demo-s5", -2, 9, 3, "completed"),
    shift("demo-s6", -4, 13, 2, "completed", 1),
    shift("demo-s7", -7, 9, 3, "completed"),
    shift("demo-s8", -9, 9, 3, "cancelled"),
  ];
}

export function demoInvoices(): ParticipantInvoice[] {
  const inv = (n: number, periodEndOffset: number, amount: number, status: string): ParticipantInvoice => ({
    id: `demo-inv-${n}`,
    invoice_number: `INV-2026-${String(1040 + n).padStart(4, "0")}`,
    invoice_date: day(periodEndOffset + 1),
    period_start: day(periodEndOffset - 13),
    period_end: day(periodEndOffset),
    total_amount: amount,
    status,
    pdf_url: null,
  });
  return [
    inv(6, -3, 1284.6, "sent"),
    inv(5, -17, 1190.4, "overdue"),
    inv(4, -31, 1320.0, "paid"),
    inv(3, -45, 1098.75, "paid"),
    inv(2, -59, 1250.2, "paid"),
    inv(1, -73, 980.0, "paid"),
  ];
}

export function demoPlan(): PortalPlan {
  return {
    plan: {
      plan_number: "430 000 001 / 2026",
      plan_start: day(-90),
      plan_end: day(275),
      status: "active",
      total_funding: 58400,
      plan_management_type: "plan_managed",
      budgets: [
        { category: "Core — Daily Activities", allocated: 36000, used: 14250.5, remaining: 21749.5 },
        { category: "Core — Social & Community", allocated: 12400, used: 3890, remaining: 8510 },
        { category: "Capacity Building — Daily Living", allocated: 10000, used: 2100, remaining: 7900 },
      ],
    },
    goals: [
      { name: "Cook a simple meal on my own", goal_area: "Daily living", description: "Plan and cook two meals a week with support.", target_date: day(120), status: "active" },
      { name: "Catch the bus to the community centre", goal_area: "Community access", description: "Travel independently on familiar routes.", target_date: day(180), status: "active" },
      { name: "Join a weekly art group", goal_area: "Social participation", description: null, target_date: day(240), status: "active" },
    ],
  };
}

export function demoServiceAgreements(): ParticipantServiceAgreementsResponse {
  return {
    agreements: [
      { id: "demo-sa-1", plan_management_type: "Plan-managed", start_date: day(-90), end_date: day(275), status: "active" },
    ],
    // No real file behind the demo agreement — the link is a dead anchor.
    signed_document: { name: "service-agreement-demo.pdf", url: "#demo-document", updated_at: day(-92) },
  };
}

function fill<T extends object>(real: T, demo: T): T {
  const out = { ...demo } as Record<string, unknown>;
  for (const [key, value] of Object.entries(real)) {
    const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (!empty) out[key] = value;
  }
  return out as T;
}

export function withDemoOverview(real: PortalOverview): PortalOverview {
  const shifts = demoShifts();
  const upcoming = shifts.filter((s) => s.status === "scheduled").slice(0, 3);
  const recent = shifts.filter((s) => s.status === "completed").slice(0, 3);
  const plan = demoPlan().plan!;
  return {
    profile: {
      ...fill(real.profile, {
        ...real.profile,
        phone: "0400 123 456",
        email: "participant@example.com",
        address: "12 Example Street, Glenelg, SA 5045",
        ndis_number: "430 000 001",
        date_of_birth: "1990-03-22",
        plan_management_type: "plan_managed",
        emergency_contact_name: "Ann Well",
        emergency_contact_relationship: "Sister",
        emergency_contact_number: "0400 987 654",
        service_category: "disability",
        service_hours_required: 12,
        active_since: day(-92),
      }),
      intake: fill(real.profile.intake, {
        preferred_name: real.profile.full_name?.split(" ")[0],
        pronouns: "he_him",
        gender: "male",
        preferred_language: "English",
        funding_type: "plan_managed",
        plan_start: plan.plan_start,
        plan_end: plan.plan_end,
        plan_manager_name: "Pat Planner",
        plan_manager_org: "Example Plan Management",
        plan_manager_phone: "08 8000 0000",
        plan_manager_email: "accounts@example.com",
        next_of_kin: [{ name: "Ann Well", relationship: "Sister", phone: "0400 987 654" }],
        presenting_needs: ["Daily living", "Community access", "Meal preparation", "Transport"],
      }),
    },
    support_team: real.support_team.length
      ? real.support_team
      : [
          { id: WORKERS[0].id, full_name: WORKERS[0].name, profile_photo_url: null, role_label: "Support worker", is_assigned: true },
          { id: WORKERS[1].id, full_name: WORKERS[1].name, profile_photo_url: null, role_label: "Support worker", is_assigned: false },
        ],
    upcoming_shifts: real.upcoming_shifts.length ? real.upcoming_shifts : upcoming,
    recent_shifts: real.recent_shifts.length ? real.recent_shifts : recent,
    pinned: {
      service_agreement: real.pinned.service_agreement.available
        ? real.pinned.service_agreement
        : { available: true, name: "service-agreement-demo.pdf", updated_at: day(-92) },
      ndis_plan: real.pinned.ndis_plan.available
        ? real.pinned.ndis_plan
        : { available: true, plan_start: plan.plan_start, plan_end: plan.plan_end, status: "active" },
    },
  };
}
