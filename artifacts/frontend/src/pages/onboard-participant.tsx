import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft, HeartHandshake, ClipboardCheck, Mic, FileSignature, Send, CheckCircle2, Clock3,
  Loader2, ChevronRight, Search, PenLine, PhoneCall, Mail, XCircle, ShieldCheck, Users,
  MapPin, User, FileText, Trash2, Plus, LayoutGrid, Rows3, ChevronUp, ChevronDown, ArrowRight,
  SlidersHorizontal, X, AlertTriangle, ArrowUp, ArrowDown,
} from "lucide-react";
import { useGetParticipants } from "@workspace/api-client-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { WORKER_STATS_KEY } from "@/lib/query-keys";
import {
  getCoordinatorWorkerStats,
  getOrgAssignments,
  SUPPORT_ALLOCATION_ROLES,
  type WorkerStats,
} from "@/services/coordinatorService";
import { budgetUsage, planEndStatus, planManagementLabel, type Tone } from "@/lib/directory-insights";
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
  EmptyState,
  LoadError,
  PageHeader,
  SkeletonBlocks,
  RowList,
  StatusText,
  SummaryStrip,
  Surface,
  ctaClass as kitCtaClass,
  ghostClass as kitGhostClass,
  outlineClass as kitOutlineClass,
  type Tone as KitTone,
} from "@/components/layout/PageKit";
import { ResponseSheet } from "@/components/feedback/ResponseSheet";
import { useQueryClient } from "@tanstack/react-query";
import { PARTICIPANT_COMPLAINTS_KEY } from "@/lib/query-keys";
import {
  createParticipantComplaint,
  listParticipantComplaints,
  updateParticipantComplaint,
  type ComplaintStatus,
  type ParticipantComplaint,
} from "@/services/participantComplaintsService";
import { MeetGreetCapture } from "@/components/onboarding/MeetGreetCapture";
import { MeetGreetSummaryPanel } from "@/components/onboarding/MeetGreetSummaryPanel";
import {
  listParticipantIntakes, createParticipantIntake, updateParticipantIntake,
  summariseMeetGreet, reviewMeetGreetLine,
  type ParticipantIntake, type IntakeStatus, type EnquirySource, type ServiceCategory, type FundingType,
  type NextOfKinEntry, type WebIntakeForm, type ScreeningManualChecks,
  GENDER_OPTIONS, PRONOUN_OPTIONS,
} from "@/services/participantIntakeService";
import { useBranches } from "@/hooks/useBranches";
import { ParticipantRecordCards } from "@/components/participants/ParticipantRecordCards";
import { ParticipantServiceAgreementSection } from "@/components/participants/ParticipantServiceAgreementSection";
import type { BuilderDefaults } from "@/components/participants/ServiceAgreementBuilder";
import { GrantResultNotice, PortalAccessCard } from "@/components/participant-portal/PortalAccessCard";
import {
  IDENTITY_METHOD_OPTIONS,
  grantPortalAccess,
  type GrantResult,
  type PortalIdentityMethod,
} from "@/services/participantPortalAccessService";

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

const NEW_BADGE_BG = "#EEF1F5";
const NEW_BADGE_TEXT = "#3D5A6C";

const FUNDING_TYPE_LABEL: Record<FundingType, string> = {
  ndia_managed: "NDIA-managed",
  plan_managed: "Plan-managed",
  self_managed: "Self-managed",
};

const GENDER_FIXED_VALUES = new Set(GENDER_OPTIONS.map((o) => o.value).filter((v) => v !== "self_describe"));
const PRONOUN_FIXED_VALUES = new Set(PRONOUN_OPTIONS.map((o) => o.value).filter((v) => v !== "self_describe"));

function selectValueForOption(value: string | undefined, fixedValues: Set<string>): string {
  if (!value) return "";
  return fixedValues.has(value) ? value : "self_describe";
}

function labelForOption(value: string | undefined, options: { value: string; label: string }[]): string | undefined {
  if (!value) return undefined;
  if (value === "self_describe") return undefined;
  return options.find((o) => o.value === value)?.label ?? value;
}

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

type Intake = ParticipantIntake;

const SOURCE_META: Record<EnquirySource, { label: string; icon: typeof Mail }> = {
  online_form: { label: "Web referral", icon: ClipboardCheck },
  email: { label: "Email", icon: Mail },
  phone_call: { label: "Phone call", icon: PhoneCall },
  coordinator_referral: { label: "Support coordinator referral", icon: Users },
};
const sourceMeta = (source: string | null | undefined) =>
  SOURCE_META[source as EnquirySource] ?? { label: "Other", icon: ClipboardCheck };

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

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

const BOARD_COLUMNS = [
  { id: "enquiry", label: "Enquiry" },
  { id: "screening", label: "Screening" },
  { id: "meet_greet", label: "Meet and greet" },
  { id: "service_agreement", label: "Service agreement" },
  { id: "active", label: "Onboarded Participants" },
] as const;

type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"];

const TOTAL_SUPPORT_WORKERS = 5;
const MAX_CASELOAD_PER_WORKER = 6;

const PROVIDER_LANGUAGES = ["English", "Mandarin", "Vietnamese", "Arabic", "Punjabi"];
const PROVIDER_ACCEPTS_NDIA_MANAGED = true;

const STAGE_COLOR: Record<string, string> = {
  enquiry: "#8A78D6",
  screening: "#D39B42",
  meet_greet: "#3B82F6",
  service_agreement: "#C77D3E",
  active: "#0F7B57",
};

/** Still working through onboarding: on the board, not yet active, not closed. */
function inPipeline(status: IntakeStatus): boolean {
  const column = columnIdForStatus(status);
  return column !== null && column !== "active";
}

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

function subtitleForIntake(intake: Intake): string {
  if (intake.board_subtitle) return intake.board_subtitle;
  const column = columnIdForStatus(intake.status);
  switch (column) {
    case "enquiry": {
      const age = daysSince(intake.created_at);
      const relative = age < 1 ? "today" : age === 1 ? "1 day ago" : `${age} days ago`;
      return `${sourceMeta(intake.source).label} · ${relative}`;
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

function ParticipantCard({ intake, onClick }: { intake: Intake; onClick: () => void }) {
  const badge = badgeForIntake(intake);
  const subtitle = subtitleForIntake(intake);
  const column = columnIdForStatus(intake.status);
  const accent = column ? STAGE_COLOR[column] : PLUM;
  const waiting = inPipeline(intake.status) ? daysSince(intake.created_at) : null;
  return (
    <button
      onClick={onClick}
      className="group relative w-full rounded-2xl border bg-cc-surface p-4 text-left transition-colors hover:border-[color:var(--cc-brand-purple)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
      style={{ borderColor: BORDER }}
    >
      <div className="flex items-start gap-3">
        <Avatar name={intake.full_name} size={36} color={accent} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: TEXT }}>{intake.full_name}</p>
          <p className="mt-0.5 truncate text-xs" style={{ color: MUTED }}>{subtitle}</p>
        </div>
      </div>
      {(badge || waiting !== null) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {badge && <CardBadge {...badge} />}
          {waiting !== null && (
            <span className="text-xs font-medium" style={{ color: waiting >= 7 ? DANGER : MUTED }}>
              {waiting === 0 ? "Referred today" : `Waiting ${waiting} ${waiting === 1 ? "day" : "days"}`}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

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
              <p className="whitespace-nowrap text-xs font-medium" style={{ color: selected || isCurrent ? TEXT : MUTED }}>{s.label}</p>
            </button>
            {!last && <div className="h-[2px] flex-1 mx-2" style={{ background: i < current ? SUCCESS : BORDER, marginBottom: 20 }} />}
          </div>
        );
      })}
    </div>
  );
}

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

export interface ParticipantSnapshot {
  workerName?: string | null;
  planStart?: string | null;
  planEnd?: string | null;
  totalBudget?: number | string | null;
  usedBudget?: number | string | null;
  planManagement?: string | null;
  activeGoals?: number;
  completedGoals?: number;
}

type ParticipantSort = "name" | "worker" | "planEnd" | "budget";
type ParticipantFocus = "planDue" | "noWorker" | "budget";

const PARTICIPANT_GRID =
  "lg:grid-cols-[minmax(220px,1.6fr)_minmax(140px,1fr)_minmax(130px,1fr)_minmax(150px,1fr)_120px_20px] " +
  "xl:grid-cols-[minmax(220px,1.6fr)_minmax(140px,1fr)_minmax(130px,1fr)_minmax(160px,1fr)_120px_100px_130px_20px]";

