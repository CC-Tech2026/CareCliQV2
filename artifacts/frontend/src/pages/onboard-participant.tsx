import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft, HeartHandshake, ClipboardCheck, Mic, FileSignature, Send, CheckCircle2, Clock3,
  Loader2, ChevronRight, Search, PenLine, PhoneCall, Mail, XCircle, ShieldCheck, Users, Square, Upload,
  MapPin, User, FileText, Trash2, Plus, LayoutGrid, Rows3, ChevronUp, ChevronDown, ArrowRight,
  SlidersHorizontal, X, AlertTriangle,
} from "lucide-react";
import { writeWaitlistSnapshot } from "@/lib/onboardingWaitlist";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SectionInfo } from "@/components/ui/section-info";
import {
  createMeetingSession, transcribeAndResolveNames,
  type ConsentGivenBy, type ConsentMethod,
} from "@/services/coordinatorService";
import {
  listParticipantIntakes, createParticipantIntake, updateParticipantIntake, uploadSignedServiceAgreement,
  type ParticipantIntake, type IntakeStatus, type EnquirySource, type ServiceCategory, type FundingType,
  type NextOfKinEntry, type WebIntakeForm, type ScreeningManualChecks,
} from "@/services/participantIntakeService";
import { SignatureCanvas, useSignatureCanvasState } from "@/components/shifts/SignatureCanvas";
import { useBranches } from "@/hooks/useBranches";

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
 * Participant onboarding pipeline (Enquiry → Screening → Meet & Greet →
 * Service Agreement → Activate), backed by /api/participant-intakes — see
 * participantIntakeService.ts. Complaints (below) and the public referral
 * form (onboardingWaitlist.ts) remain local/mock.
 */

const FUNDING_TYPE_LABEL: Record<FundingType, string> = {
  ndia_managed: "NDIA-managed",
  plan_managed: "Plan-managed",
  self_managed: "Self-managed",
};

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "male", label: "Male / Man" },
  { value: "female", label: "Female / Woman" },
  { value: "non_binary", label: "Non-Binary" },
  { value: "self_describe", label: "Different term (Free-text / Self-describe)" },
  { value: "prefer_not_to_say", label: "Prefer not to say / Do not wish to disclose" },
];

