import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft, HeartHandshake, ClipboardCheck, Mic, FileSignature, Send, CheckCircle2, Clock3,
  Loader2, ChevronRight, Search, PenLine, PhoneCall, Mail, XCircle, ShieldCheck, Users, Square, Upload,
  MapPin, User, FileText,
} from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  createMeetingSession, transcribeAndResolveNames,
  type ConsentGivenBy, type ConsentMethod,
} from "@/services/coordinatorService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";
const SUCCESS = "var(--cc-status-success)";
const SUCCESS_BG = "var(--cc-status-success-bg)";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";
const INFO = "var(--cc-status-info)";
const INFO_BG = "var(--cc-status-info-bg)";
const DANGER = "var(--cc-status-danger)";
const DANGER_BG = "var(--cc-status-danger-bg)";
const CRITICAL = "var(--cc-status-critical)";
const CRITICAL_BG = "var(--cc-status-critical-bg)";
const CORAL = "var(--cc-coral)";
// "New" badge matches Staff Onboarding's ApplicantCard exactly — same
// neutral bg/text pairing and coral dot, not a colored pill like the
// other badges here.
const NEW_BADGE_BG = "#EEF1F5";
const NEW_BADGE_TEXT = "#3D5A6C";

/**
 * UI-only build of the participant onboarding pipeline (Enquiry → Screening →
 * Meet & Greet → Service Agreement → Activate). Data lives in local component
 * state for now — there is no participant_onboarding backend yet, so nothing
 * here persists across a page reload. Wiring to a real API is a separate pass.
 */

type IntakeStatus = "enquiry" | "screening" | "declined" | "withdrawn" | "meet_greet" | "awaiting_signatures" | "signed" | "active";

type EnquirySource = "online_form" | "email" | "phone_call" | "coordinator_referral";

type Intake = {
  id: string;
  full_name: string;
  ndis_number: string;
  email: string;
  phone: string;
  source: EnquirySource;
  status: IntakeStatus;
  decline_reason?: string;
  /** Set when the MD terminates the application because the participant chose not to continue with this provider (distinct from decline, which is the provider saying no). */
  withdrawn_reason?: string;
  screening_recording_url?: string;
  meet_greet_recording_url?: string;
  meet_greet_notes?: string;
  /** The physically-signed service agreement, uploaded as evidence. Local blob URL for now — no backend storage yet. */
  signed_document_url?: string;
  signed_document_name?: string;
  plan_start_date?: string;
  plan_end_date?: string;
  total_budget?: string;
  provider_signed_name?: string;
  provider_signed_at?: string;
  family_signed_name?: string;
  family_signed_at?: string;
  /** Free-text override for the board card's second line (e.g. "NDIS plan received", "Scheduled 9 Jul, 2:00 PM"). */
  board_subtitle?: string;
  activated_at?: string;
  created_at: string;
  /** Present when this enquiry came in through the public web referral form. */
  web_intake?: WebIntakeForm;
};

type NextOfKinEntry = {
  name: string;
  relationship?: string;
  phone?: string;
  email?: string;
};

type WebIntakeForm = {
  submitted_at: string;
  submitted_by?: string;
  given_name?: string;
  surname?: string;
  preferred_name?: string;
  pronouns?: string;
  gender?: string;
  date_of_birth?: string;
  street_address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  plan_status?: string;
  plan_start?: string;
  plan_end?: string;
  plan_manager_name?: string;
  plan_manager_org?: string;
  plan_manager_phone?: string;
  plan_manager_email?: string;
  next_of_kin?: NextOfKinEntry[];
  referral_source?: string;
  referral_date?: string;
  presenting_needs?: string[];
  notes?: string;
};

const SOURCE_META: Record<EnquirySource, { label: string; icon: typeof Mail }> = {
  online_form: { label: "Web referral", icon: ClipboardCheck },
  email: { label: "Email", icon: Mail },
  phone_call: { label: "Phone call", icon: PhoneCall },
  coordinator_referral: { label: "Support coordinator referral", icon: Users },
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

// Accepts digits, spaces, parentheses, +, - only, with a sane digit count
// (covers AU mobiles/landlines and most international formats).
const PHONE_ALLOWED_CHARS = /^[\d\s()+-]+$/;
function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  const digitCount = trimmed.replace(/\D/g, "").length;
  return PHONE_ALLOWED_CHARS.test(trimmed) && digitCount >= 8 && digitCount <= 15;
}

const STATUS_META: Record<IntakeStatus, { label: string; bg: string; color: string }> = {
  enquiry: { label: "New enquiry", bg: SOFT, color: MUTED },
  screening: { label: "Screening", bg: SOFT, color: MUTED },
  declined: { label: "Declined", bg: DANGER_BG, color: DANGER },
  withdrawn: { label: "Withdrawn", bg: SOFT, color: MUTED },
  meet_greet: { label: "Meet & Greet", bg: INFO_BG, color: INFO },
  awaiting_signatures: { label: "Awaiting signatures", bg: WARNING_BG, color: WARNING },
  signed: { label: "Ready to activate", bg: INFO_BG, color: INFO },
  active: { label: "Active", bg: SUCCESS_BG, color: SUCCESS },
};

// Five-stage journey shown as a stepper in the detail view's sidebar.
const STEPS = [
  { key: "enquiry", label: "Enquiry", icon: Mail },
  { key: "screening", label: "Screening", icon: ClipboardCheck },
  { key: "meet_greet", label: "Meet & Greet", icon: Mic },
  { key: "signatures", label: "Service Agreement", icon: PenLine },
  { key: "active", label: "Active", icon: ShieldCheck },
] as const;

function stepIndexForStatus(status: IntakeStatus): number {
  switch (status) {
    case "enquiry": return 0;
    case "screening": return 1;
    case "meet_greet": return 2;
    case "awaiting_signatures": return 3;
    case "signed": return 3;
    case "active": return 4;
    default: return 0;
  }
}

// The landing page groups participants into these five working columns.
// Declined and withdrawn intakes have left the pipeline entirely — dead
// ends, so they don't get a column and aren't shown on the board.
const BOARD_COLUMNS = [
  { id: "enquiry", label: "Enquiry" },
  { id: "screening", label: "Screening" },
  { id: "meet_greet", label: "Meet and greet" },
  { id: "service_agreement", label: "Service agreement" },
  { id: "active", label: "Active" },
] as const;

type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"];

// Per-column accent colors — same visual language as Staff Onboarding's
// STAGE_COLOR (colored top border + dot + tinted count pill per column).
// "active" intentionally reuses the exact same green as staff's Active
// column since it's the same underlying concept on both boards.
const COLUMN_COLOR: Record<BoardColumnId, string> = {
  enquiry: "#8A78D6",
  screening: "#D39B42",
  meet_greet: "#3B82F6",
  service_agreement: "#C77D3E",
  active: "#0F7B57",
};