const PARTICIPANT_COLUMNS: { label: string; key?: ParticipantSort; className?: string }[] = [
  { label: "Participant", key: "name" },
  { label: "Support worker", key: "worker" },
  { label: "Plan ends", key: "planEnd" },
  { label: "Budget", key: "budget" },
  { label: "Funding", className: "hidden xl:block" },
  { label: "Goals", className: "hidden xl:block" },
  { label: "Status" },
  { label: "" },
];

function toneColor(tone: Tone) {
  if (tone === "good") return "var(--cc-green)";
  if (tone === "info") return "var(--cc-sky)";
  if (tone === "warning") return "var(--cc-amber)";
  if (tone === "danger") return "var(--cc-danger-text)";
  return MUTED;
}

export function ActiveParticipantsPage({
  intakes, onBack, onOpen, onOpenComplaints, loadFailed = false, onRetry, details, detailsLoading = false,
}: {
  intakes: Intake[]; onBack: () => void; onOpen: (id: string) => void; onOpenComplaints: () => void;
  loadFailed?: boolean; onRetry?: () => void;
  details?: Record<string, ParticipantSnapshot>;
  detailsLoading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | ServiceCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [focus, setFocus] = useState<ParticipantFocus | null>(null);
  const [sortKey, setSortKey] = useState<ParticipantSort>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const roster = intakes
    .filter((i) => columnIdForStatus(i.status) === "active")
    .map((intake) => {
      const snapshot = details?.[intake.id];
      const planStart = snapshot?.planStart ?? intake.plan_start_date ?? null;
      const planEnd = snapshot?.planEnd ?? intake.plan_end_date ?? null;
      return {
        intake,
        snapshot,
        plan: planEndStatus(planEnd),
        budget: budgetUsage(snapshot?.totalBudget ?? intake.total_budget, snapshot?.usedBudget, { start: planStart, end: planEnd }),
        funding: planManagementLabel(snapshot?.planManagement),
      };
    });

  const needs = {
    planDue: (r: (typeof roster)[number]) => r.plan.tone === "danger" || r.plan.tone === "warning",
    noWorker: (r: (typeof roster)[number]) => r.snapshot?.workerName === null,
    budget: (r: (typeof roster)[number]) => r.budget.tone === "danger" || r.budget.tone === "warning",
  };
  const focusCounts = {
    planDue: roster.filter(needs.planDue).length,
    noWorker: roster.filter(needs.noWorker).length,
    budget: roster.filter(needs.budget).length,
  };

  const q = search.trim().toLowerCase();
  const dir = sortAsc ? 1 : -1;
  const rows = roster
    .filter(({ intake: i }) => !q || i.full_name.toLowerCase().includes(q) || i.ndis_number.toLowerCase().includes(q))
    .filter(({ intake: i }) => categoryFilter === "all" || i.service_category === categoryFilter)
    .filter(({ intake: i }) => statusFilter === "all" || i.status === statusFilter)
    .filter((r) => !focus || needs[focus](r))
    .sort((a, b) => {
      if (sortKey === "worker") {
        return (a.snapshot?.workerName ?? "").localeCompare(b.snapshot?.workerName ?? "") * dir;
      }
      if (sortKey === "planEnd") {
        const da = a.plan.days ?? Number.MAX_SAFE_INTEGER;
        const db = b.plan.days ?? Number.MAX_SAFE_INTEGER;
        return (da - db) * dir;
      }
      if (sortKey === "budget") return ((a.budget.percent ?? -1) - (b.budget.percent ?? -1)) * dir;
      return a.intake.full_name.localeCompare(b.intake.full_name) * dir;
    });

  const activeTotal = intakes.filter((i) => i.status === "active").length;
  const inactiveTotal = intakes.filter((i) => i.status === "inactive").length;
  const total = activeTotal + inactiveTotal;
  const filtersActive = !!q || categoryFilter !== "all" || statusFilter !== "all" || focus !== null;

  function resetFilters() {
    setSearch("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setFocus(null);
  }

  function handleSort(key: ParticipantSort) {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key !== "budget");
    }
  }

  const pillStyle = (selected: boolean) =>
    selected ? { background: TEXT, color: "var(--cc-bg)" } : { color: TEXT, boxShadow: `inset 0 0 0 1px ${BORDER}` };
  const pillClass =
    "inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum";

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl">
          <button
            onClick={onBack}
            className="-ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-sm font-medium transition-colors hover:bg-cc-soft"
            style={{ color: MUTED }}
          >
            <ArrowLeft size={15} /> Participant onboarding
          </button>
          <h1
            className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight"
            style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}
          >
            Participants
            <SectionInfo text="Everyone onboarded with your organisation, active and inactive." />
          </h1>
          <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>
            The people your organisation supports. Open anyone to see their plan,
            care information and the support they've received.
          </p>
        </div>

        <button
          onClick={onOpenComplaints}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-5 text-sm font-medium transition hover:bg-cc-soft"
          style={{ color: TEXT }}
        >
          <Mail size={16} /> Participant complaints
        </button>
      </header>

      {!loadFailed && total > 0 && (
        <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3">
          {([
            { label: total === 1 ? "participant" : "participants", value: total, color: TEXT, focus: null },
            { label: focusCounts.planDue === 1 ? "plan ending or ended" : "plans ending or ended", value: focusCounts.planDue, color: focusCounts.planDue ? "var(--cc-amber)" : "var(--cc-green)", focus: "planDue" },
            { label: "without a support worker", value: focusCounts.noWorker, color: focusCounts.noWorker ? "var(--cc-amber)" : "var(--cc-green)", focus: "noWorker" },
            { label: "spending ahead of plan", value: focusCounts.budget, color: focusCounts.budget ? "var(--cc-danger-text)" : "var(--cc-green)", focus: "budget" },
          ] as const).map((item, index) => (
            <div key={item.label} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden className="mr-2 hidden h-6 w-px sm:block" style={{ background: BORDER }} />}
              <button
                type="button"
                disabled={detailsLoading && index > 0}
                onClick={() => setFocus(item.focus && item.value > 0 ? item.focus : null)}
                className="flex min-h-11 items-center rounded-full px-3 transition hover:bg-cc-soft disabled:cursor-default"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: item.color }}>
                    {detailsLoading && index > 0 ? "…" : item.value}
                  </span>
                  <span className="text-sm" style={{ color: MUTED }}>{item.label}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search participants" placeholder="Search by name or NDIS number"
            className="h-11 rounded-full border-cc-border bg-cc-surface pl-11 pr-11 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-cc-plum"
          />
          {search && (
            <button aria-label="Clear participant search" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-cc-soft">
              <X size={14} style={{ color: MUTED }} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:ml-auto">
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as "all" | ServiceCategory)}>
            <SelectTrigger aria-label="Service category" className="h-11 w-full rounded-full border-cc-border bg-cc-surface px-4 text-sm shadow-none sm:w-[180px]" style={{ color: TEXT }}>
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="disability">Disability</SelectItem>
              <SelectItem value="aged_care">Aged Care</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex h-11 min-w-0 items-center rounded-full border bg-cc-surface pl-4 focus-within:ring-2 focus-within:ring-cc-plum lg:hidden" style={{ borderColor: BORDER }}>
            <select
              aria-label="Sort participants"
              value={sortKey}
              onChange={(e) => { const key = e.target.value as ParticipantSort; setSortKey(key); setSortAsc(key !== "budget"); }}
              className="h-full min-w-0 flex-1 bg-transparent pr-1 text-sm outline-none"
              style={{ color: TEXT }}
            >
              <option value="name">Sort by name</option>
              <option value="worker">Sort by support worker</option>
              <option value="planEnd">Sort by plan end</option>
              <option value="budget">Sort by budget used</option>
            </select>
            <button type="button" onClick={() => setSortAsc((v) => !v)} aria-label={sortAsc ? "Sort descending" : "Sort ascending"} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-cc-soft" style={{ color: TEXT }}>
              {sortAsc ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter participants">
        {([["all", "Everyone", total], ["active", "Active", activeTotal], ["inactive", "Inactive", inactiveTotal]] as const).map(([value, label, count]) => (
          <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)} className={pillClass} style={pillStyle(statusFilter === value)}>
            {label}
            <span className="tabular-nums" style={{ opacity: 0.7 }}>{count}</span>
          </button>
        ))}
        {!detailsLoading && ([["planDue", "Plan review due", focusCounts.planDue], ["noWorker", "No support worker", focusCounts.noWorker], ["budget", "Budget ahead of plan", focusCounts.budget]] as const)
          .filter(([, , count]) => count > 0)
          .map(([value, label, count]) => (
            <button key={value} type="button" aria-pressed={focus === value} onClick={() => setFocus(focus === value ? null : value)} className={pillClass} style={pillStyle(focus === value)}>
              {label}
              <span className="tabular-nums" style={{ opacity: 0.7 }}>{count}</span>
            </button>
          ))}
        {filtersActive && (
          <button type="button" onClick={resetFilters} className="min-h-10 px-3 text-sm font-medium underline-offset-4 hover:underline" style={{ color: PLUM }}>
            Clear
          </button>
        )}
      </div>

      <p role="status" className={`text-sm ${loadFailed ? "hidden" : ""}`} style={{ color: MUTED }}>
        {rows.length === total
          ? `${total} ${total === 1 ? "person" : "people"} supported by your organisation`
          : `Showing ${rows.length} of ${total} participants`}
      </p>

      {loadFailed ? (
        <div role="alert" className="rounded-3xl bg-cc-surface px-6 py-14 text-center">
          <AlertTriangle size={26} className="mx-auto mb-3" style={{ color: "var(--cc-amber)" }} />
          <h2 className="text-base font-semibold text-cc-text">We couldn't load your participants</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-cc-muted">Check your connection and try again. Nothing has been changed.</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-5 min-h-11 rounded-full border border-cc-border px-5 text-sm font-semibold text-cc-text">Try again</button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl bg-cc-surface px-6 py-14 text-center">
          <Users size={26} className="mx-auto mb-3 text-cc-muted" />
          <h2 className="text-base font-semibold text-cc-text">{total === 0 ? "Your participant directory starts here" : "No one matches that"}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-cc-muted">{total === 0 ? "Complete participant onboarding to bring their details, care records and service status into this directory." : "Try another name or NDIS number, or clear the filters to see everyone."}</p>
          <button type="button" onClick={() => { if (total === 0) onBack(); else resetFilters(); }} className="mt-5 min-h-11 rounded-full border border-cc-border px-5 text-sm font-semibold text-cc-text">{total === 0 ? "Open participant onboarding" : "Clear filters"}</button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl bg-cc-surface">
          <div className={`hidden items-center gap-4 border-b px-6 py-3 lg:grid ${PARTICIPANT_GRID}`} style={{ borderColor: BORDER }}>
            {PARTICIPANT_COLUMNS.map((column) =>
              column.key ? (
                <button
                  key={column.label}
                  type="button"
                  onClick={() => handleSort(column.key!)}
                  aria-label={`Sort by ${column.label.toLowerCase()}`}
                  className={`flex items-center gap-1 text-left text-xs font-medium transition hover:text-cc-text ${column.className ?? ""}`}
                  style={{ color: sortKey === column.key ? TEXT : MUTED }}
                >
                  {column.label}
                  {sortKey === column.key && (sortAsc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </button>
              ) : (
                <span key={column.label || "chevron"} className={`text-xs font-medium ${column.className ?? ""}`} style={{ color: MUTED }}>
                  {column.label}
                </span>
              ),
            )}
          </div>

          <ul>
            {rows.map(({ intake: i, snapshot, plan, budget, funding }) => {
              const inactive = i.status === "inactive";
              const statusColor = inactive ? "var(--cc-amber)" : "var(--cc-green)";
              const activated = formatDate(i.activated_at);
              const workerKnown = snapshot && snapshot.workerName !== undefined;
              const goalsText = snapshot?.activeGoals !== undefined
                ? `${snapshot.activeGoals} active${snapshot.completedGoals ? ` · ${snapshot.completedGoals} done` : ""}`
                : null;
              const pending = <span className="block h-3 w-20 animate-pulse rounded-full" style={{ background: SOFT }} />;

              return (
                <li key={i.id} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
                  <button
                    type="button"
                    onClick={() => onOpen(i.id)}
                    className={`group flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum sm:px-6 lg:grid ${PARTICIPANT_GRID}`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style={{ background: SOFT, color: TEXT }}>
                        {initials(i.full_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold" style={{ color: TEXT }}>{i.full_name}</p>
                        <p className="mt-0.5 truncate text-sm" style={{ color: MUTED }}>
                          {i.service_category === "aged_care" ? "Aged Care" : "Disability"}
                          {i.ndis_number ? ` · NDIS ${i.ndis_number}` : ""}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs lg:hidden" style={{ color: MUTED }}>
                          <span className="flex items-center gap-1.5 font-medium" style={{ color: statusColor }}>
                            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor }} />
                            {inactive ? "Inactive" : "Active"}
                          </span>
                          {workerKnown && (
                            <span style={{ color: snapshot!.workerName ? MUTED : "var(--cc-amber)" }} className={snapshot!.workerName ? "" : "font-medium"}>
                              {snapshot!.workerName ? `Worker: ${snapshot!.workerName}` : "No support worker"}
                            </span>
                          )}
                          {plan.days !== null && (
                            <span className={plan.tone === "neutral" ? "" : "font-medium"} style={{ color: plan.tone === "neutral" ? MUTED : toneColor(plan.tone) }}>
                              Plan: {plan.detail.toLowerCase()}
                            </span>
                          )}
                          {budget.percent !== null && (
                            <span className={budget.tone === "good" ? "" : "font-medium"} style={{ color: budget.tone === "good" ? MUTED : toneColor(budget.tone) }}>
                              Budget {budget.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="hidden min-w-0 lg:block">
                      {detailsLoading && !workerKnown ? pending : snapshot?.workerName ? (
                        <p className="truncate text-sm" style={{ color: TEXT }}>{snapshot.workerName}</p>
                      ) : snapshot?.workerName === null ? (
                        <p className="text-sm font-medium" style={{ color: "var(--cc-amber)" }}>Not assigned</p>
                      ) : (
                        <p className="text-sm" style={{ color: MUTED }}>N/A</p>
                      )}
                    </div>

                    <div className="hidden min-w-0 lg:block">
                      {detailsLoading && !snapshot ? pending : (
                        <>
                          <p className="truncate text-sm" style={{ color: plan.days === null ? MUTED : TEXT }}>{plan.label}</p>
                          {plan.days !== null && (
                            <p className={`mt-0.5 truncate text-xs ${plan.tone === "neutral" ? "" : "font-medium"}`} style={{ color: toneColor(plan.tone) }}>
                              {plan.detail}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <div className="hidden min-w-0 lg:block">
                      {detailsLoading && !snapshot ? pending : budget.percent === null ? (
                        <p className="text-sm" style={{ color: MUTED }}>{budget.label}</p>
                      ) : (
                        <>
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold tabular-nums" style={{ color: toneColor(budget.tone) }}>{budget.label}</p>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: SOFT }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(budget.percent, 100)}%`, background: toneColor(budget.tone) }} />
                          </div>
                          <p className="mt-1 truncate text-xs" style={{ color: MUTED }}>{budget.detail}</p>
                        </>
                      )}
                    </div>

                    <p className="hidden truncate text-sm xl:block" style={{ color: funding ? TEXT : MUTED }}>
                      {detailsLoading && !snapshot ? pending : funding ?? "Not set"}
                    </p>

                    <p className="hidden truncate text-sm xl:block" style={{ color: goalsText ? TEXT : MUTED }}>
                      {detailsLoading && !snapshot ? pending : goalsText ?? "N/A"}
                    </p>

                    <div className="hidden min-w-0 lg:block">
                      <p className="flex items-center gap-2 text-sm font-medium" style={{ color: statusColor }}>
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor }} />
                        {inactive ? "Inactive" : "Active"}
                      </p>
                      {activated && (
                        <p className="mt-0.5 truncate pl-4 text-xs" style={{ color: MUTED }}>Since {activated}</p>
                      )}
                    </div>

                    <ChevronRight size={18} className="shrink-0 justify-self-end transition group-hover:translate-x-0.5" style={{ color: MUTED }} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActiveParticipantsRoute(props: {
  intakes: Intake[]; onBack: () => void; onOpen: (id: string) => void; onOpenComplaints: () => void;
  loadFailed?: boolean; onRetry?: () => void;
}) {
  const participantsQuery = useGetParticipants();
  const workerStatsQuery = useOrgQuery<WorkerStats[]>(WORKER_STATS_KEY, { queryFn: getCoordinatorWorkerStats });
  const assignmentsQuery = useOrgQuery(["worker-assignments", "org"], { queryFn: getOrgAssignments });

  const details = useMemo(() => {
    const participants = (participantsQuery.data ?? []) as Array<Record<string, any>>;
    if (participants.length === 0) return undefined;
    const byId = new Map(participants.map((p) => [String(p.id), p]));
    const byNdis = new Map(participants.filter((p) => p.ndis_number).map((p) => [String(p.ndis_number), p]));
    const workerNames = new Map((workerStatsQuery.data ?? []).map((w) => [w.id, w.full_name]));
    const workersByParticipant = new Map<string, Set<string>>();
    for (const assignment of assignmentsQuery.data ?? []) {
      if (!SUPPORT_ALLOCATION_ROLES.has(assignment.allocated_role)) continue;
      const set = workersByParticipant.get(assignment.patient_id) ?? new Set<string>();
      set.add(assignment.user_id);
      workersByParticipant.set(assignment.patient_id, set);
    }
    const namesLoading = workerStatsQuery.isLoading || assignmentsQuery.isLoading;

    const out: Record<string, ParticipantSnapshot> = {};
    for (const intake of props.intakes) {
      const record = (intake.participant_id && byId.get(intake.participant_id)) || (intake.ndis_number && byNdis.get(intake.ndis_number));
      if (!record) continue;
      const workerIds = new Set(workersByParticipant.get(String(record.id)) ?? []);
      if (record.assigned_worker_id) workerIds.add(String(record.assigned_worker_id));
      const names = [...workerIds].map((id) => workerNames.get(id) ?? "Assigned").sort();
      const workerName = names.length === 0
        ? (namesLoading ? undefined : null)
        : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
      const goals = Array.isArray(record.goals) ? (record.goals as Array<{ status?: string }>) : [];
      out[intake.id] = {
        workerName,
        planStart: record.plan_start_date ?? null,
        planEnd: record.plan_end_date ?? null,
        totalBudget: record.total_budget ?? null,
        usedBudget: record.total_used ?? null,
        planManagement: record.plan_management_type ?? null,
        activeGoals: goals.filter((g) => (g.status ?? "active") === "active").length,
        completedGoals: goals.filter((g) => g.status === "completed").length,
      };
    }
    return out;
  }, [participantsQuery.data, workerStatsQuery.data, workerStatsQuery.isLoading, assignmentsQuery.data, assignmentsQuery.isLoading, props.intakes]);

  return (
    <ActiveParticipantsPage
      {...props}
      details={details}
      detailsLoading={participantsQuery.isLoading || assignmentsQuery.isLoading}
    />
  );
}

const COMPLAINT_STATUS_META: Record<ComplaintStatus, { label: string }> = {
  open: { label: "Open" },
  in_review: { label: "In review" },
  resolved: { label: "Resolved" },
};

const COMPLAINT_TONE: Record<ComplaintStatus, KitTone> = {
  open: "danger",
  in_review: "warning",
  resolved: "good",
};

function ComplaintsPage({ onBack, participants }: { onBack: () => void; participants: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const complaintsQuery = useOrgQuery(PARTICIPANT_COMPLAINTS_KEY, { queryFn: listParticipantComplaints, retry: false });
  const allComplaints = complaintsQuery.data ?? [];
  const [statusFilter, setStatusFilter] = useState<"all" | ComplaintStatus>("all");
  const [responding, setResponding] = useState<ParticipantComplaint | null>(null);
  const [saving, setSaving] = useState(false);
  const [logging, setLogging] = useState(false);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [user?.organizationId ?? "__no_org__", ...PARTICIPANT_COMPLAINTS_KEY] });
  }

  const complaints = allComplaints
    .filter((c) => statusFilter === "all" || c.status === statusFilter)
    .sort((a, b) => b.filed_at.localeCompare(a.filed_at));
  const countOf = (s: ComplaintStatus) => allComplaints.filter((c) => c.status === s).length;

  async function saveResponse(id: string, status: Exclude<ComplaintStatus, "open">, notes: string) {
    setSaving(true);
    try {
      await updateParticipantComplaint(id, status, status === "resolved" ? notes : undefined);
      refresh();
      setResponding(null);
      toast({ title: "Complaint updated", description: `Marked as ${COMPLAINT_STATUS_META[status].label.toLowerCase()}.` });
    } catch (err) {
      toast({ title: "Couldn't update the complaint", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        back={
          <button type="button" onClick={onBack} className={kitGhostClass}>
            <ArrowLeft size={15} /> Back to Participants
          </button>
        }
        eyebrow="Oversight & Risk"
        title={
          <span className="inline-flex items-center gap-2">
            Participant Complaints
            <SectionInfo text="Complaints and feedback logged against a participant, with resolution status and notes." />
          </span>
        }
        description="Complaints raised by or for a participant, how each was handled, and what was done to resolve it."
        actions={
          <button type="button" className={kitCtaClass} onClick={() => setLogging(true)}>
            <Plus size={16} /> Log a complaint
          </button>
        }
      />

      <SummaryStrip
        items={[
          { value: allComplaints.length, label: "complaints", onClick: () => setStatusFilter("all"), active: statusFilter === "all" },
          { value: countOf("open"), label: "open", tone: countOf("open") ? "danger" : "good", onClick: () => setStatusFilter("open"), active: statusFilter === "open" },
          { value: countOf("in_review"), label: "in review", tone: countOf("in_review") ? "warning" : undefined, onClick: () => setStatusFilter("in_review"), active: statusFilter === "in_review" },
          { value: countOf("resolved"), label: "resolved", tone: "good", onClick: () => setStatusFilter("resolved"), active: statusFilter === "resolved" },
        ]}
      />

      {complaintsQuery.isLoading ? (
        <SkeletonBlocks count={3} />
      ) : complaintsQuery.isError ? (
        <LoadError onRetry={() => void complaintsQuery.refetch()}>
          {complaintsQuery.error instanceof Error ? complaintsQuery.error.message : "Couldn't load complaints."}
        </LoadError>
      ) : allComplaints.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No complaints recorded"
          body="When a participant, family member or advocate raises a complaint, log it here so it's tracked through to resolution and filed in the vault."
          action={<button type="button" className={kitOutlineClass} onClick={() => setLogging(true)}><Plus size={14} /> Log a complaint</button>}
        />
      ) : complaints.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No complaints match"
          body="Try another status, or show every complaint."
          action={<button type="button" className={kitOutlineClass} onClick={() => setStatusFilter("all")}>Show all complaints</button>}
        />
      ) : (
        <Surface>
          <RowList>
            {complaints.map((c) => {
              const meta = COMPLAINT_STATUS_META[c.status];
              return (
                <li key={c.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                  <Avatar name={c.participant_name} size={36} color={DANGER} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-semibold" style={{ color: TEXT }}>{c.subject}</p>
                      <StatusText tone={COMPLAINT_TONE[c.status]}>{meta.label}</StatusText>
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                      {c.participant_name}{c.raised_by ? ` · Raised by ${c.raised_by}` : ""} · Filed {formatDate(c.filed_at)}
                    </p>
                    <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>{c.description}</p>
                    {c.resolution_notes && (
                      <p className="mt-2 rounded-xl bg-cc-soft px-3.5 py-2.5 text-sm leading-6" style={{ color: TEXT }}>
                        <span className="font-semibold">Response: </span>
                        {c.resolution_notes}
                        {c.responded_at && <span className="block text-xs" style={{ color: MUTED }}>Updated {formatDate(c.responded_at)}</span>}
                      </p>
                    )}
                  </div>
                  <button type="button" className={`${kitOutlineClass} shrink-0 self-start`} onClick={() => setResponding(c)}>
                    <PenLine size={14} />
                    {c.status === "open" ? "Address complaint" : c.resolution_notes ? "Update response" : "Update status"}
                  </button>
                </li>
              );
            })}
          </RowList>
        </Surface>
      )}

      <ResponseSheet
        target={
          responding && {
            id: responding.id,
            title: responding.subject,
            context: `${responding.participant_name} · Filed ${formatDate(responding.filed_at)}`,
            description: responding.description,
            status: responding.status,
            notes: responding.resolution_notes ?? undefined,
          }
        }
        onClose={() => setResponding(null)}
        noun="complaint"
        notesLabel="What did you do to solve it?"
        notesPlaceholder="e.g. Spoke with the participant's family, reassigned the support worker, and confirmed the schedule going forward."
        onSave={(status, notes) => responding && void saveResponse(responding.id, status, notes)}
        busy={saving}
      />

      <LogComplaintSheet
        open={logging}
        onOpenChange={setLogging}
        participants={participants}
        onLogged={() => {
          refresh();
          setStatusFilter("all");
        }}
      />
    </div>
  );
}

function LogComplaintSheet({
  open,
  onOpenChange,
  participants,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participants: { id: string; name: string }[];
  onLogged: () => void;
}) {
  const { toast } = useToast();
  const OTHER = "__other__";
  const today = new Date().toISOString().slice(0, 10);
  const [participantId, setParticipantId] = useState("");
  const [otherName, setOtherName] = useState("");
  const [raisedBy, setRaisedBy] = useState("");
  const [filedOn, setFiledOn] = useState(today);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParticipantId("");
    setOtherName("");
    setRaisedBy("");
    setFiledOn(new Date().toISOString().slice(0, 10));
    setSubject("");
    setDescription("");
  }, [open]);

  const who = participantId === OTHER ? otherName.trim() : participantId;
  const ready = !!who && !!subject.trim() && !!description.trim();

  async function submit() {
    if (!ready) return;
    setSaving(true);
    try {
      await createParticipantComplaint({
        subject: subject.trim(),
        description: description.trim(),
        participant_id: participantId && participantId !== OTHER ? participantId : null,
        participant_name: participantId === OTHER ? otherName.trim() : null,
        raised_by: raisedBy.trim() || null,
        filed_at: filedOn ? new Date(`${filedOn}T12:00:00`).toISOString() : null,
      });
      toast({ title: "Complaint logged", description: "It's on the register and filed in the vault." });
      onOpenChange(false);
      onLogged();
    } catch (err) {
      toast({ title: "Couldn't log the complaint", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const label = "block text-sm font-medium text-cc-text";
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Log a complaint</SheetTitle>
        </SheetHeader>
        <form id="log-complaint-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mt-4 flex-1 space-y-4">
          <div className="space-y-1.5">
            <label className={label} htmlFor="complaint-participant">Who is it about?</label>
            <Select value={participantId} onValueChange={setParticipantId}>
              <SelectTrigger id="complaint-participant" className="h-11 rounded-xl">
                <SelectValue placeholder="Choose a participant" />
              </SelectTrigger>
              <SelectContent>
                {participants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                <SelectItem value={OTHER}>Someone not in the list</SelectItem>
              </SelectContent>
            </Select>
            {participantId === OTHER && (
              <Input aria-label="Their name" placeholder="Their name" value={otherName} onChange={(e) => setOtherName(e.target.value)} className="mt-2 h-11 rounded-xl" />
            )}
          </div>
          <div className="space-y-1.5">
            <label className={label} htmlFor="complaint-raised-by">Raised by <span className="font-normal text-cc-muted">Optional</span></label>
            <Input id="complaint-raised-by" placeholder="e.g. Participant, or Mother (Jane Rivera)" value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <label className={label} htmlFor="complaint-date">Date received</label>
            <Input id="complaint-date" type="date" value={filedOn} max={today} onChange={(e) => setFiledOn(e.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <label className={label} htmlFor="complaint-subject">What is it about?</label>
            <Input id="complaint-subject" placeholder="e.g. Support worker punctuality" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-11 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <label className={label} htmlFor="complaint-description">Details</label>
            <Textarea id="complaint-description" rows={5} placeholder="What happened, in the words of the person who raised it." value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" />
          </div>
        </form>
        <SheetFooter className="mt-4 gap-2">
          <button type="button" className={kitOutlineClass} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="log-complaint-form" className={kitCtaClass} disabled={!ready || saving}>
            {saving && <Loader2 size={15} className="animate-spin" />} Log complaint
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

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
        <div className="space-y-4">
          <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <Avatar name={intake.full_name} size={48} color={intake.status === "inactive" ? WARNING : STAGE_COLOR.active} />
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
              {intake.participant_id && (
                <div className="pt-3 border-t" style={{ borderColor: BORDER }}>
                  <ParticipantServiceAgreementSection participantId={intake.participant_id} />
                </div>
              )}
            </IntakeFormSection>
          )}

          {intake.participant_id && <ParticipantRecordCards participantId={intake.participant_id} />}
        </div>
      </div>
    </div>
  );
}

export default function ParticipantOnboardingBoard() {
  const { translate } = useAccessibility();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const urlSearch = useSearch();
  const selectedId = new URLSearchParams(urlSearch).get("intake");
  const profileId = new URLSearchParams(urlSearch).get("profile");

  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [loadingIntakes, setLoadingIntakes] = useState(true);
  const [intakesLoadFailed, setIntakesLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingIntakes(true);
    listParticipantIntakes()
      .then((rows) => { if (!cancelled) { setIntakes(rows); setIntakesLoadFailed(false); } })
      .catch((err: Error) => {
        if (cancelled) return;
        setIntakesLoadFailed(true);
        toast({ title: "Couldn't load participants", description: err.message, variant: "destructive" });
      })
      .finally(() => { if (!cancelled) setLoadingIntakes(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const referralPath = `/participant-referral?org=${encodeURIComponent(user?.organizationId ?? "")}`;
  async function copyReferralLink() {
    const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${referralPath}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Referral link copied", description: "Share it with families, coordinators and other referrers." });
    } catch {
      toast({ title: "Couldn't copy the link", description: url });
    }
  }

  const [search, setSearch] = useState("");
  const [newIntakeOpen, setNewIntakeOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
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
  // What's still missing before an enquiry can be logged, in plain words.
  const referralMissing = [
    !fullName.trim() && "full name",
    !dob.trim() && "date of birth",
    !ndisNumber.trim() && "NDIS number",
    !isValidEmail(email) && (email.trim() ? "a valid email" : "email"),
  ].filter(Boolean) as string[];
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

  function reloadIntakes() {
    listParticipantIntakes()
      .then(setIntakes)
      .catch((err: Error) => toast({ title: "Couldn't refresh", description: err.message, variant: "destructive" }));
  }

  function applyLocalPatch(id: string, patch: Partial<Intake>) {
    setIntakes((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  const selected = selectedId ? intakes.find((i) => i.id === selectedId) ?? null : null;
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
        onReload={reloadIntakes}
        currentCaseload={currentCaseload}
        totalCapacity={totalCapacity}
      />
    );
  }

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

  if (location === "/onboard-participant/complaints") {
    return (
      <ComplaintsPage
        onBack={() => navigate("/onboard-participant/active")}
        participants={intakes
          .filter((i) => i.participant_id)
          .map((i) => ({ id: i.participant_id!, name: i.full_name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
      />
    );
  }

  if (location === "/onboard-participant/active") {
    return (
      <ActiveParticipantsRoute
        intakes={intakes}
        onBack={() => navigate("/onboard-participant")}
        onOpen={(id) => navigate(`/onboard-participant?profile=${id}`)}
        onOpenComplaints={() => navigate("/onboard-participant/complaints")}
        loadFailed={intakesLoadFailed}
        onRetry={() => setLoadAttempt((n) => n + 1)}
      />
    );
  }

  const q = search.trim().toLowerCase();
  const matchesSearch = (i: Intake) => !q || i.full_name.toLowerCase().includes(q) || i.ndis_number.toLowerCase().includes(q);
  const matchesKpi = (i: Intake) => {
    if (activeKpi === "open") return inPipeline(i.status);
    if (activeKpi === "stuck") return inPipeline(i.status) && daysSince(i.created_at) >= 7;
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

  const openEnquiries = intakes.filter((i) => inPipeline(i.status)).length;
  const stuckCount = intakes.filter((i) => inPipeline(i.status) && daysSince(i.created_at) >= 7).length;
  // Declined and withdrawn referrals: off the board, but still findable.
  const closedIntakes = intakes
    .filter((i) => i.status === "declined" || i.status === "withdrawn")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
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
        color: STAGE_COLOR[columnId],
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
      <div className="space-y-6 pb-12">
        <PageHeader
          back={
            <button type="button" onClick={() => navigate("/hub")} className={`${kitGhostClass} -ml-4`}>
              <ArrowLeft size={15} /> Back to Hub
            </button>
          }
          eyebrow="Participants & Intake"
          title={
            <span className="inline-flex items-center gap-2">
              Participant Onboarding
              <SectionInfo text="Manage participants from initial referral through to plan activation, service agreements, and care coordination." />
            </span>
          }
          description="Move a new participant from referral through to an active plan: intake, consent, meet & greet, and setup."
          actions={
            <>
              <button
                onClick={copyReferralLink}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-5 text-sm font-medium transition hover:bg-cc-soft"
                style={{ color: TEXT }}
              >
                Copy referral link
              </button>
              <button type="button" className={kitCtaClass} onClick={() => setNewIntakeOpen(true)}>
                <HeartHandshake size={15} /> New referral
              </button>
            </>
          }
        />

        <SummaryStrip
          items={[
            { value: openEnquiries, label: "open enquiries", tone: openEnquiries ? "warning" : "good", onClick: () => setKpiFilter("open"), active: activeKpi === "open" },
            { value: stuckCount, label: "stuck 7+ days", tone: stuckCount ? "danger" : "good", onClick: () => setKpiFilter("stuck"), active: activeKpi === "stuck" },
            { value: activeCount, label: "active participants", tone: "good", onClick: () => setKpiFilter("active"), active: activeKpi === "active" },
            { value: readyForSignatureCount, label: "ready for signature", tone: "info", onClick: () => setKpiFilter("signature"), active: activeKpi === "signature" },
            ...(closedIntakes.length
              ? [{
                  value: closedIntakes.length,
                  label: "closed",
                  onClick: () => {
                    setShowClosed(true);
                    window.setTimeout(() => document.getElementById("closed-referrals")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  },
                  active: showClosed,
                }]
              : []),
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search participants"
              className="h-11 rounded-full bg-cc-surface pl-11 pr-9 text-sm"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/5">
                <X size={13} style={{ color: MUTED }} />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:ml-auto">
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as "all" | ServiceCategory)}>
              <SelectTrigger className="h-10 w-full rounded-full bg-cc-surface px-4 text-sm sm:w-[170px]">
                <Users size={14} className="mr-1.5" /><SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="disability">Disability</SelectItem>
                <SelectItem value="aged_care">Aged Care</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as "all" | BoardColumnId)}>
              <SelectTrigger className="h-10 w-full rounded-full bg-cc-surface px-4 text-sm sm:w-[170px]">
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
              <button onClick={() => { setActiveKpi(null); setCategoryFilter("all"); setStageFilter("all"); setSearch(""); }} className={`${kitGhostClass} min-h-10 shrink-0`}>
                <X size={14} /> Clear
              </button>
            )}
            <div className="flex shrink-0 items-center rounded-full border p-1" style={{ borderColor: BORDER }} role="group" aria-label="View">
              <button
                onClick={() => setView("kanban")}
                aria-pressed={view === "kanban"}
                title="Board view"
                className="flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition"
                style={view === "kanban" ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { color: MUTED }}
              >
                <LayoutGrid size={15} /> Board
              </button>
              <button
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                title="List view"
                className="flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition"
                style={view === "list" ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { color: MUTED }}
              >
                <Rows3 size={15} /> List
              </button>
            </div>
          </div>
        </div>

        {view === "kanban" && (
          <p className="text-xs lg:hidden" style={{ color: MUTED }}>Swipe sideways to see every stage.</p>
        )}
        {view === "kanban" ? (
          <div className="flex items-start gap-3 overflow-x-auto pb-3 [scrollbar-width:thin] snap-x snap-mandatory lg:items-stretch">
            {BOARD_COLUMNS.map((col) => {
              const columnIntakes = intakes.filter((i) => columnIdForStatus(i.status) === col.id && matches(i));
              const color = STAGE_COLOR[col.id];
              return (
                <div
                  key={col.id}
                  className="flex min-h-[220px] w-[300px] shrink-0 scale-100 flex-col gap-3 rounded-2xl p-4 transition-all duration-150 lg:min-h-[430px] lg:w-auto lg:min-w-[200px] lg:flex-1 lg:shrink"
                  style={{ background: "var(--cc-bg)" }}
                >
                  <div className="flex items-center justify-between px-0.5 pb-0.5">
                    {col.id === "active" ? (
                      <button
                        onClick={() => navigate("/onboard-participant/active")}
                        className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-70"
                        title="View full Participants list"
                      >
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                        <p className="text-sm font-semibold underline decoration-dotted underline-offset-2" style={{ color: TEXT }}>{col.label}</p>
                        <ChevronRight size={12} style={{ color }} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                        <p className="text-sm font-semibold" style={{ color: TEXT }}>{col.label}</p>
                      </div>
                    )}
                    <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[10px] font-black" style={{ background: `${color}1F`, color }}>
                      {columnIntakes.length}
                    </span>
                  </div>
                  <div className="flex min-h-[120px] flex-1 flex-col gap-2.5">
                    {columnIntakes.length === 0 && (
                      <p className="rounded-xl border border-dashed py-8 text-center text-xs" style={{ color: MUTED, borderColor: BORDER }}>Nobody here</p>
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

        {closedIntakes.length > 0 && (
          <section id="closed-referrals" className="scroll-mt-24 rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              aria-expanded={showClosed}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span>
                <span className="block text-sm font-semibold" style={{ color: TEXT }}>Closed referrals</span>
                <span className="block text-xs" style={{ color: MUTED }}>
                  {closedIntakes.length} declined or withdrawn. Kept for your records, off the board.
                </span>
              </span>
              <ChevronDown size={18} className={`shrink-0 transition-transform ${showClosed ? "rotate-180" : ""}`} style={{ color: MUTED }} />
            </button>
            {showClosed && (
              <ul className="border-t" style={{ borderColor: BORDER }}>
                {closedIntakes.map((i) => (
                  <li key={i.id} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
                    <button
                      type="button"
                      onClick={() => navigate(`/onboard-participant?intake=${i.id}`)}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-cc-soft"
                    >
                      <Avatar name={i.full_name} size={32} color={MUTED} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{i.full_name}</span>
                        <span className="block truncate text-xs" style={{ color: MUTED }}>
                          {STATUS_META[i.status].label} · {(i.status === "withdrawn" ? i.withdrawn_reason : i.decline_reason) || "No reason recorded"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs" style={{ color: MUTED }}>Referred {formatDate(i.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <Sheet open={newIntakeOpen} onOpenChange={setNewIntakeOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <HeartHandshake size={18} style={{ color: PLUM }} /> New referral
            </SheetTitle>
            <p className="text-sm" style={{ color: MUTED }}>
              Log an enquiry to start onboarding. Fields marked <span style={{ color: DANGER }}>*</span> are needed.
            </p>
          </SheetHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: TEXT }}>Full name <span aria-hidden="true" style={{ color: DANGER }}>*</span></label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Sam Rivera" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: TEXT }}>Service category</label>
                <Select value={serviceCategory} onValueChange={(v) => setServiceCategory(v as ServiceCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disability">Disability</SelectItem>
                    <SelectItem value="aged_care">Aged Care</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: TEXT }}>Date of birth <span aria-hidden="true" style={{ color: DANGER }}>*</span></label>
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
                  ? `Aged Care is only available to participants aged 65 and over${dobAge !== null ? `. This person is ${dobAge}.` : "."}`
                  : "Aged Care is only available to participants aged 65 and over, so the date of birth confirms eligibility."}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: TEXT }}>NDIS number <span aria-hidden="true" style={{ color: DANGER }}>*</span></label>
                <Input value={ndisNumber} onChange={(e) => setNdisNumber(e.target.value)} placeholder="e.g. 430123456" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: TEXT }}>Funding type</label>
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
              <label className="text-sm font-medium" style={{ color: TEXT }}>Email <span aria-hidden="true" style={{ color: DANGER }}>*</span></label>
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
                <label className="text-sm font-medium" style={{ color: TEXT }}>Phone <span className="font-normal" style={{ color: MUTED }}>(optional)</span></label>
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
                <label className="text-sm font-medium" style={{ color: TEXT }}>How did they reach you?</label>
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
          {referralMissing.length > 0 && (
            <p className="pb-2 text-xs" style={{ color: MUTED }}>Still needed: {referralMissing.join(", ")}.</p>
          )}
          <SheetFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setNewIntakeOpen(false)}>Cancel</Button>
            <Button
              variant="navy"
              className="rounded-full"
              onClick={createIntake}
              disabled={creatingIntake || referralMissing.length > 0 || (phone.trim().length > 0 && !isValidPhone(phone)) || agedCareBlocked}
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

  const { branches } = useBranches();
  const providerServiceStates = [...new Set(branches.map((b) => b.state))];

  const ageOk = intake.service_category !== "aged_care" || isAgedCareEligible(wi?.date_of_birth);
  const locationKnown = !!wi?.state;
  const locationOk = locationKnown ? providerServiceStates.includes(wi!.state!.trim().toUpperCase()) : null;
  const language = wi?.preferred_language?.trim();
  const languageAutoOk = !language || PROVIDER_LANGUAGES.some((l) => l.toLowerCase() === language.toLowerCase());

  const capacityRemaining = totalCapacity - currentCaseload;
  const hasCapacity = capacityRemaining > 0;

  const fundingType = wi?.funding_type;
  const fundingTypeOk = fundingType === "ndia_managed" ? PROVIDER_ACCEPTS_NDIA_MANAGED : true;
  const planStatus = wi?.plan_status?.trim();
  const fundingAvailable = planStatus ? planStatus.toLowerCase().includes("active") : null;

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
  intake, onBack, onUpdate, onLocalUpdate, onReload, currentCaseload, totalCapacity,
}: {
  intake: Intake;
  onBack: () => void;
  onUpdate: (patch: Partial<Intake>) => Promise<Intake>;
  onLocalUpdate: (patch: Partial<Intake>) => void;
  onReload: () => void;
  currentCaseload: number;
  totalCapacity: number;
}) {
  const { toast } = useToast();
  const [declineReason, setDeclineReason] = useState("");
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState("");
  const [notes, setNotes] = useState(intake.meet_greet_notes ?? "");
  const [activating, setActivating] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const [reviewingLine, setReviewingLine] = useState<string | null>(null);
  const openSummaryLines = (intake.meet_greet_summary?.uncovered ?? []).filter((u) => u.status === "open").length;

  async function summarise() {
    setSummarising(true);
    try {
      onLocalUpdate({ meet_greet_summary: await summariseMeetGreet(intake.id) });
    } catch (err) {
      toast({ title: "Couldn't summarise the conversation", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSummarising(false);
    }
  }

  async function reviewLine(lineId: string, action: "include" | "dismiss") {
    setReviewingLine(lineId);
    try {
      onLocalUpdate({ meet_greet_summary: await reviewMeetGreetLine(intake.id, lineId, action) });
    } catch (err) {
      toast({ title: "Couldn't save that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setReviewingLine(null);
    }
  }
  const [invitePortal, setInvitePortal] = useState(Boolean(intake.email));
  const [portalIdentityMethod, setPortalIdentityMethod] = useState<PortalIdentityMethod>("participant_dob");
  const [portalGrant, setPortalGrant] = useState<GrantResult | null>(null);
  const [boardSubtitle, setBoardSubtitle] = useState(intake.board_subtitle ?? "");

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

  const [viewedStep, setViewedStep] = useState(() => stepIndexForStatus(intake.status));
  useEffect(() => {
    setViewedStep(stepIndexForStatus(intake.status));
  }, [intake.status]);

  const { user } = useAuth();

  function saveEnquiryDraft() {
    onUpdate({ decline_reason: declineReason.trim() || undefined });
    toast({ title: "Draft saved" });
  }

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

  function terminate() {
    if (!terminateReason.trim()) return;
    onUpdate({ status: "withdrawn", withdrawn_reason: terminateReason.trim() });
    setTerminateOpen(false);
    toast({ title: "Referral closed", description: `${intake.full_name} chose not to continue. You'll find them under Closed referrals.` });
  }

  function saveMeetGreetDraft() {
    onUpdate({ meet_greet_notes: notes.trim() });
    toast({ title: "Draft saved" });
  }

  function saveMeetGreetAndContinue() {
    onUpdate({ meet_greet_notes: notes.trim(), status: "awaiting_signatures" });
    toast({ title: "Moved to Service Agreement", description: "Build the agreement with its supports and have it signed." });
  }

  async function activate() {
    setActivating(true);
    let updated: Intake;
    try {
      updated = await onUpdate({ status: "active" });
      toast({ title: "Participant activated", description: `${intake.full_name} now appears on the Coordinator's dashboard.` });
    } catch {
      setActivating(false);
      return;
    }
    if (invitePortal && intake.email && updated.participant_id) {
      try {
        setPortalGrant(
          await grantPortalAccess(updated.participant_id, {
            full_name: intake.full_name,
            email: intake.email,
            relationship: "self",
            identity_method: portalIdentityMethod,
          }),
        );
      } catch (err) {
        toast({
          title: "Activated, but the portal invite wasn't sent",
          description: `${(err as Error).message} You can send it from Portal access.`,
          variant: "destructive",
        });
      }
    }
    setActivating(false);
  }

  return (
    <div className="space-y-5 pb-10">
      <button type="button" onClick={onBack} className={`${kitGhostClass} -ml-3`}>
        <ArrowLeft size={15} /> Participant onboarding
      </button>

      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={intake.full_name} size={52} color={STATUS_META[intake.status].color} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
            {intake.full_name}
          </h1>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>
            <span className="font-medium" style={{ color: STATUS_META[intake.status].color }}>{STATUS_META[intake.status].label}</span>
            {" · "}Referred {formatDate(intake.created_at)} via {sourceMeta(intake.source).label.toLowerCase()}
            {inPipeline(intake.status) && (() => {
              const days = daysSince(intake.created_at);
              return <span style={{ color: days >= 7 ? DANGER : MUTED }}>{" · "}{days === 0 ? "Started today" : `${days} ${days === 1 ? "day" : "days"} in onboarding`}</span>;
            })()}
          </p>
        </div>
      </header>

      {intake.status !== "declined" && intake.status !== "withdrawn" && (
        <div className="rounded-2xl border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
          <HorizontalStepper status={intake.status} viewedStep={viewedStep} onSelect={setViewedStep} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        <div className="space-y-5 min-w-0">
          {intake.status === "declined" || intake.status === "withdrawn" ? (
            <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                <XCircle size={16} style={{ color: STATUS_META[intake.status].color }} />
                <p className="text-base font-semibold" style={{ color: TEXT }}>
                  {intake.status === "withdrawn" ? "They chose not to continue" : "Referral declined"}
                </p>
              </div>
              <div className="space-y-1 p-5">
                <p className="text-sm font-medium" style={{ color: MUTED }}>Reason recorded</p>
                <p className="text-sm" style={{ color: TEXT }}>
                  {(intake.status === "withdrawn" ? intake.withdrawn_reason : intake.decline_reason) || "No reason was recorded."}
                </p>
                <p className="pt-3 text-xs" style={{ color: MUTED }}>
                  This referral is closed and kept for your records. Start a new referral if they get back in touch.
                </p>
              </div>
            </div>
          ) : (
            <>
              {viewedStep === 0 && (
                <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <Mail size={16} style={{ color: PLUM }} />
                    <p className="text-base font-semibold" style={{ color: TEXT }}>Enquiry</p>
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
                          Logged via {sourceMeta(intake.source).label.toLowerCase()}. Start screening when you're ready to review this enquiry.
                        </p>
                        <div className="pt-2 space-y-1.5">
                          <label className="text-sm font-medium" style={{ color: TEXT }}>Not a fit? Say why, then decline</label>
                          <div className="flex gap-2">
                            <Input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. Outside our service area" />
                            <Button variant="outline" className="shrink-0 gap-2 rounded-full" style={{ color: DANGER }} onClick={decline} disabled={!declineReason.trim()}>
                              <XCircle size={14} /> Decline
                            </Button>
                          </div>
                        </div>
                        <div className="flex justify-between gap-2 pt-1">
                          <Button variant="outline" className="gap-2 rounded-full" onClick={onBack}>
                            <ArrowLeft size={14} /> Back
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="outline" className="rounded-full" onClick={saveEnquiryDraft}>
                              Save draft
                            </Button>
                            <Button variant="navy" className="gap-2 rounded-full" onClick={startScreening}>
                              Next <ClipboardCheck size={14} />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                        <CheckCircle2 size={16} style={{ color: SUCCESS }} className="shrink-0" />
                        <p className="text-xs font-bold" style={{ color: SUCCESS }}>
                          Logged via {sourceMeta(intake.source).label.toLowerCase()}. Passed to screening.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {viewedStep === 1 && (
                <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <ClipboardCheck size={16} style={{ color: PLUM }} />
                    <p className="text-base font-semibold" style={{ color: TEXT }}>Screening</p>
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
                          <label className="text-sm font-medium" style={{ color: TEXT }}>Not a fit? Say why, then decline</label>
                          <div className="flex gap-2">
                            <Input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. Outside our service area" />
                            <Button variant="outline" className="shrink-0 gap-2 rounded-full" style={{ color: DANGER }} onClick={decline} disabled={!declineReason.trim()}>
                              <XCircle size={14} /> Decline
                            </Button>
                          </div>
                        </div>
                        <div className="flex justify-between gap-2 pt-1">
                          <Button variant="outline" className="gap-2 rounded-full" onClick={goBack}>
                            <ArrowLeft size={14} /> Back
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="outline" className="rounded-full" onClick={saveScreeningDraft}>
                              Save draft
                            </Button>
                            <Button variant="navy" className="gap-2 rounded-full" onClick={accept}>
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

              {viewedStep === 2 && (
                <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER}}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <Mic size={16} style={{ color: PLUM }} />
                    <p className="text-base font-semibold" style={{ color: TEXT }}>Meet &amp; Greet</p>
                  </div>
                  <div className="p-5 space-y-3">
                    <MeetGreetCapture
                      intake={intake}
                      notes={notes}
                      onNotesChange={setNotes}
                      onSaveNotes={(value) => onUpdate({ meet_greet_notes: value.trim() })}
                      onRecordingSaved={onLocalUpdate}
                      coordinatorName={user?.full_name}
                      editable={intake.status === "meet_greet"}
                    />
                    <MeetGreetSummaryPanel
                      summary={intake.meet_greet_summary}
                      editable={intake.status === "meet_greet"}
                      summarising={summarising}
                      reviewingId={reviewingLine}
                      onSummarise={() => void summarise()}
                      onReview={(lineId, action) => void reviewLine(lineId, action)}
                    />
                    {intake.status === "meet_greet" && (
                      <div className="flex justify-between gap-2">
                        <Button variant="outline" className="gap-2 rounded-full" onClick={goBack}>
                          <ArrowLeft size={14} /> Back
                        </Button>
                        <div className="flex gap-2">
                          <Button variant="outline" className="rounded-full" onClick={saveMeetGreetDraft}>
                            Save draft
                          </Button>
                          <Button
                            variant="navy"
                            className="gap-2 rounded-full"
                            onClick={saveMeetGreetAndContinue}
                            disabled={openSummaryLines > 0}
                            title={openSummaryLines > 0 ? "Include or dismiss everything said that isn't in the summary first" : undefined}
                          >
                            Next <Send size={14} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {viewedStep === 3 && (
                <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <FileSignature size={16} style={{ color: PLUM }} />
                    <p className="text-base font-semibold" style={{ color: TEXT }}>Service Agreement</p>
                  </div>
                  <div className="p-5 space-y-3">
                    {(intake.meet_greet_summary?.supports.length ?? 0) > 0 && (
                      <p className="text-xs" style={{ color: MUTED }}>
                        The {intake.meet_greet_summary!.supports.length} support
                        {intake.meet_greet_summary!.supports.length === 1 ? "" : "s"} asked for at the Meet &amp; Greet
                        {" "}fill in a new agreement. Check each one, and add anything that wasn't said, such as rates.
                      </p>
                    )}
                    <ParticipantServiceAgreementSection
                      intakeId={intake.id}
                      participantName={intake.full_name}
                      participantEmail={intake.email}
                      defaults={agreementDefaults(intake)}
                      onChanged={onReload}
                    />
                    {intake.status === "awaiting_signatures" && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: BORDER }}>
                        <Button variant="outline" className="gap-2 rounded-full" onClick={goBack}>
                          <ArrowLeft size={14} /> Back
                        </Button>
                        <p className="text-xs" style={{ color: MUTED }}>
                          Once the agreement is signed, {intake.full_name.split(" ")[0]} can be made active.
                        </p>
                      </div>
                    )}

                    {intake.status === "signed" && (
                      <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: BORDER }}>
                        <label className="flex items-start gap-2 text-xs" style={{ color: TEXT }}>
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={invitePortal && Boolean(intake.email)}
                            disabled={!intake.email}
                            onChange={(e) => setInvitePortal(e.target.checked)}
                          />
                          <span>
                            {intake.email
                              ? <>Invite {intake.full_name.split(" ")[0]} to the Participants Portal ({intake.email})</>
                              : <>No email on file — portal access can be set up later from Portal access.</>}
                          </span>
                        </label>
                        {invitePortal && intake.email && (
                          <Select value={portalIdentityMethod} onValueChange={(v) => setPortalIdentityMethod(v as PortalIdentityMethod)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {IDENTITY_METHOD_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>Identity check: {o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}

                    {intake.status === "signed" && (
                      <Button variant="navy" className="w-full gap-2 rounded-full" onClick={activate} disabled={activating}>
                        {activating ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Activate participant
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {viewedStep === 4 && (
                <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER }}>
                  <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <ShieldCheck size={16} style={{ color: PLUM }} />
                    <p className="text-base font-semibold" style={{ color: TEXT }}>Profile</p>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                      <Users size={16} style={{ color: SUCCESS }} className="shrink-0" />
                      <p className="text-xs" style={{ color: TEXT }}>
                        {intake.full_name.split(" ")[0]} is active and now appears on the Coordinator's dashboard for scheduling and support planning.
                      </p>
                    </div>

                    {portalGrant && <GrantResultNotice result={portalGrant} onClose={() => setPortalGrant(null)} />}
                    {intake.participant_id && <PortalAccessCard key={portalGrant?.access.id ?? "portal"} participantId={intake.participant_id} />}

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

              {intake.status !== "active" && intake.status !== "inactive" && (
                <div className="rounded-2xl border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
                  {!terminateOpen ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: TEXT }}>Not going ahead?</p>
                        <p className="text-xs" style={{ color: MUTED }}>
                          If {intake.full_name.split(" ")[0]} has decided not to continue, close the referral. It stays in your records.
                        </p>
                      </div>
                      <Button type="button" variant="outline" onClick={() => setTerminateOpen(true)} className="gap-1.5 rounded-full" style={{ color: DANGER }}>
                        <XCircle size={14} /> Close referral
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium" style={{ color: TEXT }} htmlFor="close-referral-reason">
                        Why isn't {intake.full_name.split(" ")[0]} continuing?
                      </label>
                      <Input id="close-referral-reason" autoFocus value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} placeholder="e.g. Chose a different provider" />
                      <p className="text-xs" style={{ color: MUTED }}>This ends onboarding from any stage and moves the referral to Closed.</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="outline" className="rounded-full" onClick={() => { setTerminateOpen(false); setTerminateReason(""); }}>
                          Keep going
                        </Button>
                        <Button className="gap-1.5 rounded-full text-white" style={{ background: DANGER }} onClick={terminate} disabled={!terminateReason.trim()}>
                          <XCircle size={14} /> Close referral
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <h2 className="text-sm font-semibold" style={{ color: TEXT }}>Details</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              {([
                ["NDIS number", intake.ndis_number || "Not recorded"],
                ["Category", intake.service_category === "aged_care" ? "Aged Care" : "Disability"],
                ["Email", intake.email ? <a href={`mailto:${intake.email}`} className="break-all underline-offset-4 hover:underline" style={{ color: TEXT }}>{intake.email}</a> : "Not recorded"],
                ["Phone", intake.phone ? <a href={`tel:${intake.phone.replace(/\s+/g, "")}`} className="underline-offset-4 hover:underline" style={{ color: TEXT }}>{intake.phone}</a> : "Not recorded"],
                ["Came in by", sourceMeta(intake.source).label],
              ] as [string, React.ReactNode][]).map(([term, value]) => (
                <div key={term} className="flex justify-between gap-3">
                  <dt style={{ color: MUTED }}>{term}</dt>
                  <dd className="min-w-0 text-right font-medium" style={{ color: TEXT }}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {intake.status !== "enquiry" && intake.status !== "declined" && intake.status !== "withdrawn" && intake.status !== "active" && (
            <div className="rounded-2xl border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
              <label className="mb-2 block text-sm font-semibold" style={{ color: TEXT }}>Note on the board card</label>
              <Input
                value={boardSubtitle}
                onChange={(e) => setBoardSubtitle(e.target.value)}
                onBlur={() => onUpdate({ board_subtitle: boardSubtitle.trim() || undefined })}
                placeholder={subtitleForIntake(intake)}
                className="text-sm"
              />
              <p className="mt-1.5 text-xs" style={{ color: MUTED }}>Shown under their name on the board, e.g. "Waiting on plan details".</p>
            </div>
          )}
        </div>
      </div>
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
    const display =
      type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? (formatDate(`${value}T00:00:00`) ?? value)
        : value;
    return (
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
        <p className="text-sm font-bold flex items-center gap-1.5 mt-0.5" style={{ color: TEXT }}>
          {Icon && <Icon size={13} style={{ color: MUTED }} className="shrink-0" />}
          {display}
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
  onSave: (contact: { email: string; phone: string }) => void;
  serviceCategory: ServiceCategory;
  onServiceCategoryChange: (v: ServiceCategory) => void;
  showSubmissionStatus?: boolean;
}) {
  const kin = draft.next_of_kin ?? [];
  const hasAnyData = Object.keys(intake.web_intake ?? {}).length > 0;
  const agedCareBlocked = serviceCategory === "aged_care" && !isAgedCareEligible(draft.date_of_birth);

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
          <IntakeFormSection icon={User} title="Participant details" {...sectionEditProps}>
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

const FUNDING_TO_PLAN_MANAGEMENT: Record<string, string> = {
  ndia_managed: "NDIA-managed",
  plan_managed: "plan-managed",
  self_managed: "self-managed",
};

function agreementDefaults(intake: Intake): BuilderDefaults {
  const web: Partial<WebIntakeForm> = intake.web_intake ?? {};
  return {
    plan_management_type: web.funding_type ? FUNDING_TO_PLAN_MANAGEMENT[web.funding_type] : null,
    plan_manager_name: web.plan_manager_org || web.plan_manager_name || null,
    plan_manager_email: web.plan_manager_email || null,
    start_date: intake.plan_start_date || null,
    end_date: intake.plan_end_date || null,
    supports: (intake.meet_greet_summary?.supports ?? []).map((s) => ({
      support_item_code: s.item_code ?? "",
      quantity: totalHours(s.hours_per_week, intake.plan_start_date, intake.plan_end_date),
      rate: null,
      location: s.location,
      frequency: s.frequency,
      note: s.description,
    })),
  };
}

function totalHours(perWeek: number | null, start?: string, end?: string): number | null {
  if (perWeek == null || !start || !end) return null;
  const weeks = (new Date(`${end.slice(0, 10)}T00:00:00`).getTime() - new Date(`${start.slice(0, 10)}T00:00:00`).getTime()) / (7 * 86_400_000);
  return weeks > 0 ? Math.round(perWeek * weeks) : null;
}