const PRONOUN_OPTIONS: { value: string; label: string }[] = [
  { value: "she_her", label: "She / Her" },
  { value: "he_him", label: "He / Him" },
  { value: "they_them", label: "They / Them" },
  { value: "name_only", label: "Use my name only" },
  { value: "self_describe", label: "Different pronouns (Free-text / Self-describe)" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const GENDER_FIXED_VALUES = new Set(GENDER_OPTIONS.map((o) => o.value).filter((v) => v !== "self_describe"));
const PRONOUN_FIXED_VALUES = new Set(PRONOUN_OPTIONS.map((o) => o.value).filter((v) => v !== "self_describe"));

/** Maps a stored value to which option should show selected — anything that
 *  isn't one of the fixed values (including legacy free text) is treated as
 *  "self-describe" so its actual text shows in the accompanying box. */
function selectValueForOption(value: string | undefined, fixedValues: Set<string>): string {
  if (!value) return "";
  return fixedValues.has(value) ? value : "self_describe";
}

/** Read-only display label for a stored gender/pronoun value. */
function labelForOption(value: string | undefined, options: { value: string; label: string }[]): string | undefined {
  if (!value) return undefined;
  if (value === "self_describe") return undefined;
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Aged Care is only available to participants aged 65 and over. */
function calculateAge(dob?: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function isAgedCareEligible(dob?: string): boolean {
  const age = calculateAge(dob);
  return age !== null && age >= 65;
}

// Intake/ScreeningManualChecks/NextOfKinEntry/WebIntakeForm now live in
// participantIntakeService.ts (the wire format returned by the backend);
// aliased here so the rest of this file's many references don't need to
// change one by one.
type Intake = ParticipantIntake;

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
  inactive: { label: "Inactive", bg: WARNING_BG, color: WARNING },
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
    case "inactive": return 4;
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
  { id: "active", label: "Onboarded Participants" },
] as const;

type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"];

// Per-column accent colors — same visual language as Staff Onboarding's
// STAGE_COLOR (colored top border + dot + tinted count pill per column).
// Provider capacity — dummy inputs for now, since there's no live feed from
// the Workforce/Staff directory into this page yet. Used at Screening to
// automatically reflect whether the organisation has room to take on a new
// participant, based on active caseload vs. what the current support worker
// headcount can reasonably carry.
const TOTAL_SUPPORT_WORKERS = 5;
const MAX_CASELOAD_PER_WORKER = 6;

// Rest of the provider's screening profile — service area now comes from
// the org's real branches (Settings → Provider/Branches); language/funding
// are still dummy until there's a real settings source for those too.
const PROVIDER_LANGUAGES = ["English", "Mandarin", "Vietnamese", "Arabic", "Punjabi"];
const PROVIDER_ACCEPTS_NDIA_MANAGED = true;

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
    case "active":
    case "inactive": return "active";
    default: return null;
  }
}

/** KPI stat tile — same tinted-background + icon-badge pattern as Staff Onboarding's KpiTile. Selectable when onClick is given: filters the board/list below to matching participants. */
function KpiTile({ label, value, color, bg, icon: Icon, active, onClick }: { label: string; value: number; color: string; bg: string; icon?: typeof Clock3; active?: boolean; onClick?: () => void }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[30px] font-black leading-none" style={{ color }}>{value}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.65)", color }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{label}</p>
      {active && <div className="mt-3 h-1 w-8 rounded-full" style={{ background: color }} />}
    </>
  );
  if (!onClick) return <div className="rounded-[1.25rem] px-5 py-4.5" style={{ background: bg }}>{content}</div>;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="w-full rounded-[1.25rem] px-5 py-4.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
      style={{ background: bg, outline: active ? `2px solid ${color}` : undefined, outlineOffset: active ? 2 : undefined }}
    >
      {content}
    </button>
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
    return intake.meet_greet_recording_url ? { icon: Mic, label: "Easy Capture ready", color: CRITICAL, bg: CRITICAL_BG } : null;
  }
  if (column === "service_agreement") {
    return intake.status === "awaiting_signatures" ? { label: "Awaiting sign", color: SUCCESS, bg: SUCCESS_BG } : null;
  }
  if (column === "active") {
    if (intake.status === "inactive") return { icon: XCircle, label: "Suspended", color: WARNING, bg: WARNING_BG };
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
      if (intake.status === "inactive") {
        return intake.suspended_at
          ? `Suspended ${new Date(intake.suspended_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`
          : "Suspended";
      }
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

// ── Participant complaints (dummy — no backend yet) ──────────────────────

type ComplaintStatus = "open" | "in_review" | "resolved";

type ParticipantComplaint = {
  id: string;
  participant_name: string;
  subject: string;
  description: string;
  filed_at: string;
  status: ComplaintStatus;
  /** What the MD did to address it — required whenever the status is moved off "open". */
  resolution_notes?: string;
  responded_at?: string;
};

const COMPLAINT_STATUS_META: Record<ComplaintStatus, { label: string; bg: string; color: string }> = {
  open: { label: "Open", bg: DANGER_BG, color: DANGER },
  in_review: { label: "In review", bg: WARNING_BG, color: WARNING },
  resolved: { label: "Resolved", bg: SUCCESS_BG, color: SUCCESS },
};

// Exported so HubLayout's nav badge can reflect the open-complaint count
// without needing a shared store — this is still just the static seed
// (no backend), so the badge won't move as complaints get addressed within
// a session, same limitation as the rest of this local-state build.
export const SEED_COMPLAINTS: ParticipantComplaint[] = [
  {
    id: "1",
    participant_name: "Sam Rivera",
    subject: "Support worker punctuality",
    description: "Sam's family reported that the assigned support worker has arrived 20-30 minutes late to the last three scheduled visits without notice.",
    filed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    status: "open",
  },
  {
    id: "2",
    participant_name: "Priya Nair",
    subject: "Missed scheduled visit",
    description: "A community access session was missed entirely with no call ahead. Priya was left waiting for over an hour before contacting the office.",
    filed_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    status: "open",
  },
  {
    id: "3",
    participant_name: "Priya Nair",
    subject: "Communication concerns",
    description: "Requested that session updates be shared with her support coordinator as agreed, but this hasn't been happening consistently.",
    filed_at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
    status: "in_review",
  },
  {
    id: "4",
    participant_name: "Harold Whitfield",
    subject: "Billing discrepancy",
    description: "Eleanor (spouse) flagged that the last invoice included a support session that did not take place. Finance has been notified to review.",
    filed_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    status: "in_review",
  },
  {
    id: "5",
    participant_name: "Harold Whitfield",
    subject: "Personal care approach",
    description: "Raised a concern about a support worker's approach during personal care. Has since been resolved after a conversation with the coordinator and a worker reassignment.",
    filed_at: new Date(Date.now() - 21 * 86_400_000).toISOString(),
    status: "resolved",
  },
];

// ── List view ─────────────────────────────────────────────────────────
// Same table layout as Staff Onboarding's PipelineListView — sortable
// Name/Stage columns, colored stage pill, meta line, click-through row.

type ParticipantListRow = {
  id: string;
  name: string;
  categoryLabel: string;
  columnId: BoardColumnId;
  stageLabel: string;
  color: string;
  meta: string;
  onOpen: () => void;
};

type ListSortKey = "name" | "stage";

function ParticipantListView({
  rows, sortKey, sortAsc, onSort,
}: { rows: ParticipantListRow[]; sortKey: ListSortKey; sortAsc: boolean; onSort: (key: ListSortKey) => void }) {
  function SortHeader({ label, k, className }: { label: string; k: ListSortKey; className?: string }) {
    const active = sortKey === k;
    return (
      <button onClick={() => onSort(k)} className={`flex items-center gap-1 text-left ${className ?? ""}`}>
        {label}
        {active && (sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div className="grid grid-cols-[1fr_120px_140px_1fr_40px] gap-3 border-b px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.1em]" style={{ borderColor: BORDER, color: MUTED }}>
        <SortHeader label="Participant" k="name" />
        <span className="hidden sm:inline">Category</span>
        <SortHeader label="Stage" k="stage" />
        <span className="hidden md:inline">Status</span>
        <span />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-[12px] font-medium" style={{ color: MUTED }}>Nobody matches the current filters.</p>
      ) : (
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {rows.map((row) => (
            <div
              key={row.id}
              onClick={row.onOpen}
              className="grid cursor-pointer grid-cols-[1fr_120px_140px_1fr_40px] items-center gap-3 px-5 py-3 transition-colors hover:bg-black/[0.02]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={row.name} size={30} color={row.color} />
                <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{row.name}</p>
              </div>
              <p className="hidden truncate text-[11px] font-medium sm:block" style={{ color: MUTED }}>{row.categoryLabel}</p>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: `${row.color}1F`, color: row.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.color }} />
                {row.stageLabel}
              </span>
              <p className="hidden truncate text-[11px] font-medium md:block" style={{ color: MUTED }}>{row.meta}</p>
              <div className="flex justify-end">
                <ArrowRight size={14} style={{ color: "#B8B4B0" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dedicated full-page roster of Active participants — reached by clicking
 * the "Active" column header on the board (a proper page, not just an
 * in-place filter, since MDs use this as a reference list on its own).
 */
function ActiveParticipantsPage({
  intakes, onBack, onOpen, onOpenComplaints,
}: { intakes: Intake[]; onBack: () => void; onOpen: (id: string) => void; onOpenComplaints: () => void }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | ServiceCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const q = search.trim().toLowerCase();
  const rows = intakes
    .filter((i) => columnIdForStatus(i.status) === "active")
    .filter((i) => !q || i.full_name.toLowerCase().includes(q) || i.ndis_number.toLowerCase().includes(q))
    .filter((i) => categoryFilter === "all" || i.service_category === categoryFilter)
    .filter((i) => statusFilter === "all" || i.status === statusFilter)
    .sort((a, b) => (b.activated_at ?? "").localeCompare(a.activated_at ?? ""));
  const activeTotal = intakes.filter((i) => i.status === "active").length;
  const inactiveTotal = intakes.filter((i) => i.status === "inactive").length;

  // No complaints backend exists yet — dummy seeded data (SEED_COMPLAINTS).
  const complaintCount = SEED_COMPLAINTS.length;

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-black/5"
            style={{ color: MUTED, background: SOFT }}
          >
            <ArrowLeft size={13} strokeWidth={2.5} /> Back to Participant Onboarding
          </button>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight mt-2" style={{ color: TEXT }}>
            Participants
            <SectionInfo text="Everyone onboarded with your organisation, active and inactive." />
          </h1>
          <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
            {activeTotal} active · {inactiveTotal} inactive with this provider.
          </p>
        </div>

        <button
          onClick={onOpenComplaints}
          className="flex items-center gap-3 rounded-[1.25rem] border px-5 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
          style={{ background: DANGER_BG, borderColor: DANGER }}
          title="View participant complaints"
        >
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: "rgba(255,255,255,0.65)", color: DANGER }}>
            <Mail size={18} />
            {complaintCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
                style={{ background: DANGER }}
              >
                {complaintCount}
              </span>
            )}
          </div>
          <div>
            <p className="text-[22px] font-black leading-none" style={{ color: DANGER }}>{complaintCount}</p>
            <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Participant Complaints</p>
          </div>
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-[1.25rem] border bg-white p-3 sm:flex-row sm:items-center" style={{ borderColor: BORDER }}>
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for the Participant"
            className="h-10 rounded-xl border-0 bg-[#F8F7F4] pl-9 text-[12px] shadow-none focus-visible:ring-1"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/5">
              <X size={13} style={{ color: MUTED }} />
            </button>
          )}
        </div>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as "all" | ServiceCategory)}>
          <SelectTrigger className="h-10 w-full rounded-xl border-0 bg-[#F8F7F4] text-[12px] shadow-none sm:w-[170px]">
            <Users size={14} className="mr-1.5" /><SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="disability">Disability</SelectItem>
            <SelectItem value="aged_care">Aged Care</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "active" | "inactive")}>
          <SelectTrigger className="h-10 w-full rounded-xl border-0 bg-[#F8F7F4] text-[12px] shadow-none sm:w-[150px]">
            <SlidersHorizontal size={14} className="mr-1.5" /><SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
        <div className="grid grid-cols-[1fr_110px_100px_140px_120px_40px] gap-3 border-b px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.1em]" style={{ borderColor: BORDER, color: MUTED }}>
          <span>Participant</span>
          <span className="hidden sm:inline">Category</span>
          <span>Status</span>
          <span className="hidden md:inline">NDIS number</span>
          <span>Activated</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12px] font-medium" style={{ color: MUTED }}>No participants match the current filters.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {rows.map((i) => (
              <div
                key={i.id}
                onClick={() => onOpen(i.id)}
                className="grid cursor-pointer grid-cols-[1fr_110px_100px_140px_120px_40px] items-center gap-3 px-5 py-3 transition-colors hover:bg-black/[0.02]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={i.full_name} size={30} color={i.status === "inactive" ? WARNING : COLUMN_COLOR.active} />
                  <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{i.full_name}</p>
                </div>
                <p className="hidden truncate text-[11px] font-medium sm:block" style={{ color: MUTED }}>
                  {i.service_category === "aged_care" ? "Aged Care" : "Disability"}
                </p>
                <div><StatusBadge status={i.status} /></div>
                <p className="hidden truncate text-[11px] font-medium md:block" style={{ color: MUTED }}>{i.ndis_number || "—"}</p>
                <p className="truncate text-[11px] font-medium" style={{ color: MUTED }}>{formatDate(i.activated_at) ?? "—"}</p>
                <div className="flex justify-end">
                  <ArrowRight size={14} style={{ color: "#B8B4B0" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dedicated page listing complaints filed by/on behalf of participants —
 * reached by clicking the "Participant Complaints" widget on the roster
 * page. No backend for complaints yet — dummy seeded data (SEED_COMPLAINTS).
 */
function ComplaintsPage({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [allComplaints, setAllComplaints] = useState<ParticipantComplaint[]>(SEED_COMPLAINTS);
  const [statusFilter, setStatusFilter] = useState<"all" | ComplaintStatus>("all");

  // Which complaint is currently being addressed, plus its draft response.
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<ComplaintStatus>("in_review");
  const [draftNotes, setDraftNotes] = useState("");

  const complaints = allComplaints
    .filter((c) => statusFilter === "all" || c.status === statusFilter)
    .sort((a, b) => b.filed_at.localeCompare(a.filed_at));
  const openCount = allComplaints.filter((c) => c.status === "open").length;

  function startResponding(c: ParticipantComplaint) {
    setRespondingId(c.id);
    setDraftStatus(c.status === "open" ? "in_review" : c.status);
    setDraftNotes(c.resolution_notes ?? "");
  }

  function cancelResponding() {
    setRespondingId(null);
    setDraftNotes("");
  }

  function saveResponse(id: string) {
    // A comment is only required (and only shown) once the complaint is
    // being marked Resolved — "In review" is just a status flag, nothing
    // to explain yet.
    if (draftStatus === "resolved" && !draftNotes.trim()) return;
    setAllComplaints((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              status: draftStatus,
              resolution_notes: draftStatus === "resolved" ? draftNotes.trim() : c.resolution_notes,
              responded_at: new Date().toISOString(),
            }
          : c
      )
    );
    setRespondingId(null);
    setDraftNotes("");
    toast({ title: "Complaint updated", description: `Marked as ${COMPLAINT_STATUS_META[draftStatus].label.toLowerCase()}.` });
  }

  return (
    <div className="space-y-5 pb-10">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-black/5"
          style={{ color: MUTED, background: SOFT }}
        >
          <ArrowLeft size={13} strokeWidth={2.5} /> Back to Participants
        </button>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight mt-2" style={{ color: TEXT }}>
          Participant Complaints
          <SectionInfo text="Complaints and feedback logged against a participant, with resolution status and notes." />
        </h1>
        <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
          {allComplaints.length} total · {openCount} open.
        </p>
      </div>

      <div className="flex items-center gap-0.5 rounded-xl p-1 w-fit" style={{ background: "#F8F7F4" }}>
        {(["all", "open", "in_review", "resolved"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="h-8 rounded-lg px-3 text-[11px] font-black transition-all"
            style={{
              background: statusFilter === s ? "white" : "transparent",
              color: statusFilter === s ? PLUM : MUTED,
              boxShadow: statusFilter === s ? "var(--cc-shadow-sm)" : "none",
            }}
          >
            {s === "all" ? "All" : COMPLAINT_STATUS_META[s].label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
        {complaints.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12px] font-medium" style={{ color: MUTED }}>No complaints match the current filter.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {complaints.map((c) => {
              const meta = COMPLAINT_STATUS_META[c.status];
              const responding = respondingId === c.id;
              return (
                <div key={c.id} className="p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.participant_name} size={32} color={DANGER} />
                      <div>
                        <p className="text-sm font-black" style={{ color: TEXT }}>{c.participant_name}</p>
                        <p className="text-[11px] font-medium" style={{ color: MUTED }}>Filed {formatDate(c.filed_at)}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-bold" style={{ color: TEXT }}>{c.subject}</p>
                  <p className="mt-1 text-xs leading-5" style={{ color: MUTED }}>{c.description}</p>

                  {c.resolution_notes && !responding && (
                    <div className="mt-3 rounded-lg p-3" style={{ background: c.status === "resolved" ? SUCCESS_BG : WARNING_BG }}>
                      <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: c.status === "resolved" ? SUCCESS : WARNING }}>
                        Response
                      </p>
                      <p className="mt-1 text-xs leading-5" style={{ color: TEXT }}>{c.resolution_notes}</p>
                      {c.responded_at && <p className="mt-1.5 text-[10px] font-medium" style={{ color: MUTED }}>Updated {formatDate(c.responded_at)}</p>}
                    </div>
                  )}

                  {!responding ? (
                    <Button variant="outline" size="sm" className="mt-3 gap-1.5 rounded-lg" onClick={() => startResponding(c)}>
                      <PenLine size={13} /> {c.status === "open" ? "Address complaint" : c.resolution_notes ? "Update response" : "Update status"}
                    </Button>
                  ) : (
                    <div className="mt-3 space-y-2 rounded-lg border p-3" style={{ background: SOFT, borderColor: BORDER }}>
                      <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Mark as</label>
                      <Select value={draftStatus} onValueChange={(v) => setDraftStatus(v as ComplaintStatus)}>
                        <SelectTrigger className="h-9 text-sm bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in_review">In review</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                      {draftStatus === "resolved" && (
                        <>
                          <label className="text-[10px] font-black uppercase tracking-wide block pt-1" style={{ color: MUTED }}>
                            What did you do to solve it?
                          </label>
                          <Textarea
                            value={draftNotes}
                            onChange={(e) => setDraftNotes(e.target.value)}
                            placeholder="e.g. Spoke with the participant's family, reassigned the support worker, and confirmed the schedule going forward."
                            className="min-h-[80px] text-sm bg-white"
                          />
                        </>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Button variant="outline" size="sm" className="rounded-lg" onClick={cancelResponding}>Cancel</Button>
                        <Button variant="navy" size="sm" className="gap-1.5 rounded-lg" onClick={() => saveResponse(c.id)} disabled={draftStatus === "resolved" && !draftNotes.trim()}>
                          <CheckCircle2 size={13} /> Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Plain participant record — reached from the Active Participants list.
 * Deliberately has none of IntakeDetail's pipeline chrome (stepper,
 * decline/terminate actions, board-card note): these participants have
 * already been through the process, so this is just their profile now.
 */
function ParticipantProfilePage({
  intake, onBack, onUpdate,
}: {
  intake: Intake;
  onBack: () => void;
  onUpdate: (patch: Partial<Intake>) => void;
}) {
  const { toast } = useToast();
  const [intakeFormEditing, setIntakeFormEditing] = useState(false);
  const [intakeFormDraft, setIntakeFormDraft] = useState<Partial<WebIntakeForm>>(intake.web_intake ?? {});
  const [serviceCategoryDraft, setServiceCategoryDraft] = useState<ServiceCategory>(intake.service_category ?? "disability");

  // Suspend / Activate — temporarily pauses service delivery without
  // leaving the pipeline entirely (unlike Terminate). A reason is required
  // to suspend; reactivating doesn't need one.
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  function suspend() {
    if (!suspendReason.trim()) return;
    onUpdate({ status: "inactive", suspended_reason: suspendReason.trim(), suspended_at: new Date().toISOString() });
    setSuspendOpen(false);
    setSuspendReason("");
    toast({ title: "Services suspended", description: `${intake.full_name.split(" ")[0]}'s status is now Inactive.` });
  }

  function activate() {
    onUpdate({ status: "active", reactivated_at: new Date().toISOString() });
    toast({ title: "Services resumed", description: `${intake.full_name.split(" ")[0]}'s status is now Active.` });
  }

  function updateIntakeFormDraft(patch: Partial<WebIntakeForm>) {
    setIntakeFormDraft((prev) => ({ ...prev, ...patch }));
  }
  function startEditingIntakeForm() {
    setIntakeFormDraft(intake.web_intake ?? {});
    setServiceCategoryDraft(intake.service_category ?? "disability");
    setIntakeFormEditing(true);
  }
  function cancelEditingIntakeForm() {
    setIntakeFormDraft(intake.web_intake ?? {});
    setServiceCategoryDraft(intake.service_category ?? "disability");
    setIntakeFormEditing(false);
  }
  function saveIntakeForm(contact: { email: string; phone: string }) {
    if (serviceCategoryDraft === "aged_care" && !isAgedCareEligible(intakeFormDraft.date_of_birth)) {
      toast({ title: "Cannot save", description: "Aged Care requires a date of birth confirming the participant is 65 or over.", variant: "destructive" });
      return;
    }
    const payload: WebIntakeForm = {
      ...intakeFormDraft,
      submitted_at: intake.web_intake?.submitted_at ?? new Date().toISOString(),
      submitted_by: intakeFormDraft.submitted_by || "Provider",
    };
    onUpdate({ web_intake: payload, service_category: serviceCategoryDraft, email: contact.email, phone: contact.phone });
    setIntakeFormEditing(false);
    toast({ title: "Profile updated" });
  }

  return (
    <div className="space-y-5 pb-10">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-black/5"
        style={{ color: MUTED, background: SOFT }}
      >
        <ArrowLeft size={13} strokeWidth={2.5} /> Back to Participants
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
        {/* Sidebar summary */}
        <div className="space-y-4">
          <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <Avatar name={intake.full_name} size={48} color={intake.status === "inactive" ? WARNING : COLUMN_COLOR.active} />
            <h2 className="text-lg font-black mt-3" style={{ color: TEXT }}>{intake.full_name}</h2>
            <div className="mt-1"><StatusBadge status={intake.status} /></div>
            <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: BORDER }}>
              <p className="text-xs" style={{ color: MUTED }}>{intake.service_category === "aged_care" ? "Aged Care" : "Disability"}</p>
              <p className="text-xs" style={{ color: MUTED }}>NDIS {intake.ndis_number || "—"}</p>
              {intake.email && <p className="text-xs" style={{ color: MUTED }}>{intake.email}</p>}
              {intake.phone && <p className="text-xs" style={{ color: MUTED }}>{intake.phone}</p>}
              {intake.activated_at && <p className="text-xs" style={{ color: MUTED }}>Active since {formatDate(intake.activated_at)}</p>}
            </div>

            {intake.status === "inactive" && intake.suspended_reason && (
              <div className="mt-4 rounded-lg p-3" style={{ background: WARNING_BG }}>
                <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: WARNING }}>Reason for Suspension</p>
                <p className="mt-1 text-xs leading-5" style={{ color: TEXT }}>{intake.suspended_reason}</p>
                {intake.suspended_at && <p className="mt-1.5 text-[10px] font-medium" style={{ color: MUTED }}>Suspended {formatDate(intake.suspended_at)}</p>}
              </div>
            )}
          </div>

          {/* Suspend / Activate — pauses or resumes service delivery without
              leaving the pipeline (distinct from Terminate, which ends it). */}
          <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <label className="text-[10px] font-black uppercase tracking-wide mb-2 block" style={{ color: MUTED }}>Service status</label>
            {intake.status === "inactive" ? (
              <Button type="button" variant="ghost" className="w-full gap-1.5 rounded-lg border-transparent text-white hover:opacity-90 hover:bg-transparent" style={{ background: SUCCESS }} onClick={activate}>
                <CheckCircle2 size={13} /> Activate Account
              </Button>
            ) : !suspendOpen ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSuspendOpen(true)}
                className="w-full gap-1.5 rounded-lg border-transparent text-white hover:opacity-90 hover:bg-transparent"
                style={{ background: "#DC2626" }}
              >
                <XCircle size={13} /> Suspend Account
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px]" style={{ color: MUTED }}>
                  Temporarily pauses service delivery for {intake.full_name.split(" ")[0]}. Their status will show as Inactive until reactivated.
                </p>
                <Textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Reason for suspension (required)"
                  className="text-xs"
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="rounded-lg" onClick={() => { setSuspendOpen(false); setSuspendReason(""); }}>
                    Cancel
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-lg" style={{ color: DANGER }} onClick={suspend} disabled={!suspendReason.trim()}>
                    <XCircle size={13} className="mr-1.5" /> Confirm suspension
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Profile details */}
        <div className="space-y-4">
          <IntakeFormBlock
            intake={intake}
            draft={intakeFormDraft}
            onChange={updateIntakeFormDraft}
            editing={intakeFormEditing}
            onEdit={startEditingIntakeForm}
            onCancel={cancelEditingIntakeForm}
            onSave={saveIntakeForm}
            serviceCategory={serviceCategoryDraft}
            onServiceCategoryChange={setServiceCategoryDraft}
            showSubmissionStatus={false}
          />

          {(intake.plan_start_date || intake.plan_end_date || intake.total_budget || intake.provider_signed_name || intake.family_signed_name) && (
            <IntakeFormSection icon={FileSignature} title="Service Agreement">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Field label="Plan start" value={formatDate(intake.plan_start_date)} editing={false} />
                <Field label="Plan end" value={formatDate(intake.plan_end_date)} editing={false} />
                <Field label="Total budget" value={intake.total_budget} editing={false} />
                <Field label="Provider signed by" value={intake.provider_signed_name} editing={false} />
                <Field label="Family signed by" value={intake.family_signed_name} editing={false} />
                <Field label="Activated" value={formatDate(intake.activated_at)} editing={false} />
              </div>
            </IntakeFormSection>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ParticipantOnboardingBoard() {
  const { translate } = useAccessibility();
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  // Selected intake lives in the URL (?intake=<id>), same convention as
  // /team?workerId=...&tab=... elsewhere in the app. This also lets the
  // shared OnboardingWorkspace shell hide the Staff/Participants toggle
  // while a detail view is open, without the board needing to know
  // anything about that shell.
  const urlSearch = useSearch();
  const selectedId = new URLSearchParams(urlSearch).get("intake");
  const profileId = new URLSearchParams(urlSearch).get("profile");

  // Loaded from the backend on mount — see participantIntakeService.ts.
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [loadingIntakes, setLoadingIntakes] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listParticipantIntakes()
      .then((rows) => { if (!cancelled) setIntakes(rows); })
      .catch((err: Error) => toast({ title: "Couldn't load participants", description: err.message, variant: "destructive" }))
      .finally(() => { if (!cancelled) setLoadingIntakes(false); });
    return () => { cancelled = true; };
  }, []);

  // Mirrors just the enquiry-stage count and total requested hours to
  // localStorage so the Hub dashboard's "Waiting list" cards can reflect
  // them — see onboardingWaitlist.ts for why this doesn't go through a real
  // backend.
  useEffect(() => {
    const enquiries = intakes.filter((i) => i.status === "enquiry");
    writeWaitlistSnapshot({
      count: enquiries.length,
      hours: enquiries.reduce((sum, i) => sum + (i.service_hours_required || 0), 0),
    });
  }, [intakes]);

  const [search, setSearch] = useState("");
  const [newIntakeOpen, setNewIntakeOpen] = useState(false);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [activeKpi, setActiveKpi] = useState<"open" | "stuck" | "active" | "signature" | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | ServiceCategory>("all");
  const [stageFilter, setStageFilter] = useState<"all" | BoardColumnId>("all");
  const [sortKey, setSortKey] = useState<ListSortKey>("stage");
  const [sortAsc, setSortAsc] = useState(true);

  function handleSort(key: ListSortKey) {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const [fullName, setFullName] = useState("");
  const [serviceCategory, setServiceCategory] = useState<ServiceCategory>("disability");
  const [dob, setDob] = useState("");
  const [ndisNumber, setNdisNumber] = useState("");
  const [fundingType, setFundingType] = useState<FundingType | "">("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<EnquirySource>("online_form");

  const dobAge = calculateAge(dob);
  const agedCareBlocked = serviceCategory === "aged_care" && dob.trim().length > 0 && !isAgedCareEligible(dob);

  const [creatingIntake, setCreatingIntake] = useState(false);

  async function createIntake() {
    if (!dob.trim()) {
      toast({ title: "Date of birth is required", variant: "destructive" });
      return;
    }
    setCreatingIntake(true);
    try {
      const intake = await createParticipantIntake({
        full_name: fullName.trim(),
        service_category: serviceCategory,
        ndis_number: ndisNumber.trim(),
        email: email.trim(),
        phone: phone.trim(),
        source,
        web_intake: {
          date_of_birth: dob.trim(),
          funding_type: fundingType || undefined,
          submitted_by: "Provider",
          submitted_at: new Date().toISOString(),
        },
      });
      setIntakes((prev) => [intake, ...prev]);
      setNewIntakeOpen(false);
      setFullName(""); setServiceCategory("disability"); setDob(""); setNdisNumber(""); setFundingType(""); setEmail(""); setPhone(""); setSource("online_form");
      navigate(`/onboard-participant?intake=${intake.id}`);
      toast({ title: "Enquiry logged", description: `${intake.full_name} is in the Enquiry column.` });
    } catch (err) {
      toast({ title: "Couldn't log enquiry", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCreatingIntake(false);
    }
  }

  function updateIntake(id: string, patch: Partial<Intake>): Promise<Intake> {
    return updateParticipantIntake(id, patch)
      .then((updated) => {
        setIntakes((prev) => prev.map((i) => (i.id === id ? updated : i)));
        return updated;
      })
      .catch((err: Error) => {
        toast({ title: "Couldn't save change", description: err.message, variant: "destructive" });
        throw err;
      });
  }

  // Merges into local state only — for results already persisted server-side
  // through their own endpoint (the signed-document upload), so it doesn't
  // also fire a redundant PATCH.
  function applyLocalPatch(id: string, patch: Partial<Intake>) {
    setIntakes((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  const selected = selectedId ? intakes.find((i) => i.id === selectedId) ?? null : null;

  // Current active caseload vs. what the support worker headcount can carry
  // — drives the capacity check shown at Screening. Suspended (inactive)
  // participants aren't counted since their service delivery is paused.
  const currentCaseload = intakes.filter((i) => i.status === "active").length;
  const totalCapacity = TOTAL_SUPPORT_WORKERS * MAX_CASELOAD_PER_WORKER;

  if (loadingIntakes) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={20} className="animate-spin" style={{ color: MUTED }} />
      </div>
    );
  }

  if (selected) {
    return (
      <IntakeDetail
        intake={selected}
        onBack={() => navigate("/onboard-participant")}
        onUpdate={(patch) => updateIntake(selected.id, patch)}
        onLocalUpdate={(patch) => applyLocalPatch(selected.id, patch)}
        currentCaseload={currentCaseload}
        totalCapacity={totalCapacity}
      />
    );
  }

  // Reached from the Active Participants list — a plain profile, no
  // pipeline/stepper chrome, since these participants already went
  // through the process and this is just their record now.
  const profileIntake = profileId ? intakes.find((i) => i.id === profileId) ?? null : null;

  if (profileIntake) {
    return (
      <ParticipantProfilePage
        intake={profileIntake}
        onBack={() => navigate("/onboard-participant/active")}
        onUpdate={(patch) => updateIntake(profileIntake.id, patch)}
      />
    );
  }

  // Dedicated complaints list, reached by clicking the "Participant
  // Complaints" widget on the roster page.
  if (location === "/onboard-participant/complaints") {
    return <ComplaintsPage onBack={() => navigate("/onboard-participant/active")} />;
  }

  // Dedicated full-page list, reached by clicking the "Active" column
  // header on the board — a separate page rather than an in-place filter,
  // since it's meant as a proper roster view, not a quick glance.
  if (location === "/onboard-participant/active") {
    return (
      <ActiveParticipantsPage
        intakes={intakes}
        onBack={() => navigate("/onboard-participant")}
        onOpen={(id) => navigate(`/onboard-participant?profile=${id}`)}
        onOpenComplaints={() => navigate("/onboard-participant/complaints")}
      />
    );
  }

  const q = search.trim().toLowerCase();
  const matchesSearch = (i: Intake) => !q || i.full_name.toLowerCase().includes(q) || i.ndis_number.toLowerCase().includes(q);
  const matchesKpi = (i: Intake) => {
    if (activeKpi === "open") return columnIdForStatus(i.status) !== "active" && i.status !== "declined";
    if (activeKpi === "stuck") return columnIdForStatus(i.status) !== "active" && i.status !== "declined" && daysSince(i.created_at) >= 7;
    if (activeKpi === "active") return columnIdForStatus(i.status) === "active";
    if (activeKpi === "signature") return i.status === "awaiting_signatures";
    return true;
  };
  const matchesCategory = (i: Intake) => categoryFilter === "all" || i.service_category === categoryFilter;
  const matchesStage = (i: Intake) => stageFilter === "all" || columnIdForStatus(i.status) === stageFilter;
  const matches = (i: Intake) => matchesSearch(i) && matchesKpi(i) && matchesCategory(i) && matchesStage(i);

  function setKpiFilter(filter: "open" | "stuck" | "active" | "signature") {
    setActiveKpi((prev) => (prev === filter ? null : filter));
  }

  // KPI strip. "Active participants" and "Ready for signature" mean org-wide
  // counts once a real backend exists — for now they're scoped to what this
  // page knows about locally.
  const openEnquiries = intakes.filter((i) => columnIdForStatus(i.status) !== "active" && i.status !== "declined").length;
  const stuckCount = intakes.filter((i) => columnIdForStatus(i.status) !== "active" && i.status !== "declined" && daysSince(i.created_at) >= 7).length;
  const activeCount = intakes.filter((i) => columnIdForStatus(i.status) === "active").length;
  const readyForSignatureCount = intakes.filter((i) => i.status === "awaiting_signatures").length;

  function comingSoon(feature: string) {
    toast({ title: "Coming soon", description: `${feature} isn't built yet — it needs its own scoped piece of work.` });
  }

  const COLUMN_ORDER: Record<BoardColumnId, number> = { enquiry: 0, screening: 1, meet_greet: 2, service_agreement: 3, active: 4 };
  const listRows: ParticipantListRow[] = intakes
    .filter((i) => matches(i) && columnIdForStatus(i.status) !== null)
    .map((i): ParticipantListRow => {
      const columnId = columnIdForStatus(i.status) as BoardColumnId;
      const col = BOARD_COLUMNS.find((c) => c.id === columnId)!;
      return {
        id: i.id,
        name: i.full_name,
        categoryLabel: i.service_category === "aged_care" ? "Aged Care" : "Disability",
        columnId,
        stageLabel: col.label,
        color: COLUMN_COLOR[columnId],
        meta: subtitleForIntake(i),
        onOpen: () => navigate(`/onboard-participant?intake=${i.id}`),
      };
    })
    .sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      return (COLUMN_ORDER[a.columnId] - COLUMN_ORDER[b.columnId]) * dir || a.name.localeCompare(b.name);
    });

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
            <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight mt-2" style={{ color: TEXT }}>
              Participant Onboarding
              <SectionInfo text="Move a new participant from referral through to an active plan: intake, consent, and setup." />
            </h1>
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
          <KpiTile label="Open enquiries" value={openEnquiries} color={CRITICAL} bg={CRITICAL_BG} icon={ClipboardCheck} active={activeKpi === "open"} onClick={() => setKpiFilter("open")} />
          <KpiTile label="Stuck 7+ days" value={stuckCount} color={WARNING} bg={WARNING_BG} icon={Clock3} active={activeKpi === "stuck"} onClick={() => setKpiFilter("stuck")} />
          <KpiTile label="Active participants" value={activeCount} color={SUCCESS} bg={SUCCESS_BG} icon={ShieldCheck} active={activeKpi === "active"} onClick={() => setKpiFilter("active")} />
          <KpiTile label="Ready for signature" value={readyForSignatureCount} color={INFO} bg={INFO_BG} icon={PenLine} active={activeKpi === "signature"} onClick={() => setKpiFilter("signature")} />
        </div>

        <div className="flex flex-col gap-3 rounded-[1.25rem] border bg-white p-3 sm:flex-row sm:items-center" style={{ borderColor: BORDER }}>
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for the Participant"
              className="h-10 rounded-xl border-0 bg-[#F8F7F4] pl-9 text-[12px] shadow-none focus-visible:ring-1"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/5">
                <X size={13} style={{ color: MUTED }} />
              </button>
            )}
          </div>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as "all" | ServiceCategory)}>
            <SelectTrigger className="h-10 w-full rounded-xl border-0 bg-[#F8F7F4] text-[12px] shadow-none sm:w-[170px]">
              <Users size={14} className="mr-1.5" /><SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="disability">Disability</SelectItem>
              <SelectItem value="aged_care">Aged Care</SelectItem>
            </SelectContent>
          </Select>
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as "all" | BoardColumnId)}>
            <SelectTrigger className="h-10 w-full rounded-xl border-0 bg-[#F8F7F4] text-[12px] shadow-none sm:w-[170px]">
              <SlidersHorizontal size={14} className="mr-1.5" /><SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {BOARD_COLUMNS.map((col) => (
                <SelectItem key={col.id} value={col.id}>{col.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(activeKpi || categoryFilter !== "all" || stageFilter !== "all" || search) && (
            <button
              onClick={() => { setActiveKpi(null); setCategoryFilter("all"); setStageFilter("all"); setSearch(""); }}
              className="flex h-10 shrink-0 items-center justify-center gap-1 rounded-xl px-3 text-[11px] font-bold hover:bg-black/5"
              style={{ color: MUTED }}
            >
              <X size={13} /> Clear
            </button>
          )}
          <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl p-1" style={{ background: "#F8F7F4" }}>
            <button
              onClick={() => setView("kanban")}
              aria-pressed={view === "kanban"}
              title="Board view"
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition-all"
              style={{ background: view === "kanban" ? "white" : "transparent", color: view === "kanban" ? PLUM : MUTED, boxShadow: view === "kanban" ? "var(--cc-shadow-sm)" : "none" }}
            >
              <LayoutGrid size={13} /> Board
            </button>
            <button
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              title="List view"
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition-all"
              style={{ background: view === "list" ? "white" : "transparent", color: view === "list" ? PLUM : MUTED, boxShadow: view === "list" ? "var(--cc-shadow-sm)" : "none" }}
            >
              <Rows3 size={13} /> List
            </button>
          </div>
        </div>

        {view === "kanban" ? (
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
                    {col.id === "active" ? (
                      <button
                        onClick={() => navigate("/onboard-participant/active")}
                        className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-70"
                        title="View full Participants list"
                      >
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                        <p className="text-[13px] font-black underline decoration-dotted underline-offset-2" style={{ color: TEXT }}>{col.label}</p>
                        <ChevronRight size={12} style={{ color }} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                        <p className="text-[13px] font-black" style={{ color: TEXT }}>{col.label}</p>
                      </div>
                    )}
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
        ) : (
          <ParticipantListView rows={listRows} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
        )}

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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Service category</label>
                <Select value={serviceCategory} onValueChange={(v) => setServiceCategory(v as ServiceCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disability">Disability</SelectItem>
                    <SelectItem value="aged_care">Aged Care</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>
                  Date of birth <span style={{ color: DANGER }}>*</span>
                </label>
                <Input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  aria-invalid={agedCareBlocked}
                  className={agedCareBlocked ? "border-red-400 focus-visible:ring-red-400" : undefined}
                />
              </div>
            </div>
            {serviceCategory === "aged_care" && (
              <p className="text-[11px] font-medium" style={{ color: agedCareBlocked ? DANGER : MUTED }}>
                {agedCareBlocked
                  ? `Aged Care is only available to participants aged 65 and over${dobAge !== null ? ` — this person is ${dobAge}.` : "."}`
                  : "Aged Care is only available to participants aged 65 and over — date of birth is required to confirm eligibility."}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>NDIS number</label>
                <Input value={ndisNumber} onChange={(e) => setNdisNumber(e.target.value)} placeholder="e.g. 430123456" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Funding type</label>
                <Select value={fundingType} onValueChange={(v) => setFundingType(v as FundingType)}>
                  <SelectTrigger><SelectValue placeholder="Select funding type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ndia_managed">NDIA-managed</SelectItem>
                    <SelectItem value="plan_managed">Plan-managed</SelectItem>
                    <SelectItem value="self_managed">Self-managed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
              disabled={creatingIntake || !fullName.trim() || !ndisNumber.trim() || !dob.trim() || !isValidEmail(email) || (phone.trim().length > 0 && !isValidPhone(phone)) || agedCareBlocked}
            >
              {creatingIntake ? <Loader2 size={14} className="animate-spin" /> : "Log enquiry"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

type CheckState = "pass" | "fail" | "unknown";

/** One category card in the Screening checklist. */
function CheckCategory({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4" style={{ background: SURFACE, borderColor: BORDER }}>
      <div className="flex items-center gap-2 pb-2.5 mb-2.5 border-b" style={{ borderColor: BORDER }}>
        <Icon size={14} style={{ color: PLUM }} />
        <p className="text-xs font-black uppercase tracking-wide" style={{ color: TEXT }}>{title}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/** One automatically-computed screening check — pass/fail/unknown derived from data already on file. */
function CheckItem({ label, state, detail }: { label: string; state: CheckState; detail: string }) {
  const Icon = state === "pass" ? CheckCircle2 : state === "fail" ? XCircle : AlertTriangle;
  const color = state === "pass" ? SUCCESS : state === "fail" ? DANGER : WARNING;
  const bg = state === "pass" ? SUCCESS_BG : state === "fail" ? DANGER_BG : WARNING_BG;
  return (
    <div className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ background: bg }}>
      <Icon size={14} style={{ color }} className="shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs font-bold" style={{ color }}>{label}</p>
        <p className="mt-0.5 text-[11px] leading-4" style={{ color: TEXT }}>{detail}</p>
      </div>
    </div>
  );
}

/** One judgment-call screening check the MD answers by hand — no data model exists for these yet. */
function ManualCheckItem({
  label, detail, value, onChange, trueLabel = "Yes", falseLabel = "No",
}: {
  label: string;
  detail: string;
  value?: boolean;
  onChange: (v: boolean) => void;
  trueLabel?: string;
  falseLabel?: string;
}) {
  const state: CheckState = value === undefined ? "unknown" : value ? "pass" : "fail";
  const color = state === "pass" ? SUCCESS : state === "fail" ? DANGER : WARNING;
  const bg = state === "pass" ? SUCCESS_BG : state === "fail" ? DANGER_BG : WARNING_BG;
  return (
    <div className="rounded-lg p-2.5" style={{ background: bg }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-bold" style={{ color }}>{label}</p>
          <p className="mt-0.5 text-[11px] leading-4" style={{ color: TEXT }}>{detail}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => onChange(true)}
            className="rounded-full px-2.5 py-1 text-[10px] font-black transition-all"
            style={{ background: value === true ? SUCCESS : "white", color: value === true ? "white" : MUTED, border: `1px solid ${value === true ? SUCCESS : BORDER}` }}
          >
            {trueLabel}
          </button>
          <button
            onClick={() => onChange(false)}
            className="rounded-full px-2.5 py-1 text-[10px] font-black transition-all"
            style={{ background: value === false ? DANGER : "white", color: value === false ? "white" : MUTED, border: `1px solid ${value === false ? DANGER : BORDER}` }}
          >
            {falseLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The four screening categories a provider checks before deciding whether
 * to proceed: eligibility/demographics, operational capacity, funding, and
 * safety/risk. Items with underlying intake data are computed automatically;
 * the rest (staff rosters, waitlists, on-the-ground risk) need a manual
 * answer since there's no system of record for them elsewhere in the app.
 */
function ScreeningChecklist({
  intake, currentCaseload, totalCapacity, onUpdateChecks,
}: {
  intake: Intake;
  currentCaseload: number;
  totalCapacity: number;
  onUpdateChecks: (patch: Partial<ScreeningManualChecks>) => void;
}) {
  const wi = intake.web_intake;
  const checks = intake.screening_checks ?? {};

  // Service area = the states the org actually has an office in (Settings →
  // Provider/Branches) — no more hardcoded state list.
  const { branches } = useBranches();
  const providerServiceStates = [...new Set(branches.map((b) => b.state))];

  // ── 1. Essential Eligibility & Demographics ──────────────────────────
  const ageOk = intake.service_category !== "aged_care" || isAgedCareEligible(wi?.date_of_birth);
  const locationKnown = !!wi?.state;
  const locationOk = locationKnown ? providerServiceStates.includes(wi!.state!.trim().toUpperCase()) : null;
  const language = wi?.preferred_language?.trim();
  const languageAutoOk = !language || PROVIDER_LANGUAGES.some((l) => l.toLowerCase() === language.toLowerCase());

  // ── 2. Operational Capacity & Availability ───────────────────────────
  const capacityRemaining = totalCapacity - currentCaseload;
  const hasCapacity = capacityRemaining > 0;

  // ── 3. Financial & Funding Viability ─────────────────────────────────
  const fundingType = wi?.funding_type;
  const fundingTypeOk = fundingType === "ndia_managed" ? PROVIDER_ACCEPTS_NDIA_MANAGED : true;
  const planStatus = wi?.plan_status?.trim();
  const fundingAvailable = planStatus ? planStatus.toLowerCase().includes("active") : null;

  // Flat list purely for the overall readiness summary at the top — one
  // source of truth so the banner can never drift from the cards below.
  const results: CheckState[] = [
    ageOk ? "pass" : "fail",
    locationKnown ? (locationOk ? "pass" : "fail") : "unknown",
    languageAutoOk ? "pass" : (checks.language_support_ok === undefined ? "unknown" : checks.language_support_ok ? "pass" : "fail"),
    hasCapacity ? "pass" : "fail",
    hasCapacity ? "pass" : (checks.waitlist_open === undefined ? "unknown" : checks.waitlist_open ? "pass" : "fail"),
    checks.resource_match_ok === undefined ? "unknown" : checks.resource_match_ok ? "pass" : "fail",
    fundingType ? (fundingTypeOk ? "pass" : "fail") : "unknown",
    fundingAvailable === null ? "unknown" : fundingAvailable ? "pass" : "fail",
    checks.environment_safe === undefined ? "unknown" : checks.environment_safe ? "pass" : "fail",
    checks.no_red_flags === undefined ? "unknown" : checks.no_red_flags ? "pass" : "fail",
  ];
  const blockedCount = results.filter((r) => r === "fail").length;
  const reviewCount = results.filter((r) => r === "unknown").length;
  const overall: CheckState = blockedCount > 0 ? "fail" : reviewCount > 0 ? "unknown" : "pass";
  const overallMeta = {
    pass: { color: SUCCESS, bg: SUCCESS_BG, icon: CheckCircle2, text: "All screening criteria met — ready to proceed." },
    fail: { color: DANGER, bg: DANGER_BG, icon: XCircle, text: `${blockedCount} ${blockedCount === 1 ? "criterion" : "criteria"} failed — cannot proceed as-is.` },
    unknown: { color: WARNING, bg: WARNING_BG, icon: AlertTriangle, text: `${reviewCount} item${reviewCount === 1 ? "" : "s"} still need review before proceeding.` },
  }[overall];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: overallMeta.bg }}>
        <overallMeta.icon size={16} style={{ color: overallMeta.color }} className="shrink-0" />
        <p className="text-xs font-bold" style={{ color: overallMeta.color }}>{overallMeta.text}</p>
      </div>

      <CheckCategory icon={User} title="1. Essential eligibility & demographics">
        <CheckItem
          label="Age group"
          state={ageOk ? "pass" : "fail"}
          detail={
            intake.service_category === "aged_care"
              ? ageOk
                ? "Aged Care requires 65+ — this participant meets that."
                : "Aged Care requires 65+ — this participant does not meet that."
              : "Disability services have no age restriction."
          }
        />
        <CheckItem
          label="Location"
          state={locationKnown ? (locationOk ? "pass" : "fail") : "unknown"}
          detail={
            locationKnown
              ? locationOk
                ? `${wi?.state} is within the provider's service area (${providerServiceStates.join(", ")}).`
                : `${wi?.state} is outside the provider's service area (${providerServiceStates.join(", ")}).`
              : "No address on file yet — add one to confirm this is within the service area."
          }
        />
        {languageAutoOk ? (
          <CheckItem
            label="Language/Culture"
            state="pass"
            detail={language ? `${language} is supported by current staff.` : "No specific language or cultural requirement noted."}
          />
        ) : (
          <ManualCheckItem
            label="Language/Culture"
            detail={`${language} was requested — do current staff support this, or is an interpreter available?`}
            value={checks.language_support_ok}
            onChange={(v) => onUpdateChecks({ language_support_ok: v })}
          />
        )}
      </CheckCategory>

      <CheckCategory icon={Users} title="2. Operational capacity & availability">
        <CheckItem
          label="Staff availability"
          state={hasCapacity ? "pass" : "fail"}
          detail={`${TOTAL_SUPPORT_WORKERS} support workers can carry up to ${totalCapacity} participants (${MAX_CASELOAD_PER_WORKER} each). Currently supporting ${currentCaseload}${hasCapacity ? ` — ${capacityRemaining} spot${capacityRemaining === 1 ? "" : "s"} free.` : " — no free capacity."}`}
        />
        {hasCapacity ? (
          <CheckItem label="Waitlist status" state="pass" detail="Not applicable — capacity is currently available." />
        ) : (
          <ManualCheckItem
            label="Waitlist status"
            detail="At capacity — is the waitlist open, or should this referral be declined now?"
            value={checks.waitlist_open}
            trueLabel="Waitlist open"
            falseLabel="Must decline"
            onChange={(v) => onUpdateChecks({ waitlist_open: v })}
          />
        )}
        <ManualCheckItem
          label="Resource matching"
          detail="Does the provider have the specific service type this participant needs (e.g. registered nurse vs. general support worker)?"
          value={checks.resource_match_ok}
          onChange={(v) => onUpdateChecks({ resource_match_ok: v })}
        />
      </CheckCategory>

      <CheckCategory icon={FileSignature} title="3. Financial & funding viability">
        <CheckItem
          label="Funding type"
          state={fundingType ? (fundingTypeOk ? "pass" : "fail") : "unknown"}
          detail={
            fundingType
              ? `${FUNDING_TYPE_LABEL[fundingType]}${fundingType === "ndia_managed" && !PROVIDER_ACCEPTS_NDIA_MANAGED ? " — this provider isn't registered to accept NDIA-managed participants." : "."}`
              : "Funding type not captured yet — add it on the Enquiry tab to confirm."
          }
        />
        <CheckItem
          label="Funding availability"
          state={fundingAvailable === null ? "unknown" : fundingAvailable ? "pass" : "fail"}
          detail={planStatus ? `Plan status: ${planStatus}.` : "Plan status not captured yet — add it on the Enquiry tab to confirm an active budget."}
        />
      </CheckCategory>

      <CheckCategory icon={ShieldCheck} title="4. High-level universal safety & risk">
        <ManualCheckItem
          label="Environment safety"
          detail="For home care — is the geographic area/environment considered safe for staff to enter?"
          value={checks.environment_safe}
          onChange={(v) => onUpdateChecks({ environment_safe: v })}
        />
        <ManualCheckItem
          label="Immediate red flags"
          detail="Any known, severe historic risks that exceed this provider's registration limits or insurance coverage?"
          value={checks.no_red_flags}
          trueLabel="No red flags"
          falseLabel="Red flag found"
          onChange={(v) => onUpdateChecks({ no_red_flags: v })}
        />
        {checks.no_red_flags === false && (
          <Textarea
            value={checks.red_flag_notes ?? ""}
            onChange={(e) => onUpdateChecks({ red_flag_notes: e.target.value })}
            placeholder="Describe the risk and why it exceeds registration/insurance limits…"
            className="min-h-[70px] text-sm"
          />
        )}
      </CheckCategory>
    </div>
  );
}

function IntakeDetail({
  intake, onBack, onUpdate, onLocalUpdate, currentCaseload, totalCapacity,
}: {
  intake: Intake;
  onBack: () => void;
  onUpdate: (patch: Partial<Intake>) => Promise<Intake>;
  /** Merges into local state only — for results of a call that already
   *  persisted server-side through its own endpoint (the document upload),
   *  so it doesn't also fire a redundant PATCH. */
  onLocalUpdate: (patch: Partial<Intake>) => void;
  /** Active caseload vs. total capacity across current support workers — drives the Screening capacity check. */
  currentCaseload: number;
  totalCapacity: number;
}) {
  const { toast } = useToast();
  const [declineReason, setDeclineReason] = useState("");
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState("");
  const [notes, setNotes] = useState(intake.meet_greet_notes ?? "");
  const [providerName, setProviderName] = useState(intake.provider_signed_name ?? "");
  const [familyName, setFamilyName] = useState(intake.family_signed_name ?? "");
  const providerSignature = useSignatureCanvasState();
  const familySignature = useSignatureCanvasState();
  const [activating, setActivating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [boardSubtitle, setBoardSubtitle] = useState(intake.board_subtitle ?? "");

  // Intake form: read-only by default (showing whatever's saved), only
  // switches to editable fields once "Edit" is clicked. Cancelling drops
  // the draft and reverts to what was saved before.
  const [intakeFormEditing, setIntakeFormEditing] = useState(false);
  const [intakeFormDraft, setIntakeFormDraft] = useState<Partial<WebIntakeForm>>(intake.web_intake ?? {});
  const [serviceCategoryDraft, setServiceCategoryDraft] = useState<ServiceCategory>(intake.service_category ?? "disability");
  function updateIntakeFormDraft(patch: Partial<WebIntakeForm>) {
    setIntakeFormDraft((prev) => ({ ...prev, ...patch }));
  }
  function startEditingIntakeForm() {
    setIntakeFormDraft(intake.web_intake ?? {});
    setServiceCategoryDraft(intake.service_category ?? "disability");
    setIntakeFormEditing(true);
  }
  function cancelEditingIntakeForm() {
    setIntakeFormDraft(intake.web_intake ?? {});
    setServiceCategoryDraft(intake.service_category ?? "disability");
    setIntakeFormEditing(false);
  }
  function saveIntakeForm(contact: { email: string; phone: string }) {
    if (serviceCategoryDraft === "aged_care" && !isAgedCareEligible(intakeFormDraft.date_of_birth)) {
      toast({ title: "Cannot save", description: "Aged Care requires a date of birth confirming the participant is 65 or over.", variant: "destructive" });
      return;
    }
    const payload: WebIntakeForm = {
      ...intakeFormDraft,
      submitted_at: intake.web_intake?.submitted_at ?? new Date().toISOString(),
      submitted_by: intakeFormDraft.submitted_by || "Provider",
    };
    onUpdate({ web_intake: payload, service_category: serviceCategoryDraft, email: contact.email, phone: contact.phone });
    setIntakeFormEditing(false);
    toast({ title: "Intake form saved" });
  }

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
  // Meet & Greet only — uses the same real, AI-backed pipeline as the
  // coordinator's Easy Capture elsewhere in the app (createMeetingSession +
  // transcribeAndResolveNames) — this intake isn't a real participant yet,
  // so the session is created "unassigned" (participant_id omitted), which
  // the backend already supports. Goal/task auto-extraction is
  // intentionally skipped — that writes to a real participant's plan,
  // which doesn't exist pre-activation.
  const [recording, setRecording] = useState(false);
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

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({ title: "Voice recording not supported", description: "Please use a different browser or device.", variant: "destructive" });
      return;
    }
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
        onUpdate({ meet_greet_recording_url: url });
        if (meetingSessionIdRef.current) {
          transcribeMeetGreet(meetingSessionIdRef.current, blob);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setElapsedSec(0);
      setRecording(true);
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
      provider_signature_png: providerSignature.signaturePng || undefined,
      family_signature_png: familySignature.signaturePng || undefined,
    });
    toast({ title: "Draft saved" });
  }

  async function uploadSignedDocument(file: File) {
    try {
      const updated = await uploadSignedServiceAgreement(intake.id, file);
      onLocalUpdate({ signed_document_url: updated.signed_document_url, signed_document_name: updated.signed_document_name });
      toast({ title: "Document uploaded", description: file.name });
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  function markSigned() {
    if (!providerName.trim() || !familyName.trim() || !providerSignature.hasStroke || !familySignature.hasStroke) return;
    const now = new Date().toISOString();
    onUpdate({
      status: "signed",
      provider_signed_name: providerName.trim(),
      provider_signed_at: now,
      provider_signature_png: providerSignature.signaturePng,
      family_signed_name: familyName.trim(),
      family_signed_at: now,
      family_signature_png: familySignature.signaturePng,
    });
    toast({ title: "Service agreement" });
  }

  async function activate() {
    setActivating(true);
    try {
      await onUpdate({ status: "active" });
      toast({ title: "Participant activated", description: `${intake.full_name} now appears on the Coordinator's dashboard.` });
    } catch {
      // error already toasted by onUpdate
    } finally {
      setActivating(false);
    }
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
                    <IntakeFormBlock
                      intake={intake}
                      draft={intakeFormDraft}
                      onChange={updateIntakeFormDraft}
                      editing={intakeFormEditing}
                      onEdit={startEditingIntakeForm}
                      onCancel={cancelEditingIntakeForm}
                      onSave={saveIntakeForm}
                      serviceCategory={serviceCategoryDraft}
                      onServiceCategoryChange={setServiceCategoryDraft}
                    />

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
                        <p className="text-xs" style={{ color: MUTED }}>Can this organisation take this participant on? Check the four areas below before deciding.</p>

                        <ScreeningChecklist
                          intake={intake}
                          currentCaseload={currentCaseload}
                          totalCapacity={totalCapacity}
                          onUpdateChecks={(patch) => onUpdate({ screening_checks: { ...intake.screening_checks, ...patch } })}
                        />

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
                      <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                        <CheckCircle2 size={16} style={{ color: SUCCESS }} className="shrink-0" />
                        <p className="text-xs font-bold" style={{ color: SUCCESS }}>Passed screening.</p>
                      </div>
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
                      recording ? (
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
                            onConfirm={startRecording}
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

                    {intake.status === "awaiting_signatures" ? (
                      <>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Provider signatory</label>
                            <Input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Your full name" />
                            <SignatureCanvas minWidth={200} minHeight={90} onChange={providerSignature.onCanvasChange} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Participant / guardian signatory</label>
                            <Input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Their full name" />
                            <SignatureCanvas minWidth={200} minHeight={90} onChange={familySignature.onCanvasChange} />
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
                            <Button
                              variant="navy"
                              className="gap-2 rounded-lg"
                              onClick={markSigned}
                              disabled={!providerName.trim() || !familyName.trim() || !providerSignature.hasStroke || !familySignature.hasStroke}
                            >
                              Next <PenLine size={14} />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-3">
                        <SignatureCard label="Provider" signedName={intake.provider_signed_name} signedAt={intake.provider_signed_at} signaturePng={intake.provider_signature_png} pendingLabel="Not yet signed" />
                        <SignatureCard label="Participant / guardian" signedName={intake.family_signed_name} signedAt={intake.family_signed_at} signaturePng={intake.family_signature_png} pendingLabel="Not yet signed" />
                      </div>
                    )}

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
                    <p className="text-sm font-black" style={{ color: TEXT }}>Profile</p>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                      <Users size={16} style={{ color: SUCCESS }} className="shrink-0" />
                      <p className="text-xs" style={{ color: TEXT }}>
                        {intake.full_name.split(" ")[0]} is active and now appears on the Coordinator's dashboard for scheduling and support planning.
                      </p>
                    </div>

                    {/* Full intake profile — everything captured across the pipeline
                        (patient details, address, NDIS, plan manager, next of kin,
                        referral) so the MD doesn't have to click back to Enquiry
                        to see what was entered. */}
                    <IntakeFormBlock
                      intake={intake}
                      draft={intakeFormDraft}
                      onChange={updateIntakeFormDraft}
                      editing={intakeFormEditing}
                      onEdit={startEditingIntakeForm}
                      onCancel={cancelEditingIntakeForm}
                      onSave={saveIntakeForm}
                      serviceCategory={serviceCategoryDraft}
                      onServiceCategoryChange={setServiceCategoryDraft}
                      showSubmissionStatus={false}
                    />

                    {(intake.plan_start_date || intake.plan_end_date || intake.total_budget || intake.provider_signed_name || intake.family_signed_name) && (
                      <IntakeFormSection icon={FileSignature} title="Service Agreement">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          <Field label="Plan start" value={formatDate(intake.plan_start_date)} editing={false} />
                          <Field label="Plan end" value={formatDate(intake.plan_end_date)} editing={false} />
                          <Field label="Total budget" value={intake.total_budget} editing={false} />
                          <Field label="Provider signed by" value={intake.provider_signed_name} editing={false} />
                          <Field label="Family signed by" value={intake.family_signed_name} editing={false} />
                          <Field label="Activated" value={formatDate(intake.activated_at)} editing={false} />
                        </div>
                      </IntakeFormSection>
                    )}
                  </div>
                </div>
              )}

              {/* Terminate application — available from any in-progress step, not just
                  Enquiry/Screening. Distinct from Decline: this is the participant's own
                  choice not to continue, not the provider turning them away. */}
              {intake.status !== "active" && intake.status !== "inactive" && (
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

/** Radio-button option row — used for the Meet & Greet consent gate's "Consent given by" and "Method" choices. */
function ConsentRadio({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label
      className="flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer transition-colors"
      style={{ background: SURFACE, border: `1px solid ${checked ? PLUM : BORDER}` }}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-[var(--cc-plum)]"
      />
      <span className="text-[12px] font-bold" style={{ color: checked ? PLUM : TEXT }}>{label}</span>
    </label>
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
          <ConsentRadio name="consent-given-by" label="Participant" checked={consentGivenBy === "participant"} onChange={() => onConsentGivenByChange("participant")} />
          <ConsentRadio name="consent-given-by" label="Nominee" checked={consentGivenBy === "nominee"} onChange={() => onConsentGivenByChange("nominee")} />
          <ConsentRadio name="consent-given-by" label="Guardian" checked={consentGivenBy === "guardian"} onChange={() => onConsentGivenByChange("guardian")} />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>Method</p>
        <div className="flex gap-1.5">
          <ConsentRadio name="consent-method" label="Verbal" checked={consentMethod === "verbal"} onChange={() => onConsentMethodChange("verbal")} />
          <ConsentRadio name="consent-method" label="Written" checked={consentMethod === "written"} onChange={() => onConsentMethodChange("written")} />
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

function IntakeFormSection({
  icon: Icon, title, children, onEdit, editing,
}: {
  icon: typeof Mail;
  title: string;
  children: React.ReactNode;
  /** Per-section Edit trigger (profile views) — omit to render a plain, non-editable section header. */
  onEdit?: () => void;
  editing?: boolean;
}) {
  return (
    <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <Icon size={15} style={{ color: PLUM }} />
          <p className="text-xs font-black uppercase tracking-wide" style={{ color: TEXT }}>{title}</p>
        </div>
        {onEdit && !editing && (
          <Button variant="ghost" size="sm" className="gap-1.5 rounded-lg h-7 px-2 text-[11px]" onClick={onEdit}>
            <PenLine size={12} /> Edit
          </Button>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}


/**
 * Dual-mode field: read-only text when `editing` is false (hides itself if
 * empty, same as the old display-only view), an input when true.
 */
function Field({
  label, value, onChange, editing, placeholder, type, icon: Icon,
}: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  editing: boolean;
  placeholder?: string;
  type?: string;
  icon?: typeof Mail;
}) {
  if (!editing) {
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
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{label}</label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} className="h-9 text-sm" />
    </div>
  );
}

/**
 * Participant intake form — read-only by default (whatever's saved on
 * intake.web_intake), switches to editable fields only once "Edit" is
 * clicked. Same field set whether it arrived via the web referral form or
 * the provider fills it in themselves.
 */
function IntakeFormBlock({
  intake, draft, onChange, editing, onEdit, onCancel, onSave, serviceCategory, onServiceCategoryChange,
  showSubmissionStatus = true,
}: {
  intake: Intake;
  draft: Partial<WebIntakeForm>;
  onChange: (patch: Partial<WebIntakeForm>) => void;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  /** Passes back the current contact fields, since they're not part of `draft`
   *  (they're top-level Intake fields, editable here so contact details can be
   *  kept current after intake, not just captured once). */
  onSave: (contact: { email: string; phone: string }) => void;
  serviceCategory: ServiceCategory;
  onServiceCategoryChange: (v: ServiceCategory) => void;
  /** Hide the "Digital intake form submitted ..." banner + "Submitted by" pill — used on the plain participant profile, where it should read as a person's record, not a pipeline/workflow status. Edit controls still show. */
  showSubmissionStatus?: boolean;
}) {
  const kin = draft.next_of_kin ?? [];
  const hasAnyData = Object.keys(intake.web_intake ?? {}).length > 0;
  const agedCareBlocked = serviceCategory === "aged_care" && !isAgedCareEligible(draft.date_of_birth);

  // Contact details live on the Intake record itself (not `web_intake`), but
  // are edited right alongside the rest of this form so they can be kept
  // current when someone's email or phone changes.
  const [emailDraft, setEmailDraft] = useState(intake.email);
  const [phoneDraft, setPhoneDraft] = useState(intake.phone);
  useEffect(() => {
    if (editing) {
      setEmailDraft(intake.email);
      setPhoneDraft(intake.phone);
    }
  }, [editing, intake.id, intake.email, intake.phone]);
  const emailInvalid = emailDraft.trim().length > 0 && !isValidEmail(emailDraft);
  const phoneInvalid = phoneDraft.trim().length > 0 && !isValidPhone(phoneDraft);
  const saveDisabled = agedCareBlocked || emailInvalid || phoneInvalid;

  function handleSave() {
    onSave({ email: emailDraft.trim(), phone: phoneDraft.trim() });
  }

  function updateKin(index: number, patch: Partial<NextOfKinEntry>) {
    const next = kin.map((k, i) => (i === index ? { ...k, ...patch } : k));
    onChange({ next_of_kin: next });
  }
  function addKin() {
    onChange({ next_of_kin: [...kin, { name: "" }] });
  }
  function removeKin(index: number) {
    onChange({ next_of_kin: kin.filter((_, i) => i !== index) });
  }

  // Profile views (showSubmissionStatus=false) put an Edit trigger in every
  // section header instead of one shared bar at the top, so it reads as a
  // person's record, not a form with a workflow-status banner. The pipeline
  // Enquiry step keeps the original single banner+button.
  const sectionEditProps = showSubmissionStatus ? {} : { onEdit, editing };

  return (
    <div className="space-y-4">
      {showSubmissionStatus && (
        <div
          className="rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: intake.web_intake?.submitted_at ? CRITICAL_BG : SOFT }}
        >
          <div className="flex items-center gap-2.5">
            <FileText size={16} style={{ color: intake.web_intake?.submitted_at ? CRITICAL : MUTED }} />
            <p className="text-sm font-bold" style={{ color: intake.web_intake?.submitted_at ? CRITICAL : MUTED }}>
              {intake.web_intake?.submitted_at
                ? `Digital intake form submitted ${formatDate(intake.web_intake.submitted_at)}`
                : "No intake form on file yet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {intake.web_intake?.submitted_by && (
              <span className="text-[11px] font-black px-3 py-1 rounded-full" style={{ background: SURFACE, color: CRITICAL, border: `1px solid ${CRITICAL}` }}>
                Submitted by {intake.web_intake.submitted_by}
              </span>
            )}
            {!editing ? (
              <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={onEdit}>
                <PenLine size={13} /> {hasAnyData ? "Edit" : "Fill in intake form"}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-lg" onClick={onCancel}>Cancel</Button>
                <Button variant="navy" size="sm" className="gap-1.5 rounded-lg" onClick={handleSave} disabled={saveDisabled}>
                  <CheckCircle2 size={13} /> Save
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {!showSubmissionStatus && !editing && !hasAnyData && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={onEdit}>
            <PenLine size={13} /> Fill in intake form
          </Button>
        </div>
      )}

      {!editing && !hasAnyData ? null : (
        <>
          <IntakeFormSection icon={User} title="Patient details" {...sectionEditProps}>
            <div className="grid sm:grid-cols-2 gap-3">
              {editing ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Service category</label>
                  <Select value={serviceCategory} onValueChange={(v) => onServiceCategoryChange(v as ServiceCategory)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disability">Disability</SelectItem>
                      <SelectItem value="aged_care">Aged Care</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <Field editing={false} label="Service category" value={serviceCategory === "aged_care" ? "Aged Care" : "Disability"} />
              )}
              {editing ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Funding type</label>
                  <Select value={draft.funding_type ?? ""} onValueChange={(v) => onChange({ funding_type: v as FundingType })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select funding type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ndia_managed">NDIA-managed</SelectItem>
                      <SelectItem value="plan_managed">Plan-managed</SelectItem>
                      <SelectItem value="self_managed">Self-managed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <Field editing={false} label="Funding type" value={draft.funding_type ? FUNDING_TYPE_LABEL[draft.funding_type] : undefined} />
              )}
            </div>
            {editing && serviceCategory === "aged_care" && (
              <p className="text-[11px] font-medium" style={{ color: agedCareBlocked ? DANGER : MUTED }}>
                Aged Care is only available to participants aged 65 and over{agedCareBlocked && draft.date_of_birth ? ` — this person is ${calculateAge(draft.date_of_birth)}.` : "."}
              </p>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <Field editing={editing} label="Given name" value={draft.given_name} onChange={(v) => onChange({ given_name: v })} placeholder="Given name" />
              <Field editing={editing} label="Surname" value={draft.surname} onChange={(v) => onChange({ surname: v })} placeholder="Surname" />
              <Field editing={editing} label="Preferred name" value={draft.preferred_name} onChange={(v) => onChange({ preferred_name: v })} placeholder="Preferred name" />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              {editing ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Pronouns</label>
                  <Select
                    value={selectValueForOption(draft.pronouns, PRONOUN_FIXED_VALUES)}
                    onValueChange={(v) => onChange({ pronouns: v })}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select pronouns" /></SelectTrigger>
                    <SelectContent>
                      {PRONOUN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectValueForOption(draft.pronouns, PRONOUN_FIXED_VALUES) === "self_describe" && (
                    <Input
                      value={draft.pronouns === "self_describe" ? "" : draft.pronouns ?? ""}
                      onChange={(e) => onChange({ pronouns: e.target.value })}
                      placeholder="Please specify"
                      className="h-9 text-sm mt-1.5"
                    />
                  )}
                </div>
              ) : (
                <Field editing={false} label="Pronouns" value={labelForOption(draft.pronouns, PRONOUN_OPTIONS)} />
              )}
              {editing ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Gender</label>
                  <Select
                    value={selectValueForOption(draft.gender, GENDER_FIXED_VALUES)}
                    onValueChange={(v) => onChange({ gender: v })}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select gender" /></SelectTrigger>
                    <SelectContent>
                      {GENDER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectValueForOption(draft.gender, GENDER_FIXED_VALUES) === "self_describe" && (
                    <Input
                      value={draft.gender === "self_describe" ? "" : draft.gender ?? ""}
                      onChange={(e) => onChange({ gender: e.target.value })}
                      placeholder="Please specify"
                      className="h-9 text-sm mt-1.5"
                    />
                  )}
                </div>
              ) : (
                <Field editing={false} label="Gender" value={labelForOption(draft.gender, GENDER_OPTIONS)} />
              )}
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field
                editing={editing}
                label="Date of birth"
                type="date"
                value={draft.date_of_birth}
                onChange={(v) => onChange({ date_of_birth: v })}
              />
              <Field
                editing={editing}
                label="Preferred language"
                value={draft.preferred_language}
                onChange={(v) => onChange({ preferred_language: v })}
                placeholder="e.g. English, Mandarin"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3 pt-3 border-t" style={{ borderColor: BORDER }}>
              {editing ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Contact email</label>
                  <Input
                    type="email"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    placeholder="family@example.com"
                    aria-invalid={emailInvalid}
                    className={`h-9 text-sm ${emailInvalid ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                  />
                  {emailInvalid && <p className="text-[11px] font-medium" style={{ color: DANGER }}>Enter a valid email address.</p>}
                </div>
              ) : (
                <Field editing={false} label="Contact email" value={intake.email} icon={Mail} />
              )}
              {editing ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Contact phone</label>
                  <Input
                    type="tel"
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    placeholder="0412 345 678"
                    aria-invalid={phoneInvalid}
                    className={`h-9 text-sm ${phoneInvalid ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                  />
                  {phoneInvalid && <p className="text-[11px] font-medium" style={{ color: DANGER }}>Enter a valid phone number.</p>}
                </div>
              ) : (
                <Field editing={false} label="Contact phone" value={intake.phone} icon={PhoneCall} />
              )}
            </div>
          </IntakeFormSection>

          <IntakeFormSection icon={MapPin} title="Address" {...sectionEditProps}>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field editing={editing} label="Street address" value={draft.street_address} onChange={(v) => onChange({ street_address: v })} />
              <Field editing={editing} label="Suburb" value={draft.suburb} onChange={(v) => onChange({ suburb: v })} />
              <Field editing={editing} label="State" value={draft.state} onChange={(v) => onChange({ state: v })} />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field editing={editing} label="Postcode" value={draft.postcode} onChange={(v) => onChange({ postcode: v })} />
            </div>
          </IntakeFormSection>

          <IntakeFormSection icon={ClipboardCheck} title="NDIS plan" {...sectionEditProps}>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field editing={editing} label="Plan status" value={draft.plan_status} onChange={(v) => onChange({ plan_status: v })} placeholder="e.g. Active plan" />
              <Field editing={editing} label="Plan start" type="date" value={draft.plan_start} onChange={(v) => onChange({ plan_start: v })} />
              <Field editing={editing} label="Plan end" type="date" value={draft.plan_end} onChange={(v) => onChange({ plan_end: v })} />
            </div>
          </IntakeFormSection>

          <IntakeFormSection icon={FileSignature} title="Plan manager" {...sectionEditProps}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field editing={editing} label="Name" value={draft.plan_manager_name} onChange={(v) => onChange({ plan_manager_name: v })} />
              <Field editing={editing} label="Organisation" value={draft.plan_manager_org} onChange={(v) => onChange({ plan_manager_org: v })} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field editing={editing} label="Phone" value={draft.plan_manager_phone} onChange={(v) => onChange({ plan_manager_phone: v })} />
              <Field editing={editing} label="Email" value={draft.plan_manager_email} onChange={(v) => onChange({ plan_manager_email: v })} />
            </div>
          </IntakeFormSection>

          {(editing || kin.length > 0) && (
            <IntakeFormSection icon={Users} title="Next of kin" {...sectionEditProps}>
              <div className="space-y-3">
                {kin.length === 0 && (
                  <p className="text-xs" style={{ color: MUTED }}>No next of kin added yet.</p>
                )}
                {editing
                  ? kin.map((entry, i) => (
                    <div key={i} className="grid sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
                      <Field editing label="Name" value={entry.name} onChange={(v) => updateKin(i, { name: v })} />
                      <Field editing label="Relationship" value={entry.relationship} onChange={(v) => updateKin(i, { relationship: v })} />
                      <Field editing label="Phone" value={entry.phone} onChange={(v) => updateKin(i, { phone: v })} />
                      <Field editing label="Email" value={entry.email} onChange={(v) => updateKin(i, { email: v })} />
                      <Button variant="outline" size="sm" className="rounded-lg shrink-0" onClick={() => removeKin(i)} aria-label="Remove next of kin">
                        <Trash2 size={13} style={{ color: DANGER }} />
                      </Button>
                    </div>
                  ))
                  : (
                    <div className="divide-y" style={{ borderColor: BORDER }}>
                      {kin.map((entry, i) => (
                        <div key={i} className="grid sm:grid-cols-4 gap-3 py-3 first:pt-0 last:pb-0">
                          <Field editing={false} label="Name" value={entry.name} />
                          <Field editing={false} label="Relationship" value={entry.relationship} />
                          <Field editing={false} label="Phone" value={entry.phone} icon={PhoneCall} />
                          <Field editing={false} label="Email" value={entry.email} icon={Mail} />
                        </div>
                      ))}
                    </div>
                  )}
                {editing && (
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={addKin}>
                    <Plus size={13} /> Add next of kin
                  </Button>
                )}
              </div>
            </IntakeFormSection>
          )}

          <IntakeFormSection icon={Send} title="Referral details" {...sectionEditProps}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field editing={editing} label="Referral source" value={draft.referral_source} onChange={(v) => onChange({ referral_source: v })} placeholder="e.g. Web referral portal" />
              <Field editing={editing} label="Referral date" type="date" value={draft.referral_date} onChange={(v) => onChange({ referral_date: v })} />
            </div>
            <Field
              editing={editing}
              label="Presenting needs (comma separated)"
              value={(draft.presenting_needs ?? []).join(", ")}
              onChange={(v) => onChange({ presenting_needs: v.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="e.g. Personal care, Community access"
            />
            {editing ? (
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Notes</label>
                <Textarea value={draft.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} className="min-h-[80px] text-sm" placeholder="Any context worth capturing…" />
              </div>
            ) : draft.notes ? (
              <div className="pt-3 border-t" style={{ borderColor: BORDER }}>
                <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>Notes</p>
                <p className="text-sm" style={{ color: TEXT }}>{draft.notes}</p>
              </div>
            ) : null}
          </IntakeFormSection>

          {!showSubmissionStatus && editing && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={onCancel}>Cancel</Button>
              <Button variant="navy" size="sm" className="gap-1.5 rounded-lg" onClick={handleSave} disabled={saveDisabled}>
                <CheckCircle2 size={13} /> Save
              </Button>
            </div>
          )}
        </>
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
  label, signedName, signedAt, signaturePng, pendingLabel,
}: {
  label: string;
  signedName?: string | null;
  signedAt?: string | null;
  signaturePng?: string | null;
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
          {signaturePng && (
            <img src={signaturePng} alt={`${label} signature`} className="mt-2 h-12 rounded border bg-white" style={{ borderColor: BORDER }} />
          )}
        </div>
      ) : (
        <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: MUTED }}><Clock3 size={13} /> {pendingLabel}</p>
      )}
    </div>
  );
}