function columnIdForStatus(status: IntakeStatus): BoardColumnId | null {
  switch (status) {
    case "enquiry": return "enquiry";
    case "screening": return "screening";
    case "meet_greet": return "meet_greet";
    case "awaiting_signatures":
    case "signed": return "service_agreement";
    case "active": return "active";
    default: return null;
  }
}

/** KPI stat tile — same tinted-background + icon-badge pattern as Staff Onboarding's KpiTile. */
function KpiTile({ label, value, color, bg, icon: Icon }: { label: string; value: number; color: string; bg: string; icon?: typeof Clock3 }) {
  return (
    <div className="rounded-[1.25rem] px-5 py-4.5" style={{ background: bg }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[30px] font-black leading-none" style={{ color }}>{value}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.65)", color }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

/** Small pill badge used on board cards (New / Aging / Easy Capture ready / Awaiting sign / Complete). */
function CardBadge({ icon: Icon, label, color, bg, dot }: { icon?: typeof Clock3; label: string; color: string; bg: string; dot?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9.5px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dot }} />}
      {Icon && <Icon size={9} />} {label}
    </span>
  );
}

/** Board-card badge for a given intake, or null if none applies. */
function badgeForIntake(intake: Intake): { icon?: typeof Clock3; label: string; color: string; bg: string; dot?: string } | null {
  const column = columnIdForStatus(intake.status);
  const age = daysSince(intake.created_at);
  if (column === "enquiry" || column === "screening") {
    if (age < 1) return { label: "New", color: NEW_BADGE_TEXT, bg: NEW_BADGE_BG, dot: CORAL };
    if (age >= 7) return { icon: Clock3, label: "Aging", color: WARNING, bg: WARNING_BG };
    return null;
  }
  if (column === "meet_greet") {
    return intake.screening_recording_url ? { icon: Mic, label: "Easy Capture ready", color: CRITICAL, bg: CRITICAL_BG } : null;
  }
  if (column === "service_agreement") {
    return intake.status === "awaiting_signatures" ? { label: "Awaiting sign", color: SUCCESS, bg: SUCCESS_BG } : null;
  }
  if (column === "active") {
    return { icon: CheckCircle2, label: "Complete", color: SUCCESS, bg: SUCCESS_BG };
  }
  return null;
}

/** Board-card subtitle (second line) for a given intake. */
function subtitleForIntake(intake: Intake): string {
  if (intake.board_subtitle) return intake.board_subtitle;
  const column = columnIdForStatus(intake.status);
  switch (column) {
    case "enquiry": {
      const age = daysSince(intake.created_at);
      const relative = age < 1 ? "today" : age === 1 ? "1 day ago" : `${age} days ago`;
      return `${SOURCE_META[intake.source].label} · ${relative}`;
    }
    case "screening": return "Awaiting plan copy";
    case "meet_greet": return "Awaiting scheduling";
    case "service_agreement":
      return intake.status === "awaiting_signatures" ? "Sent for signature"
        : intake.status === "signed" ? "Signed — ready to activate"
        : "Draft ready";
    case "active":
      return intake.activated_at
        ? `Onboarded ${new Date(intake.activated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`
        : "Onboarded";
    default: return "";
  }
}

function initials(name: string) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({ name, size = 40, color = PLUM }: { name: string; size?: number; color?: string }) {
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-black text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: color }}
    >
      {initials(name)}
    </div>
  );
}

function StatusBadge({ status }: { status: IntakeStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="text-[10px] font-black px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

/** One participant card inside a board column — same shape as Staff Onboarding's ApplicantCard/OversightCard. */
function ParticipantCard({ intake, onClick }: { intake: Intake; onClick: () => void }) {
  const badge = badgeForIntake(intake);
  const subtitle = subtitleForIntake(intake);
  const column = columnIdForStatus(intake.status);
  const accent = column ? COLUMN_COLOR[column] : PLUM;
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: SURFACE, borderColor: BORDER, borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-start gap-3">
        <Avatar name={intake.full_name} size={36} color={accent} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{intake.full_name}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: MUTED }}>{subtitle}</p>
        </div>
      </div>
      {badge && <div className="mt-2"><CardBadge {...badge} /></div>}
    </button>
  );
}

/**
 * Horizontal stepper at the top of the detail view. Each step is one "page"
 * of the flow — clicking a reached step (done or current) switches the
 * single content panel below to that step; steps not reached yet are
 * disabled since there's nothing to show there.
 */
function HorizontalStepper({ status, viewedStep, onSelect }: { status: IntakeStatus; viewedStep: number; onSelect: (i: number) => void }) {
  if (status === "declined" || status === "withdrawn") {
    const meta = STATUS_META[status];
    return (
      <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: meta.bg }}>
        <XCircle size={16} style={{ color: meta.color }} className="shrink-0" />
        <p className="text-xs font-bold" style={{ color: meta.color }}>{meta.label}</p>
      </div>
    );
  }
  const current = stepIndexForStatus(status);
  return (
    <div className="flex items-start">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const isCurrent = i === current;
        const reachable = i <= current;
        const selected = i === viewedStep;
        const last = i === STEPS.length - 1;
        return (
          <div key={s.key} className={`flex items-center ${last ? "" : "flex-1"}`}>
            <button
              type="button"
              onClick={() => reachable && onSelect(i)}
              disabled={!reachable}
              className="flex flex-col items-center gap-1.5 shrink-0 disabled:cursor-default"
            >
              <div
                className="h-10 w-10 rounded-full flex items-center justify-center transition-all"
                style={{
                  background: done ? SUCCESS : isCurrent ? PLUM : SOFT,
                  color: done || isCurrent ? "#fff" : MUTED,
                  outline: selected ? `2px solid ${PLUM}` : "2px solid transparent",
                  outlineOffset: 2,
                }}
              >
                {done ? <CheckCircle2 size={18} /> : <Icon size={16} />}
              </div>
              <p className="text-[11px] font-bold whitespace-nowrap" style={{ color: selected || isCurrent ? TEXT : MUTED }}>{s.label}</p>
            </button>
            {!last && <div className="h-[2px] flex-1 mx-2" style={{ background: i < current ? SUCCESS : BORDER, marginBottom: 20 }} />}
          </div>
        );
      })}
    </div>
  );
}

let nextId = 2;

// One seeded dummy enquiry so the board isn't empty on first load — local
// state only, same as everything else here, so it resets on page reload.
const SEED_INTAKES: Intake[] = [
  {
    id: "1",
    full_name: "Sam Rivera",
    ndis_number: "430987621",
    email: "sam.rivera@email.com",
    phone: "0412 344 187",
    source: "online_form",
    status: "enquiry",
    created_at: new Date().toISOString(),
    web_intake: {
      submitted_at: new Date().toISOString(),
      submitted_by: "Family",
      given_name: "Sam",
      surname: "Rivera",
      preferred_name: "Sam",
      pronouns: "They/them",
      gender: "Non-binary",
      date_of_birth: "1998-03-14",
      street_address: "42 Rosewood Drive",
      suburb: "Ringwood",
      state: "VIC",
      postcode: "3134",
      plan_status: "Active plan",
      plan_start: "2026-02-01",
      plan_end: "2027-01-31",
      plan_manager_name: "Rachel Owens",
      plan_manager_org: "Compass Plan Management",
      plan_manager_phone: "1300 889 200",
      plan_manager_email: "rachel.owens@compasspm.com.au",
      next_of_kin: [
        { name: "Claire Rivera", relationship: "Mother", phone: "0413 778 291", email: "claire.rivera@email.com" },
        { name: "Derek Rivera", relationship: "Father", phone: "0404 112 835" },
      ],
      referral_source: "Web referral portal",
      referral_date: new Date().toISOString().slice(0, 10),
      presenting_needs: ["Personal care", "Community access"],
      notes: "Sam's family is seeking support for personal care and community access. They recently transitioned out of a school-based setting and this is their first NDIS-funded provider engagement.",
    },
  },
];

export default function ParticipantOnboardingBoard() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Selected intake lives in the URL (?intake=<id>), same convention as
  // /team?workerId=...&tab=... elsewhere in the app. This also lets the
  // shared OnboardingWorkspace shell hide the Staff/Participants toggle
  // while a detail view is open, without the board needing to know
  // anything about that shell.
  const urlSearch = useSearch();
  const selectedId = new URLSearchParams(urlSearch).get("intake");

  const [intakes, setIntakes] = useState<Intake[]>(SEED_INTAKES);
  const [search, setSearch] = useState("");
  const [newIntakeOpen, setNewIntakeOpen] = useState(false);

  const [fullName, setFullName] = useState("");
  const [ndisNumber, setNdisNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<EnquirySource>("online_form");

  function createIntake() {
    const intake: Intake = {
      id: String(nextId++),
      full_name: fullName.trim(),
      ndis_number: ndisNumber.trim(),
      email: email.trim(),
      phone: phone.trim(),
      source,
      status: "enquiry",
      created_at: new Date().toISOString(),
    };
    setIntakes((prev) => [intake, ...prev]);
    setNewIntakeOpen(false);
    setFullName(""); setNdisNumber(""); setEmail(""); setPhone(""); setSource("online_form");
    navigate(`/onboard-participant?intake=${intake.id}`);
    toast({ title: "Enquiry logged", description: `${intake.full_name} is in the Enquiry column.` });
  }

  function updateIntake(id: string, patch: Partial<Intake>) {
    setIntakes((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  const selected = selectedId ? intakes.find((i) => i.id === selectedId) ?? null : null;

  if (selected) {
    return (
      <IntakeDetail intake={selected} onBack={() => navigate("/onboard-participant")} onUpdate={(patch) => updateIntake(selected.id, patch)} />
    );
  }

  const q = search.trim().toLowerCase();
  const matches = (i: Intake) => !q || i.full_name.toLowerCase().includes(q) || i.ndis_number.toLowerCase().includes(q);

  // KPI strip. "Active participants" and "Ready for signature" mean org-wide
  // counts once a real backend exists — for now they're scoped to what this
  // page knows about locally.
  const openEnquiries = intakes.filter((i) => i.status !== "active" && i.status !== "declined").length;
  const stuckCount = intakes.filter((i) => i.status !== "active" && i.status !== "declined" && daysSince(i.created_at) >= 7).length;
  const activeCount = intakes.filter((i) => i.status === "active").length;
  const readyForSignatureCount = intakes.filter((i) => i.status === "awaiting_signatures").length;

  function comingSoon(feature: string) {
    toast({ title: "Coming soon", description: `${feature} isn't built yet — it needs its own scoped piece of work.` });
  }

  return (
    <>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate("/hub")}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-black/5"
              style={{ color: MUTED, background: SOFT }}
            >
              <ArrowLeft size={13} strokeWidth={2.5} /> {translate("md.backToHub")}
            </button>
            <h1 className="text-2xl font-black tracking-tight mt-2" style={{ color: TEXT }}>Participant Onboarding</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate("/participant-referral")}
              className="text-[12px] font-black transition-colors hover:opacity-80 flex items-center gap-1"
              style={{ color: PLUM }}
            >
              View public referral form <ChevronRight size={13} />
            </button>
            <Button variant="outline" className="rounded-lg" onClick={() => comingSoon("Referral portal settings")}>
              Referral portal settings
            </Button>
            <Button variant="navy" className="gap-2 rounded-lg shrink-0" onClick={() => setNewIntakeOpen(true)}>
              <HeartHandshake size={15} /> New referral
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label="Open enquiries" value={openEnquiries} color={CRITICAL} bg={CRITICAL_BG} icon={ClipboardCheck} />
          <KpiTile label="Stuck 7+ days" value={stuckCount} color={WARNING} bg={WARNING_BG} icon={Clock3} />
          <KpiTile label="Active participants" value={activeCount} color={SUCCESS} bg={SUCCESS_BG} icon={ShieldCheck} />
          <KpiTile label="Ready for signature" value={readyForSignatureCount} color={INFO} bg={INFO_BG} icon={PenLine} />
        </div>

        <div className="relative w-full max-w-[260px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 h-9 rounded-lg text-sm" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
          {BOARD_COLUMNS.map((col) => {
            const columnIntakes = intakes.filter((i) => columnIdForStatus(i.status) === col.id && matches(i));
            const color = COLUMN_COLOR[col.id];
            return (
              <div
                key={col.id}
                className="rounded-[1.25rem] border-t-[3px] p-4 flex flex-col gap-3"
                style={{ background: SOFT, borderTopColor: color }}
              >
                <div className="flex items-center justify-between px-0.5 pb-0.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                    <p className="text-[13px] font-black" style={{ color: TEXT }}>{col.label}</p>
                  </div>
                  <span
                    className="flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[10px] font-black"
                    style={{ background: `${color}1F`, color }}
                  >
                    {columnIntakes.length}
                  </span>
                </div>
                <div className="space-y-2 max-h-[65vh] overflow-y-auto">
                  {columnIntakes.length === 0 && (
                    <p className="rounded-xl border border-dashed py-8 text-center text-[10px] font-medium" style={{ color: MUTED }}>Nobody here</p>
                  )}
                  {columnIntakes.map((i) => (
                    <ParticipantCard key={i.id} intake={i} onClick={() => navigate(`/onboard-participant?intake=${i.id}`)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      <Sheet open={newIntakeOpen} onOpenChange={setNewIntakeOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <HeartHandshake size={18} style={{ color: PLUM }} /> New Referral
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Full name</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Sam Rivera" autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>NDIS number</label>
              <Input value={ndisNumber} onChange={(e) => setNdisNumber(e.target.value)} placeholder="e.g. 430123456" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="family@example.com"
                aria-invalid={email.length > 0 && !isValidEmail(email)}
                className={email.length > 0 && !isValidEmail(email) ? "border-red-400 focus-visible:ring-red-400" : undefined}
              />
              {email.length > 0 && !isValidEmail(email) && (
                <p className="text-[11px] font-medium" style={{ color: DANGER }}>Enter a valid email address (e.g. name@example.com).</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Phone (optional)</label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0412 345 678"
                  aria-invalid={phone.length > 0 && !isValidPhone(phone)}
                  className={phone.length > 0 && !isValidPhone(phone) ? "border-red-400 focus-visible:ring-red-400" : undefined}
                />
                {phone.length > 0 && !isValidPhone(phone) && (
                  <p className="text-[11px] font-medium" style={{ color: DANGER }}>Enter a valid phone number.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Enquiry source</label>
                <Select value={source} onValueChange={(v) => setSource(v as EnquirySource)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online_form">Web referral</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone_call">Phone call</SelectItem>
                    <SelectItem value="coordinator_referral">Support coordinator referral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <SheetFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setNewIntakeOpen(false)}>Cancel</Button>
            <Button
              variant="navy"
              onClick={createIntake}
              disabled={!fullName.trim() || !ndisNumber.trim() || !isValidEmail(email) || (phone.trim().length > 0 && !isValidPhone(phone))}
            >
              Log enquiry
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function IntakeDetail({
  intake, onBack, onUpdate,
}: {
  intake: Intake;
  onBack: () => void;
  onUpdate: (patch: Partial<Intake>) => void;
}) {
  const { toast } = useToast();
  const [declineReason, setDeclineReason] = useState("");
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState("");
  const [notes, setNotes] = useState(intake.meet_greet_notes ?? "");
  const [providerName, setProviderName] = useState(intake.provider_signed_name ?? "");
  const [familyName, setFamilyName] = useState(intake.family_signed_name ?? "");
  const [activating, setActivating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [boardSubtitle, setBoardSubtitle] = useState(intake.board_subtitle ?? "");

  // Which step's page is currently shown. Auto-advances to the new current
  // step whenever an action moves the intake forward; clicking a past step
  // in the horizontal stepper can still look back without losing this sync.
  const [viewedStep, setViewedStep] = useState(() => stepIndexForStatus(intake.status));
  useEffect(() => {
    setViewedStep(stepIndexForStatus(intake.status));
  }, [intake.status]);

  const { user } = useAuth();

  // ── Easy Capture — shared by Screening and Meet & Greet, one mic session
  // at a time, writing into whichever field is passed to startRecording.
  // Screening is audio-only (local blob, no upload). Meet & Greet uses the
  // same real, AI-backed pipeline as the coordinator's Easy Capture
  // elsewhere in the app (createMeetingSession + transcribeAndResolveNames)
  // — this intake isn't a real participant yet, so the session is created
  // "unassigned" (participant_id omitted), which the backend already
  // supports. Goal/task auto-extraction is intentionally skipped — that
  // writes to a real participant's plan, which doesn't exist pre-activation.
  const [recording, setRecording] = useState(false);
  const [recordingField, setRecordingField] = useState<"screening_recording_url" | "meet_greet_recording_url" | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const meetingSessionIdRef = useRef<string | null>(null);

  // Consent selection for the real, AI-transcribed Meet & Greet recording —
  // mirrors the coordinator's Easy Capture, which cannot start recording
  // without it. The confirmation checkbox itself lives in ConsentPanel,
  // which only mounts between recordings, so it resets on its own —
  // "each new recording attempt needs its own consent confirmation".
  const [consentGivenBy, setConsentGivenBy] = useState<ConsentGivenBy>("participant");
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>("verbal");

  useEffect(() => {
    // Stop the mic and timer if the detail view unmounts mid-recording.
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function transcribeMeetGreet(sessionId: string, audioBlob: Blob) {
    setTranscribing(true);
    try {
      const result = await transcribeAndResolveNames(sessionId, audioBlob, user?.full_name, intake.full_name, []);
      const transcriptText = result.clean_transcript
        .map((seg) => (seg.speaker_name ? `${seg.speaker_name}: ${seg.text}` : seg.text))
        .join("\n");
      if (transcriptText.trim()) {
        setNotes((prev) => (prev ? `${prev}\n\n${transcriptText}` : transcriptText));
        toast({ title: "Transcribed", description: "The conversation has been added to your notes." });
      } else {
        toast({ title: "Nothing transcribed", description: "No speech was detected in the recording." });
      }
    } catch (err: any) {
      toast({ title: "Transcription failed", description: err?.message ?? "The recording was saved, but couldn't be transcribed.", variant: "destructive" });
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording(field: "screening_recording_url" | "meet_greet_recording_url") {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({ title: "Voice recording not supported", description: "Please use a different browser or device.", variant: "destructive" });
      return;
    }
    if (field === "meet_greet_recording_url") {
      try {
        const session = await createMeetingSession(
          "check_in",
          new Date().toISOString().slice(0, 10),
          undefined,
          undefined, // no participant_id — this intake isn't a real participant yet
          consentGivenBy,
          consentMethod,
        );
        meetingSessionIdRef.current = session.session_id;
      } catch (err: any) {
        toast({ title: "Could not start Easy Capture", description: err?.message ?? "Check the backend is reachable.", variant: "destructive" });
        return;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/mp4";
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        onUpdate({ [field]: url });
        if (field === "meet_greet_recording_url" && meetingSessionIdRef.current) {
          transcribeMeetGreet(meetingSessionIdRef.current, blob);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setElapsedSec(0);
      setRecording(true);
      setRecordingField(field);
      timerRef.current = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        toast({ title: "Microphone access denied", description: "Allow microphone access to record.", variant: "destructive" });
      } else if (err?.name === "NotFoundError") {
        toast({ title: "No microphone found", description: "Connect a microphone to record.", variant: "destructive" });
      } else {
        toast({ title: "Failed to start recording", description: err?.message ?? "", variant: "destructive" });
      }
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    setRecordingField(null);
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }

  function saveEnquiryDraft() {
    onUpdate({ decline_reason: declineReason.trim() || undefined });
    toast({ title: "Draft saved" });
  }

  // Moves the pipeline pointer back one step. Non-destructive — whatever
  // was entered on the step being left (notes, signatory names, etc.)
  // stays intact, so moving forward again doesn't lose anything.
  function goBack() {
    const prevStatus: IntakeStatus =
      intake.status === "screening" ? "enquiry"
      : intake.status === "meet_greet" ? "screening"
      : intake.status === "awaiting_signatures" || intake.status === "signed" ? "meet_greet"
      : intake.status;
    onUpdate({ status: prevStatus });
    toast({ title: "Moved back" });
  }

  function startScreening() {
    onUpdate({ status: "screening" });
    toast({ title: "Moved to Screening" });
  }

  function saveScreeningDraft() {
    onUpdate({ decline_reason: declineReason.trim() || undefined });
    toast({ title: "Draft saved" });
  }

  function accept() {
    onUpdate({ status: "meet_greet" });
    toast({ title: "Moved to Meet & Greet" });
  }

  function decline() {
    if (!declineReason.trim()) return;
    onUpdate({ status: "declined", decline_reason: declineReason.trim() });
    toast({ title: "Enquiry declined" });
  }

  // Terminate — the participant decided not to continue with this provider.
  // Distinct from Decline (the provider saying no): available from any
  // in-progress step, not just Enquiry/Screening.
  function terminate() {
    if (!terminateReason.trim()) return;
    if (recording) stopRecording(); // don't leave the mic hot if terminated mid-recording
    onUpdate({ status: "withdrawn", withdrawn_reason: terminateReason.trim() });
    setTerminateOpen(false);
    toast({ title: "Application terminated", description: `${intake.full_name} chose not to continue with this provider.` });
  }

  function saveMeetGreetDraft() {
    onUpdate({ meet_greet_notes: notes.trim() });
    toast({ title: "Draft saved" });
  }

  function saveMeetGreetAndContinue() {
    onUpdate({ meet_greet_notes: notes.trim(), status: "awaiting_signatures" });
    toast({ title: "Sent for signature", description: "Service agreement is ready for both signatures." });
  }

  function saveSignatureDraft() {
    onUpdate({
      provider_signed_name: providerName.trim() || undefined,
      family_signed_name: familyName.trim() || undefined,
    });
    toast({ title: "Draft saved" });
  }

  // Local blob URL for now — no document storage backend for participant
  // onboarding yet, same constraint as the rest of this page.
  function uploadSignedDocument(file: File) {
    const url = URL.createObjectURL(file);
    onUpdate({ signed_document_url: url, signed_document_name: file.name });
    toast({ title: "Document uploaded", description: file.name });
  }

  function markSigned() {
    if (!providerName.trim() || !familyName.trim()) return;
    const now = new Date().toISOString();
    onUpdate({
      status: "signed",
      provider_signed_name: providerName.trim(),
      provider_signed_at: now,
      family_signed_name: familyName.trim(),
      family_signed_at: now,
    });
    toast({ title: "Service agreement signed" });
  }

  function activate() {
    setActivating(true);
    // No backend yet — simulate the activation call so the flow is
    // demonstrable end-to-end until the participant_onboarding API lands.
    setTimeout(() => {
      onUpdate({ status: "active", activated_at: new Date().toISOString() });
      setActivating(false);
      toast({ title: "Participant activated", description: `${intake.full_name} now appears on the Coordinator's dashboard.` });
    }, 500);
  }

  const signLink = intake.status === "awaiting_signatures"
    ? `${window.location.origin}/participant-onboarding-sign?intake=${intake.id}`
    : null;

  return (
    <div className="space-y-5 pb-10">
      <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold -ml-2.5" style={{ color: PLUM }}>
        <ArrowLeft size={15} /> Back to enquiries
      </button>

      <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
        <HorizontalStepper status={intake.status} viewedStep={viewedStep} onSelect={setViewedStep} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        {/* Main column — one step's page at a time */}
        <div className="space-y-5 min-w-0">
          {intake.status === "declined" || intake.status === "withdrawn" ? (
            <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                <XCircle size={16} style={{ color: STATUS_META[intake.status].color }} />
                <p className="text-sm font-black" style={{ color: TEXT }}>{STATUS_META[intake.status].label}</p>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: STATUS_META[intake.status].bg }}>
                  <XCircle size={16} style={{ color: STATUS_META[intake.status].color }} className="shrink-0" />
                  <p className="text-xs" style={{ color: TEXT }}>
                    {intake.status === "withdrawn"
                      ? intake.withdrawn_reason || "The participant chose not to continue with this provider."
                      : intake.decline_reason || "Declined."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Enquiry */}
              {viewedStep === 0 && (
                <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <Mail size={16} style={{ color: PLUM }} />
                    <p className="text-sm font-black" style={{ color: TEXT }}>Enquiry</p>
                  </div>

                  <div className="p-5 space-y-3">
                    {intake.web_intake && <IntakeFormView intake={intake} />}

                    {intake.status === "enquiry" ? (
                      <>
                        <p className="text-xs" style={{ color: MUTED }}>
                          Logged via {SOURCE_META[intake.source].label.toLowerCase()}. Start screening when you're ready to review this enquiry.
                        </p>
                        <div className="pt-2 space-y-1.5">
                          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Decline reason</label>
                          <div className="flex gap-2">
                            <Input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. Outside our service area" />
                            <Button variant="outline" className="shrink-0 gap-2 rounded-lg" style={{ color: DANGER }} onClick={decline} disabled={!declineReason.trim()}>
                              <XCircle size={14} /> Decline
                            </Button>
                          </div>
                        </div>
                        <div className="flex justify-between gap-2 pt-1">
                          <Button variant="outline" className="gap-2 rounded-lg" onClick={onBack}>
                            <ArrowLeft size={14} /> Back
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="outline" className="rounded-lg" onClick={saveEnquiryDraft}>
                              Save Draft
                            </Button>
                            <Button variant="navy" className="gap-2 rounded-lg" onClick={startScreening}>
                              Next <ClipboardCheck size={14} />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                        <CheckCircle2 size={16} style={{ color: SUCCESS }} className="shrink-0" />
                        <p className="text-xs font-bold" style={{ color: SUCCESS }}>
                          Logged via {SOURCE_META[intake.source].label.toLowerCase()}. Passed to screening.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Screening */}
              {viewedStep === 1 && (
                <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <ClipboardCheck size={16} style={{ color: PLUM }} />
                    <p className="text-sm font-black" style={{ color: TEXT }}>Screening</p>
                  </div>
                  <div className="p-5 space-y-3">
                    {intake.status === "screening" ? (
                      <>
                        <EasyCaptureBlock
                          label="Screening call"
                          recordingUrl={intake.screening_recording_url}
                          isRecording={recording && recordingField === "screening_recording_url"}
                          elapsedSec={elapsedSec}
                          onStart={() => startRecording("screening_recording_url")}
                          onStop={stopRecording}
                        />
                        <p className="text-xs" style={{ color: MUTED }}>Can this organisation take this participant on?</p>
                        <div className="pt-2 space-y-1.5">
                          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Decline reason</label>
                          <div className="flex gap-2">
                            <Input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. Outside our service area" />
                            <Button variant="outline" className="shrink-0 gap-2 rounded-lg" style={{ color: DANGER }} onClick={decline} disabled={!declineReason.trim()}>
                              <XCircle size={14} /> Decline
                            </Button>
                          </div>
                        </div>
                        <div className="flex justify-between gap-2 pt-1">
                          <Button variant="outline" className="gap-2 rounded-lg" onClick={goBack}>
                            <ArrowLeft size={14} /> Back
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="outline" className="rounded-lg" onClick={saveScreeningDraft}>
                              Save Draft
                            </Button>
                            <Button variant="navy" className="gap-2 rounded-lg" onClick={accept}>
                              Next <CheckCircle2 size={14} />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                          <CheckCircle2 size={16} style={{ color: SUCCESS }} className="shrink-0" />
                          <p className="text-xs font-bold" style={{ color: SUCCESS }}>Passed screening.</p>
                        </div>
                        {intake.screening_recording_url && (
                          <audio controls src={intake.screening_recording_url} className="w-full h-9" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Meet & Greet */}
              {viewedStep === 2 && (
                <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER}}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <Mic size={16} style={{ color: PLUM }} />
                    <p className="text-sm font-black" style={{ color: TEXT }}>Meet &amp; Greet</p>
                  </div>
                  <div className="p-5 space-y-3">
                    {intake.status === "meet_greet" ? (
                      recording && recordingField === "meet_greet_recording_url" ? (
                        <EasyCaptureBlock
                          label="Meet & greet"
                          recordingUrl={intake.meet_greet_recording_url}
                          isRecording
                          elapsedSec={elapsedSec}
                          onStart={() => {}}
                          onStop={stopRecording}
                          transcribesToNotes
                        />
                      ) : (
                        <>
                          <ConsentPanel
                            consentGivenBy={consentGivenBy}
                            onConsentGivenByChange={setConsentGivenBy}
                            consentMethod={consentMethod}
                            onConsentMethodChange={setConsentMethod}
                            onConfirm={() => startRecording("meet_greet_recording_url")}
                          />
                          {intake.meet_greet_recording_url && (
                            <audio controls src={intake.meet_greet_recording_url} className="w-full h-9" />
                          )}
                          {transcribing && (
                            <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                              <Loader2 size={13} className="animate-spin" /> Transcribing the conversation…
                            </div>
                          )}
                        </>
                      )
                    ) : (
                      intake.meet_greet_recording_url && (
                        <audio controls src={intake.meet_greet_recording_url} className="w-full h-9" />
                      )
                    )}
                    <p className="text-xs" style={{ color: MUTED }}>Key notes from the meet &amp; greet.</p>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Key notes from the meet & greet…"
                      className="min-h-[100px]"
                      disabled={intake.status !== "meet_greet"}
                    />
                    {intake.status === "meet_greet" && (
                      <div className="flex justify-between gap-2">
                        <Button variant="outline" className="gap-2 rounded-lg" onClick={goBack}>
                          <ArrowLeft size={14} /> Back
                        </Button>
                        <div className="flex gap-2">
                          <Button variant="outline" className="rounded-lg" onClick={saveMeetGreetDraft}>
                            Save Draft
                          </Button>
                          <Button variant="navy" className="gap-2 rounded-lg" onClick={saveMeetGreetAndContinue}>
                            Next <Send size={14} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Service Agreement / Signatures */}
              {viewedStep === 3 && (
                <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <FileSignature size={16} style={{ color: PLUM }} />
                    <p className="text-sm font-black" style={{ color: TEXT }}>Service Agreement</p>
                  </div>
                  <div className="p-5 space-y-3">
                    {intake.status === "awaiting_signatures" ? (
                      <>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Provider signatory</label>
                            <Input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Your full name" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Participant / guardian signatory</label>
                            <Input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Their full name" />
                          </div>
                        </div>
                        {signLink && (
                          <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: WARNING_BG }}>
                            <Mail size={14} style={{ color: WARNING }} className="shrink-0" />
                            <p className="text-xs flex-1" style={{ color: TEXT }}>Consent form and service agreement sent to {intake.email || "the family"}.</p>
                          </div>
                        )}
                        <div className="flex justify-between gap-2">
                          <Button variant="outline" className="gap-2 rounded-lg" onClick={goBack}>
                            <ArrowLeft size={14} /> Back
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="outline" className="rounded-lg" onClick={saveSignatureDraft}>
                              Save Draft
                            </Button>
                            <Button variant="navy" className="gap-2 rounded-lg" onClick={markSigned} disabled={!providerName.trim() || !familyName.trim()}>
                              Next <PenLine size={14} />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-3">
                        <SignatureCard label="Provider" signedName={intake.provider_signed_name} signedAt={intake.provider_signed_at} pendingLabel="Not yet signed" />
                        <SignatureCard label="Participant / guardian" signedName={intake.family_signed_name} signedAt={intake.family_signed_at} pendingLabel="Not yet signed" />
                      </div>
                    )}

                    <div className="rounded-lg p-3 flex items-center justify-between gap-3" style={{ background: SOFT }}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--cc-bg)", color: PLUM }}>
                          <Upload size={15} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black" style={{ color: TEXT }}>Signed document</p>
                          <p className="text-[11px] truncate" style={{ color: MUTED }}>
                            {intake.signed_document_name || "Upload the physically-signed service agreement"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {intake.signed_document_url && (
                          <a href={intake.signed_document_url} target="_blank" rel="noreferrer" className="text-xs font-bold underline px-1.5" style={{ color: PLUM }}>View</a>
                        )}
                        <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={() => fileInputRef.current?.click()}>
                          <Upload size={13} /> {intake.signed_document_url ? "Replace" : "Upload"}
                        </Button>
                      </div>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadSignedDocument(file);
                        e.target.value = "";
                      }}
                    />

                    {intake.status === "signed" && (
                      <Button variant="navy" className="w-full gap-2 rounded-lg" onClick={activate} disabled={activating}>
                        {activating ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Activate participant
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Active */}
              {viewedStep === 4 && (
                <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <ShieldCheck size={16} style={{ color: PLUM }} />
                    <p className="text-sm font-black" style={{ color: TEXT }}>Active</p>
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                      <Users size={16} style={{ color: SUCCESS }} className="shrink-0" />
                      <p className="text-xs" style={{ color: TEXT }}>
                        {intake.full_name.split(" ")[0]} is active and now appears on the Coordinator's dashboard for scheduling and support planning.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Terminate application — available from any in-progress step, not just
                  Enquiry/Screening. Distinct from Decline: this is the participant's own
                  choice not to continue, not the provider turning them away. */}
              {intake.status !== "active" && (
                <div className="rounded-lg border p-4" style={{ background: SOFT, borderColor: BORDER }}>
                  {!terminateOpen ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setTerminateOpen(true)}
                      className="gap-1.5 rounded-lg hover:bg-transparent hover:opacity-80"
                      style={{ color: "#DC2626" }}
                    >
                      <XCircle size={13} /> Terminate application
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px]" style={{ color: MUTED }}>
                        Use this if the participant has decided not to continue with this provider. Ends the pipeline immediately from any stage.
                      </p>
                      <Input value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} placeholder="e.g. Chose a different provider" />
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setTerminateOpen(false); setTerminateReason(""); }}>
                          Cancel
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-lg" style={{ color: DANGER }} onClick={terminate} disabled={!terminateReason.trim()}>
                          <XCircle size={13} className="mr-1.5" /> Confirm termination
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <Avatar name={intake.full_name} size={44} />
            <h2 className="text-base font-black mt-3" style={{ color: TEXT }}>{intake.full_name}</h2>
            <div className="mt-1"><StatusBadge status={intake.status} /></div>
            <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: BORDER }}>
              <p className="text-xs" style={{ color: MUTED }}>NDIS {intake.ndis_number || "—"}</p>
              {intake.email && <p className="text-xs" style={{ color: MUTED }}>{intake.email}</p>}
              {intake.phone && <p className="text-xs" style={{ color: MUTED }}>{intake.phone}</p>}
              <p className="text-xs flex items-center gap-1.5" style={{ color: MUTED }}>
                {(() => { const Icon = SOURCE_META[intake.source].icon; return <Icon size={12} />; })()}
                {SOURCE_META[intake.source].label}
              </p>
            </div>
          </div>

          {intake.status !== "enquiry" && intake.status !== "declined" && intake.status !== "withdrawn" && intake.status !== "active" && (
            <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
              <label className="text-[10px] font-black uppercase tracking-wide mb-2 block" style={{ color: MUTED }}>Board card note</label>
              <Input
                value={boardSubtitle}
                onChange={(e) => setBoardSubtitle(e.target.value)}
                onBlur={() => onUpdate({ board_subtitle: boardSubtitle.trim() || undefined })}
                placeholder={subtitleForIntake(intake)}
                className="text-sm"
              />
              <p className="text-[10px] mt-1.5" style={{ color: MUTED }}>Shown as the second line on the board card.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function formatElapsed(sec: number): string {
  return `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;
}

function ConsentPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 h-9 rounded-full text-[12px] font-bold transition-all"
      style={active ? { background: PLUM, color: "#fff" } : { background: SURFACE, color: TEXT, border: `1px solid ${BORDER}` }}
    >
      {label}
    </button>
  );
}

/**
 * Consent gate before the real, AI-transcribed Meet & Greet recording —
 * same requirement as the coordinator's Easy Capture: recording cannot
 * start without explicit, confirmed consent.
 */
function ConsentPanel({
  consentGivenBy, onConsentGivenByChange, consentMethod, onConsentMethodChange, onConfirm,
}: {
  consentGivenBy: ConsentGivenBy;
  onConsentGivenByChange: (v: ConsentGivenBy) => void;
  consentMethod: ConsentMethod;
  onConsentMethodChange: (v: ConsentMethod) => void;
  onConfirm: () => void;
}) {
  // Local, not lifted to the parent — this panel only mounts between
  // recording attempts, so remounting it naturally resets the checkbox,
  // which is exactly "each new attempt needs its own consent confirmation".
  const [checked, setChecked] = useState(false);
  const consentGivenByLabel = consentGivenBy === "participant" ? "the participant" : consentGivenBy === "nominee" ? "their nominee" : "their guardian";
  return (
    <div className="rounded-lg p-4 space-y-3" style={{ background: SOFT }}>
      <div className="flex items-start gap-2.5">
        <ShieldCheck size={16} style={{ color: PLUM }} className="shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-black" style={{ color: TEXT }}>Consent required</p>
          <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>Recording cannot start without explicit consent.</p>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>Consent given by</p>
        <div className="flex gap-1.5">
          <ConsentPill label="Participant" active={consentGivenBy === "participant"} onClick={() => onConsentGivenByChange("participant")} />
          <ConsentPill label="Nominee" active={consentGivenBy === "nominee"} onClick={() => onConsentGivenByChange("nominee")} />
          <ConsentPill label="Guardian" active={consentGivenBy === "guardian"} onClick={() => onConsentGivenByChange("guardian")} />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>Method</p>
        <div className="flex gap-1.5">
          <ConsentPill label="Verbal" active={consentMethod === "verbal"} onClick={() => onConsentMethodChange("verbal")} />
          <ConsentPill label="Written" active={consentMethod === "written"} onClick={() => onConsentMethodChange("written")} />
        </div>
      </div>
      <label className="flex items-start gap-2 rounded-lg p-3 cursor-pointer" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded shrink-0" />
        <span className="text-[11px]" style={{ color: TEXT }}>
          I confirm <strong>{consentGivenByLabel}</strong> has been informed the conversation will be recorded and has given {consentMethod} consent.
        </span>
      </label>
      <Button variant="navy" className="w-full gap-2 rounded-lg" onClick={onConfirm} disabled={!checked}>
        <Mic size={14} /> Confirm consent &amp; record
      </Button>
    </div>
  );
}

function formatDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function DetailField({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: typeof Mail }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="text-sm font-bold flex items-center gap-1.5 mt-0.5" style={{ color: TEXT }}>
        {Icon && <Icon size={13} style={{ color: MUTED }} className="shrink-0" />}
        {value}
      </p>
    </div>
  );
}

function IntakeFormSection({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
      <div className="flex items-center gap-2 pb-3 mb-3 border-b" style={{ borderColor: BORDER }}>
        <Icon size={15} style={{ color: PLUM }} />
        <p className="text-xs font-black uppercase tracking-wide" style={{ color: TEXT }}>{title}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Read-only view of a participant's submitted web intake form. */
function IntakeFormView({ intake }: { intake: Intake }) {
  const w = intake.web_intake;
  if (!w) {
    return (
      <div className="rounded-lg border p-8 text-center" style={{ background: SURFACE, borderColor: BORDER }}>
        <p className="text-sm font-bold" style={{ color: MUTED }}>No digital intake form on file for this enquiry.</p>
      </div>
    );
  }
  const hasAddress = w.street_address || w.suburb || w.state || w.postcode;
  const hasNdis = intake.ndis_number || w.plan_status || w.plan_start || w.plan_end;
  const hasPlanManager = w.plan_manager_name || w.plan_manager_org;
  const hasKin = w.next_of_kin && w.next_of_kin.length > 0;
  const hasReferral = w.referral_source || w.referral_date || (w.presenting_needs && w.presenting_needs.length > 0) || w.notes;

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: CRITICAL_BG }}>
        <div className="flex items-center gap-2.5">
          <FileText size={16} style={{ color: CRITICAL }} />
          <p className="text-sm font-bold" style={{ color: CRITICAL }}>
            Digital intake form submitted {formatDate(w.submitted_at)}
          </p>
        </div>
        {w.submitted_by && (
          <span className="text-[11px] font-black px-3 py-1 rounded-full" style={{ background: SURFACE, color: CRITICAL, border: `1px solid ${CRITICAL}` }}>
            Submitted by {w.submitted_by}
          </span>
        )}
      </div>

      <IntakeFormSection icon={User} title="Patient details">
        <div className="grid sm:grid-cols-3 gap-3">
          <DetailField label="Given name" value={w.given_name} />
          <DetailField label="Surname" value={w.surname} />
          <DetailField label="Preferred name" value={w.preferred_name} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <DetailField label="Pronouns" value={w.pronouns} />
          <DetailField label="Gender" value={w.gender} />
          <DetailField label="Date of birth" value={formatDate(w.date_of_birth)} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 pt-3 border-t" style={{ borderColor: BORDER }}>
          <DetailField label="Contact email" value={intake.email} icon={Mail} />
          <DetailField label="Contact phone" value={intake.phone} icon={PhoneCall} />
        </div>
      </IntakeFormSection>

      {hasAddress && (
        <IntakeFormSection icon={MapPin} title="Address">
          <div className="grid sm:grid-cols-3 gap-3">
            <DetailField label="Street address" value={w.street_address} />
            <DetailField label="Suburb" value={w.suburb} />
            <DetailField label="State" value={w.state} />
          </div>
          <DetailField label="Postcode" value={w.postcode} />
        </IntakeFormSection>
      )}

      {hasNdis && (
        <IntakeFormSection icon={ClipboardCheck} title="NDIS">
          <div className="grid sm:grid-cols-4 gap-3">
            <DetailField label="NDIS number" value={intake.ndis_number} />
            <DetailField label="Plan status" value={w.plan_status} />
            <DetailField label="Plan start" value={formatDate(w.plan_start)} />
            <DetailField label="Plan end" value={formatDate(w.plan_end)} />
          </div>
        </IntakeFormSection>
      )}

      {hasPlanManager && (
        <IntakeFormSection icon={FileSignature} title="Plan manager">
          <div className="grid sm:grid-cols-2 gap-3">
            <DetailField label="Name" value={w.plan_manager_name} />
            <DetailField label="Organisation" value={w.plan_manager_org} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <DetailField label="Phone" value={w.plan_manager_phone} icon={PhoneCall} />
            <DetailField label="Email" value={w.plan_manager_email} icon={Mail} />
          </div>
        </IntakeFormSection>
      )}

      {hasKin && (
        <IntakeFormSection icon={Users} title="Next of kin">
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {w.next_of_kin!.map((kin, i) => (
              <div key={i} className="grid sm:grid-cols-4 gap-3 py-3 first:pt-0 last:pb-0">
                <DetailField label="Name" value={kin.name} />
                <DetailField label="Relationship" value={kin.relationship} />
                <DetailField label="Phone" value={kin.phone} icon={PhoneCall} />
                <DetailField label="Email" value={kin.email} icon={Mail} />
              </div>
            ))}
          </div>
        </IntakeFormSection>
      )}

      {hasReferral && (
        <IntakeFormSection icon={Send} title="Referral details">
          <div className="grid sm:grid-cols-2 gap-3">
            <DetailField label="Referral source" value={w.referral_source} />
            <DetailField label="Referral date" value={formatDate(w.referral_date)} />
          </div>
          {w.presenting_needs && w.presenting_needs.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>Presenting needs</p>
              <div className="flex flex-wrap gap-1.5">
                {w.presenting_needs.map((need) => (
                  <span key={need} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: SOFT, color: TEXT }}>{need}</span>
                ))}
              </div>
            </div>
          )}
          {w.notes && (
            <div className="pt-3 border-t" style={{ borderColor: BORDER }}>
              <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>Notes</p>
              <p className="text-sm" style={{ color: TEXT }}>{w.notes}</p>
            </div>
          )}
        </IntakeFormSection>
      )}
    </div>
  );
}

/**
 * Easy Capture record/stop/playback control, shared by the Screening and
 * Meet & Greet steps — each records into its own field on the intake, but
 * only one recording can be in progress at a time (single mic session).
 */
function EasyCaptureBlock({
  label, recordingUrl, isRecording, elapsedSec, onStart, onStop, transcribesToNotes,
}: {
  label: string;
  recordingUrl?: string;
  isRecording: boolean;
  elapsedSec: number;
  onStart: () => void;
  onStop: () => void;
  /** When true, shows that speech is being converted into the notes field live while recording. */
  transcribesToNotes?: boolean;
}) {
  return (
    <>
      <div className="rounded-lg p-3 flex items-center justify-between gap-3" style={{ background: SOFT }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="h-8 w-8 rounded-lg shrink-0 flex items-center justify-center"
            style={{ background: isRecording ? DANGER_BG : "var(--cc-bg)", color: isRecording ? DANGER : PLUM }}
          >
            <Mic size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black" style={{ color: TEXT }}>Easy Capture</p>
            <p className="text-[11px] flex items-center gap-1.5" style={{ color: MUTED }}>
              {isRecording && <span className="h-1.5 w-1.5 rounded-full animate-pulse shrink-0" style={{ background: DANGER }} />}
              {isRecording
                ? `${transcribesToNotes ? "Recording & converting to notes" : "Recording"}… ${formatElapsed(elapsedSec)}`
                : recordingUrl ? `${label} recorded` : `Record the ${label.toLowerCase()}`}
            </p>
          </div>
        </div>
        {!isRecording ? (
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg shrink-0" onClick={onStart}>
            <Mic size={13} /> {recordingUrl ? "Re-record" : "Record"}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg shrink-0" style={{ color: DANGER }} onClick={onStop}>
            <Square size={13} /> Stop
          </Button>
        )}
      </div>
      {recordingUrl && !isRecording && (
        <audio controls src={recordingUrl} className="w-full h-9" />
      )}
    </>
  );
}

function SignatureCard({
  label, signedName, signedAt, pendingLabel,
}: {
  label: string;
  signedName?: string | null;
  signedAt?: string | null;
  pendingLabel: string;
}) {
  const signed = !!signedAt;
  return (
    <div
      className="rounded-lg p-3.5 border"
      style={{ background: signed ? SUCCESS_BG : SOFT, borderColor: signed ? "transparent" : BORDER }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: signed ? SUCCESS : MUTED }}>{label}</p>
      {signed ? (
        <div className="mt-1.5">
          <p className="text-sm font-black flex items-center gap-1.5" style={{ color: TEXT }}>
            <CheckCircle2 size={14} style={{ color: SUCCESS }} /> {signedName}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>
            Signed {new Date(signedAt!).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      ) : (
        <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: MUTED }}><Clock3 size={13} /> {pendingLabel}</p>
      )}
    </div>
  );
}
