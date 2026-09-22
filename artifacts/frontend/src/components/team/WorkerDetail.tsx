import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock3,
  GraduationCap,
  Plus,
  Check,
  X as XIcon,
  FileText,
  Download,
  Trash2,
  Mail,
  Phone,
  MapPin,
  IdCard,
  Hourglass,
  AlertCircle,
  ShieldCheck,
  Sparkles,
  CalendarDays,
  LogIn,
  MessageCircle,
  ArrowRight,
  TrendingUp,
  MoreHorizontal,
  Clock,
  Link2,
  UserX,
  UserCheck,
  Copy,
  ClipboardCheck,
  KeyRound,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  Star,
  User,
  HeartHandshake,
  CalendarClock,
  Cake,
  PhoneCall,
  Stethoscope,
  Building2,
  FileCheck,
  Languages,
  Briefcase,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getTeamCredentials,
  getTrainingModules,
  getWorkerTrainingAssignments,
  getWorkerAvailability,
  assignTraining,
  dismissTrainingAssignment,
  reviewTrainingCompletion,
  createTrainingModule,
  getWorkerOnboardingDocuments,
  uploadWorkerOnboardingDocument,
  deleteWorkerOnboardingDocument,
  getWorkerSkills,
  getWorkerShiftHistory,
  getWorkerShiftHistoryDetail,
  getWorkerPerformanceDashboard,
  getWorkerAssignments,
  getWorkerTags,
  addWorkerTag,
  removeWorkerTag,
  getTagCatalog,
  getShiftMatchFeedback,
  postShiftMatchFeedback,
  getCoordinatorWorkerStats,
  assignWorkerCoordinator,
  getAwardClassifications,
  assignWorkerClassification,
  getShiftPayPreview,
  markShiftSleepover,
  logShiftCallOut,
  getWorkerShiftEventTimeline,
  getWorkerBuddy,
  getBuddySuggestions,
  assignWorkerBuddy,
  type WorkerStats,
  type TrainingModule,
  type WorkerOnboardingDocument,
  type WorkerOnboardingDocumentType,
} from "@/services/coordinatorService";
import type {
  ShiftHistoryRow,
  ShiftHistoryDetail,
} from "@/services/workerPerformanceService";
import { listIncidents } from "@/services/incidentService";
import { getWorkerInduction } from "@/services/inductionService";
import {
  reviewCredential,
  type Credential,
} from "@/services/credentialsService";
import {
  getTeamOnboarding,
  CHECKLIST_STEP_ORDER,
  CHECKLIST_LABELS,
} from "@/services/onboardingService";
import { getWorkerCoachingSignal } from "@/services/medicationService";
import { WorkerAvailabilityPanel } from "@/components/coordinator/WorkerAvailabilityPanel";
import { safeFormat } from "@/lib/participant-format";
import { emergencyContactDisplay } from "@/lib/participant-display";
import { useMyAccessGrants } from "@/hooks/useMyAccessGrants";
import { TemporaryAccessBanner } from "@/components/TemporaryAccessBanner";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { FileDropzone } from "@/components/ui/file-dropzone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { datetimeLocalValueToUtcIso } from "@/lib/datetime";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const CORAL = "var(--cc-coral)";
const CARD_SHADOW = "var(--cc-card-shadow)";

// Mirrors AccessibilityPanel.tsx's LANGUAGE_OPTIONS — kept local rather than
// imported since that file doesn't export it and this is the only other
// place a language code needs a display label.
const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  vi: "Tiếng Việt",
  ar: "العربية",
  "zh-Hans": "简体中文",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  independent_worker: "Independent worker",
  small_provider: "Small provider",
};

// "overview" stays a valid value (not in ALL_WORKER_DETAIL_TABS, so no tab
// button renders for it) purely so an old bookmarked ?tab=overview deep link
// still resolves to something - it's treated as an alias for "personal"
// wherever tab is read, rather than the two staying separate tabs.
export type WorkerDetailTab =
  | "overview"
  | "personal"
  | "documents"
  | "credentials"
  | "availability"
  | "training"
  | "induction"
  | "shifts"
  | "participants";

const ALL_WORKER_DETAIL_TABS: WorkerDetailTab[] = [
  "personal",
  "shifts",
  "participants",
  "availability",
  "documents",
  "credentials",
  "training",
  "induction",
];

const TAB_DESCRIPTION: Record<WorkerDetailTab, string> = {
  overview: "Personal information, work arrangements and account preferences.",
  personal: "Personal information, work arrangements and account preferences.",
  shifts: "Review completed shifts, documentation and delivery quality.",
  participants:
    "View current participant assignments and previous care relationships.",
  availability:
    "Review regular working hours, time off and scheduling preferences.",
  documents: "Find employment records, references and other staff documents.",
  credentials:
    "Check required credentials, review evidence and track expiry dates.",
  training:
    "Assign learning, review submissions and follow up on overdue training.",
  induction: "Track the first-day checklist and mandatory induction progress.",
};

function ProfileLoadError({
  label,
  retry,
}: {
  label: string;
  retry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cc-border bg-[var(--cc-surface)] p-4 text-sm text-cc-text"
    >
      <span>{label} could not be loaded.</span>
      <Button variant="outline" size="sm" onClick={retry}>
        Retry {label.toLowerCase()}
      </Button>
    </div>
  );
}

const TAB_ICON: Record<WorkerDetailTab, typeof User> = {
  overview: User,
  personal: User,
  shifts: CalendarDays,
  participants: HeartHandshake,
  documents: FileText,
  credentials: ShieldCheck,
  availability: CalendarClock,
  training: GraduationCap,
  induction: ClipboardCheck,
};

/** Mandatory credential types every worker is expected to have on file. */
export const REQUIRED_CREDENTIAL_TYPES = [
  "ndis_screening",
  "wwcc",
  "code_of_conduct",
  "first_aid",
  "cpr",
  "manual_handling",
  "infection_control",
  "medication_admin",
];

const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  ndis_screening: "NDIS Worker Screening Check",
  wwcc: "Working With Children Check",
  code_of_conduct: "NDIS Code of Conduct",
  first_aid: "First Aid",
  cpr: "CPR",
  manual_handling: "Manual Handling",
  infection_control: "Infection Control",
  medication_admin: "Medication Administration",
  drivers_licence: "Driver's Licence",
  police_check: "Police Check",
  vehicle_registration: "Vehicle Registration",
  vehicle_insurance: "Vehicle Insurance (Comprehensive)",
  qualification: "Qualification",
};

/** A worker is "verified" once every mandatory credential type is on file
 * and strictly valid. Must match the backend's actual pipeline gate
 * (onboarding_escalation_service.mandatory_credentials_approved), which
 * requires strictly "valid" too — treating "expiring" as complete here
 * would show a worker as fully ready on this screen while the MD's
 * Worker Onboarding Pipeline board simultaneously keeps them in
 * "Screening & Credentials", for the exact same underlying data. */
export function isWorkerCredentialsComplete(
  credentials: Credential[],
  workerId: string,
): boolean {
  const workerCreds = credentials.filter((c) => c.user_id === workerId);
  const byType = new Map(workerCreds.map((c) => [c.credential_type, c]));
  return REQUIRED_CREDENTIAL_TYPES.every(
    (type) => byType.get(type)?.status === "valid",
  );
}

function credentialLabel(type: string) {
  return (
    CREDENTIAL_TYPE_LABELS[type] ??
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Every status tab on this page uses the same three colors for the same meanings — green for
// complete/good standing, amber for pending/expiring/awaiting review, red for overdue/expired/
// missing entirely — so a coordinator learns the color language once on Overview and it applies
// everywhere else. "Pending review" and "Expiring soon" are both amber (same severity tier,
// distinguished by label, not color); "Not on file" and "Rejected" are both red for the same
// reason.
function statusStyle(status: string) {
  switch (status) {
    case "valid":
      return {
        bg: "var(--cc-status-success-bg)",
        color: "var(--cc-status-success)",
        Icon: CheckCircle2,
        label: "Valid",
      };
    case "expiring":
      return {
        bg: "var(--cc-status-warning-bg)",
        color: "var(--cc-status-warning)",
        Icon: Clock3,
        label: "Expiring soon",
      };
    case "expired":
      return {
        bg: "var(--cc-status-danger-bg)",
        color: "var(--cc-status-danger)",
        Icon: AlertTriangle,
        label: "Expired",
      };
    case "pending_review":
      return {
        bg: "var(--cc-status-warning-bg)",
        color: "var(--cc-status-warning)",
        Icon: Clock3,
        label: "Pending review",
      };
    case "rejected":
      return {
        bg: "var(--cc-status-danger-bg)",
        color: "var(--cc-status-danger)",
        Icon: XCircle,
        label: "Rejected",
      };
    default:
      return {
        bg: "var(--cc-status-danger-bg)",
        color: "var(--cc-status-danger)",
        Icon: XCircle,
        label: "Not on file",
      };
  }
}

// A recheck is due if the NDIS Commission portal has never been checked, if it's been checked
// but a while ago (90 days — a separate staleness clock from expiry), or the credential's own
// expiry is approaching. The 60-day expiry threshold mirrors screening_recheck_service.py's
// RECHECK_LEAD_DAYS on the backend (backend/app/services/screening_recheck_service.py) so the
// UI prompt and the backend reminder job agree on when a recheck is actually due.
const SCREENING_RECHECK_STALE_DAYS = 90;
const SCREENING_RECHECK_EXPIRY_LEAD_DAYS = 60;

function isScreeningRecheckDue(credential: Credential): boolean {
  if (!credential.last_checked_against_nwsd) return true;
  const daysSinceChecked =
    (Date.now() - new Date(credential.last_checked_against_nwsd).getTime()) /
    86_400_000;
  if (daysSinceChecked > SCREENING_RECHECK_STALE_DAYS) return true;
  if (credential.expiry_date) {
    const daysUntilExpiry =
      (new Date(credential.expiry_date).getTime() - Date.now()) / 86_400_000;
    if (daysUntilExpiry <= SCREENING_RECHECK_EXPIRY_LEAD_DAYS) return true;
  }
  return false;
}

function complianceColour(score: number | null | undefined): string {
  if (score == null) return MUTED;
  if (score >= 85) return "var(--cc-status-success)";
  if (score >= 60) return "var(--cc-status-warning)";
  return "var(--cc-status-danger)";
}

/** Deterministic, cheerful avatar tint per worker — purely decorative variety, same soft palette used across the app. */
const AVATAR_PALETTE = [
  { bg: "#F3E8FF", fg: "#7C3AED" },
  { bg: "#FCE3EB", fg: "#DB2777" },
  { bg: "#DBEAFE", fg: "#1D4ED8" },
  { bg: "#DCFCE7", fg: "#15803D" },
  { bg: "#FEF3C7", fg: "#B45309" },
  { bg: "#E0F2FE", fg: "#0369A1" },
];
function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/** Small rounded icon square used to give list rows (documents/credentials/training) consistent visual weight. */
function IconBadge({
  icon: Icon,
  color,
  bg,
}: {
  icon: typeof FileText;
  color: string;
  bg: string;
}) {
  return (
    <div
      className="h-9 w-9 rounded-xl shrink-0 flex items-center justify-center"
      style={{ background: bg }}
    >
      <Icon size={15} style={{ color }} />
    </div>
  );
}

/** Turns a static phone/email row into something you can act on: click the value to call/email
 * (tel:/mailto:), or copy it without leaving the page. Mirrors ParticipantProfileCard's
 * conditional-link convention so contact info reads consistently across the app. */
export function ContactLink({
  icon: Icon,
  value,
  href,
}: {
  icon: typeof Mail;
  value: string;
  href: string;
}) {
  const { toast } = useToast();
  return (
    <span className="group inline-flex max-w-full min-w-0 items-center gap-1">
      <a
        href={href}
        className="inline-flex min-h-11 min-w-0 items-center gap-1.5 break-all hover:underline"
        style={{ color: "inherit" }}
      >
        <Icon size={13} className="shrink-0" />{" "}
        <span className="min-w-0 break-all">{value}</span>
      </a>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          Promise.resolve()
            .then(() => navigator.clipboard.writeText(value))
            .then(() => toast({ title: "Copied" }))
            .catch(() =>
              toast({ title: "Could not copy", variant: "destructive" }),
            );
        }}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded transition-opacity hover:bg-black/5"
        title="Copy"
        aria-label={`Copy ${value}`}
      >
        <Copy size={11} />
      </button>
    </span>
  );
}

/** Compact radial score ring, matching the Compliance Centre header's ring pattern. Animates
 * from zero on first mount only (not on re-renders) and honours prefers-reduced-motion. */
function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const reduceMotion = useReducedMotion();
  const color = complianceColour(score);
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={SOFT}
          strokeWidth="4"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circ}
          strokeLinecap="round"
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - score / 100) }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }
          }
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-semibold" style={{ color }}>
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

type ReadinessLevel = "good" | "warning" | "danger";
type TopReason = { level: "warning" | "danger"; label: string } | null;

/** Single source of truth for "what's the one most urgent thing blocking this worker" —
 * computed once and threaded into the Overview ring, the Credentials tab strip, and the
 * Training tab strip, so all three name the same reason instead of each recomputing (and
 * potentially disagreeing on) their own. Priority order matches the Team list's Readiness
 * column exactly: training overdue (blocks rostering outright) outranks onboarding pending,
 * which outranks credentials incomplete. */
function computeTopReason(
  worker: WorkerStats,
  credentialsComplete: boolean,
  credentialsCompleteCount: number,
  credentialsTotal: number,
  onboardingPending: boolean,
  translate: (k: string) => string,
): TopReason {
  if (worker.training_overdue) {
    return { level: "danger", label: "Training overdue" };
  }
  if (onboardingPending) {
    return { level: "warning", label: "Blocked by onboarding" };
  }
  if (!credentialsComplete) {
    return {
      level: "warning",
      label: `Blocked by credentials · ${credentialsCompleteCount}/${credentialsTotal}`,
    };
  }
  if (worker.flagged_count > 0) {
    return {
      level: "danger",
      label: translateFlagged(worker.flagged_count, translate),
    };
  }
  return null;
}

/** Unifies the compliance ring + onboarding pill + credentials pill into one "can I roster
 * this person" answer, with a single most-urgent blocking reason and an action to fix it. */
function ReadinessSummary({
  worker,
  topReason,
  credentialsComplete,
  translate,
  onAction,
}: {
  worker: WorkerStats;
  topReason: TopReason;
  credentialsComplete: boolean;
  translate: (k: string) => string;
  onAction: () => void;
}) {
  // The ring's percentage and a blocking-reason fraction (e.g. credentials 1/8) are two
  // different measurements — one score, one count — and used to sit side by side with no
  // stated relationship, reading as if they should match (they don't: 1/8 isn't 68%). The
  // message now states explicitly that the percentage is the overall readiness score and
  // names whatever's currently blocking it as a separate, clearly-labelled reason.
  const level: ReadinessLevel = topReason?.level ?? "good";
  const actionLabel = !credentialsComplete
    ? translate("team.detail.completeCredentials")
    : null;

  const levelColor =
    level === "good"
      ? "var(--cc-status-success)"
      : level === "warning"
        ? "var(--cc-status-warning)"
        : "var(--cc-status-danger)";
  const score = worker.avg_compliance;
  const message =
    score != null
      ? topReason
        ? `Readiness ${Math.round(score)}% · ${topReason.label}`
        : `Readiness ${Math.round(score)}%`
      : (topReason?.label ?? translate("team.detail.readyToRoster"));
  const a11yText = message;

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-3 py-2"
      style={{
        background: SURFACE,
        borderColor: levelColor,
        boxShadow: CARD_SHADOW,
      }}
      role="status"
      aria-label={a11yText}
    >
      {score != null && <ScoreRing score={score} />}
      <div className="min-w-0">
        <p
          className="text-[12px] font-bold leading-tight"
          style={{ color: levelColor }}
        >
          {message}
        </p>
        {actionLabel && (
          <button
            type="button"
            onClick={onAction}
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded"
            style={{ color: PLUM, outlineColor: PLUM }}
          >
            {actionLabel} <ArrowRight size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

function translateFlagged(
  count: number,
  translate: (k: string) => string,
): string {
  return `${count} ${translate(count === 1 ? "team.detail.flaggedSession" : "team.detail.flaggedSessions")}`;
}

export function WorkerDetail({
  worker,
  onBack,
  initialTab,
  onAssignShift,
  onAssignClient,
  onReminder,
  onDeactivate,
  onActivate,
  onSendPasswordReset,
  onDeleteAccount,
  fullScreen,
  onToggleFullScreen,
  scrollContext = "panel",
}: {
  worker: WorkerStats;
  onBack: () => void;
  initialTab?: WorkerDetailTab;
  /** Quick actions — optional so WorkerDetail can still be used standalone without a coordinator
   * shell wired up. When provided, they surface directly on the profile so acting on this worker
   * doesn't require going back to the list first. */
  onAssignShift?: () => void;
  onAssignClient?: () => void;
  onReminder?: () => void;
  onDeactivate?: () => void;
  onActivate?: () => void;
  onSendPasswordReset?: () => void;
  /** MD-only - deactivation covers "can't log in" for both roles, but only the
   * MD has authority to remove a staff member's account entirely. */
  onDeleteAccount?: () => void;
  /** Optional — only set when this profile is rendered inside a Sheet whose
   * parent controls the panel width (e.g. md/staff.tsx). */
  /** Page profiles leave room for the portal header; panels use their own scroll area. */
  scrollContext?: "page" | "panel";
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
}) {
  const { translate } = useAccessibility();
  const [tab, setTab] = useState<WorkerDetailTab>(
    !initialTab || initialTab === "overview" ? "personal" : initialTab,
  );
  const reduceProfileMotion = useReducedMotion();
  const sectionsRef = useRef<HTMLDivElement>(null);
  function selectProfileTab(nextTab: WorkerDetailTab) {
    setTab(nextTab);
    const sections = sectionsRef.current;
    if (!sections) return;
    const offset = parseFloat(getComputedStyle(sections).scrollMarginTop) || 0;
    if (sections.getBoundingClientRect().top < offset) {
      sections.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  useEffect(() => {
    setTab(!initialTab || initialTab === "overview" ? "personal" : initialTab);
    setFocusCredentialType(null);
  }, [worker.id, initialTab]);
  const [focusCredentialType, setFocusCredentialType] = useState<string | null>(
    null,
  );

  // Next Steps rows for missing credentials jump straight to that specific row in the
  // Credentials tab (scrolled into view + briefly highlighted), not just the tab in general.
  function jumpToTab(nextTab: WorkerDetailTab, credentialType?: string) {
    selectProfileTab(nextTab);
    setFocusCredentialType(credentialType ?? null);
  }

  const credentialsQuery = useOrgQuery(["team-credentials"], {
    queryFn: getTeamCredentials,
  });
  const documentsQuery = useOrgQuery(
    ["worker-onboarding-documents", worker.id],
    {
      queryFn: () => getWorkerOnboardingDocuments(worker.id),
    },
  );
  const trainingQuery = useOrgQuery(
    ["worker-training-assignments", worker.id],
    {
      queryFn: () => getWorkerTrainingAssignments(worker.id),
    },
  );

  const workerCredentials = (credentialsQuery.data ?? []).filter(
    (c: Credential) => c.user_id === worker.id,
  );
  const credentialsKnown =
    !credentialsQuery.isLoading &&
    !credentialsQuery.isError &&
    credentialsQuery.data !== undefined;
  const credentialsComplete =
    credentialsKnown &&
    isWorkerCredentialsComplete(credentialsQuery.data ?? [], worker.id);
  const onboardingPending =
    worker.role === "support_worker" && worker.onboarding_completed === false;
  // One pass building {type -> status}, so the count and the missing-list
  // below can never disagree about what "complete" means (they used to be
  // two separately-maintained filters) — and both now require strictly
  // "valid", matching isWorkerCredentialsComplete and the backend's actual
  // pipeline gate.
  const credentialStatusByType = new Map(
    REQUIRED_CREDENTIAL_TYPES.map((type) => [
      type,
      workerCredentials.find((c) => c.credential_type === type)?.status,
    ]),
  );
  const credentialsCompleteCount = REQUIRED_CREDENTIAL_TYPES.filter(
    (type) => credentialStatusByType.get(type) === "valid",
  ).length;
  const missingCredentialTypes = credentialsKnown
    ? REQUIRED_CREDENTIAL_TYPES.filter(
        (type) => credentialStatusByType.get(type) !== "valid",
      )
    : [];
  const topReason = computeTopReason(
    worker,
    credentialsComplete,
    credentialsCompleteCount,
    REQUIRED_CREDENTIAL_TYPES.length,
    onboardingPending,
    translate,
  );
  const documentsCount = documentsQuery.data?.length ?? 0;
  const trainingPendingCount = (
    trainingQuery.data?.recommendations ?? []
  ).filter(
    (r) =>
      !(trainingQuery.data?.history ?? []).some(
        (h) => h.module_id === r.training_module_id,
      ),
  ).length;

  const tabBadges: Partial<
    Record<
      WorkerDetailTab,
      { text: string; severity: "neutral" | "warning" | "danger" }
    >
  > = {
    documents:
      documentsCount > 0
        ? { text: String(documentsCount), severity: "neutral" }
        : undefined,
    credentials: credentialsKnown
      ? {
          text: `${credentialsCompleteCount}/${REQUIRED_CREDENTIAL_TYPES.length}`,
          severity: credentialsComplete
            ? "neutral"
            : credentialsCompleteCount === 0
              ? "danger"
              : "warning",
        }
      : undefined,
    training:
      trainingPendingCount > 0
        ? { text: String(trainingPendingCount), severity: "warning" }
        : undefined,
  };

  const statCells: { label: string; value: string | number; color?: string }[] =
    [
      { label: translate("team.col.sessions"), value: worker.total_sessions },
      {
        label: translate("team.col.thisWeek"),
        value: worker.sessions_this_week,
      },
      { label: translate("team.detail.draftCount"), value: worker.draft_count },
      {
        label: translate("team.detail.flaggedCount"),
        value: worker.flagged_count,
        color: worker.flagged_count > 0 ? "var(--cc-status-danger)" : undefined,
      },
    ];
  const avatar = avatarColor(worker.full_name || "?");

  const hasQuickActions =
    onAssignShift ||
    onAssignClient ||
    onReminder ||
    onDeactivate ||
    onActivate ||
    onSendPasswordReset ||
    onDeleteAccount;

  return (
    <div
      className={
        fullScreen
          ? "mx-auto w-full min-w-0 max-w-[1400px] space-y-4 xl:px-6"
          : "w-full min-w-0 space-y-4"
      }
    >
      {/* Back + quick actions - pr-8 keeps the "..." trigger clear of a Sheet's
          own built-in close (X) button, which sits fixed top-right whenever
          this panel is opened inside one (e.g. md/staff.tsx). */}
      <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-bold transition-colors"
          style={{ color: PLUM }}
        >
          <ArrowLeft size={15} /> {translate("team.detail.back")}
        </button>
        <div className="flex items-center gap-2">
          {onToggleFullScreen && (
            <button
              type="button"
              onClick={onToggleFullScreen}
              className="hidden lg:flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-black/5"
              style={{ borderColor: BORDER, color: PLUM }}
            >
              {fullScreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {fullScreen ? "Exit full screen" : "Full screen"}
            </button>
          )}
          {hasQuickActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="min-h-11 min-w-11 rounded-lg p-2 transition-colors hover:bg-black/5"
                  style={{ color: MUTED }}
                  aria-label={`Actions for ${worker.full_name}`}
                >
                  <MoreHorizontal size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onAssignShift && (
                  <DropdownMenuItem onClick={onAssignShift}>
                    <Clock size={13} className="mr-1.5" />{" "}
                    {translate("team.assignShift")}
                  </DropdownMenuItem>
                )}
                {onAssignClient && (
                  <DropdownMenuItem onClick={onAssignClient}>
                    <Link2 size={13} className="mr-1.5" />{" "}
                    {translate("team.assignClient")}
                  </DropdownMenuItem>
                )}
                {onReminder && (
                  <DropdownMenuItem onClick={onReminder}>
                    <Mail size={13} className="mr-1.5" />{" "}
                    {translate("team.reminder")}
                  </DropdownMenuItem>
                )}
                {onSendPasswordReset && (
                  <DropdownMenuItem onClick={onSendPasswordReset}>
                    <KeyRound size={13} className="mr-1.5" /> Send password
                    reset email
                  </DropdownMenuItem>
                )}
                {(onDeactivate || onActivate) && <DropdownMenuSeparator />}
                {onDeactivate && worker.is_active !== false && (
                  <DropdownMenuItem
                    onClick={onDeactivate}
                    className="text-red-600 focus:text-red-600"
                  >
                    <UserX size={13} className="mr-1.5" />{" "}
                    {translate("team.deactivate")}
                  </DropdownMenuItem>
                )}
                {onActivate && worker.is_active === false && (
                  <DropdownMenuItem
                    onClick={onActivate}
                    className="text-green-700 focus:text-green-700"
                  >
                    <UserCheck size={13} className="mr-1.5" />{" "}
                    {translate("team.reactivate")}
                  </DropdownMenuItem>
                )}
                {onDeleteAccount && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDeleteAccount}
                      className="text-red-600 focus:text-red-600"
                    >
                      <Trash2 size={13} className="mr-1.5" /> Remove account
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Identity + at-a-glance header */}
      <div
        className="rounded-xl overflow-hidden border"
        style={{
          background: SURFACE,
          borderColor: BORDER,
          boxShadow: CARD_SHADOW,
        }}
      >
        <div
          className={`flex flex-wrap items-start gap-3 ${fullScreen ? "p-4 sm:p-5" : "p-4 sm:p-5"}`}
        >
          <div
            className={`${fullScreen ? "h-14 w-14 text-xl" : "h-14 w-14 text-xl"} rounded-full shrink-0 flex items-center justify-center overflow-hidden font-semibold shadow-sm`}
            style={{ background: avatar.bg, color: avatar.fg }}
          >
            {worker.profile_photo_url ? (
              <img
                src={worker.profile_photo_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              (worker.full_name || "?").charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                className={`${fullScreen ? "text-2xl" : "text-lg"} font-semibold break-words`}
                style={{ color: TEXT }}
              >
                {worker.full_name}
              </h2>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background:
                    worker.is_active !== false
                      ? "var(--cc-status-success-bg)"
                      : "var(--cc-status-danger-bg)",
                  color:
                    worker.is_active !== false
                      ? "var(--cc-status-success)"
                      : "var(--cc-status-danger)",
                }}
              >
                {worker.is_active !== false
                  ? translate("team.status.active")
                  : translate("team.status.inactive")}
              </span>
              {onboardingPending && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  style={{
                    borderColor: "var(--cc-status-warning)",
                    color: "var(--cc-status-warning)",
                  }}
                >
                  <Hourglass size={10} />{" "}
                  {translate("team.detail.onboardingPending")}
                </span>
              )}
              {worker.training_overdue && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: "var(--cc-status-danger-bg)",
                    color: "var(--cc-status-danger)",
                  }}
                >
                  <AlertCircle size={10} />{" "}
                  {translate("team.detail.trainingOverdue")}
                </span>
              )}
            </div>
            <p className="text-xs mt-1 capitalize" style={{ color: MUTED }}>
              {(worker.role || "").replace(/_/g, " ")}
              <span className="mx-1.5">·</span>
              <span className="font-bold" style={{ color: TEXT }}>
                {worker.employee_id || worker.id.slice(0, 8)}
              </span>
            </p>
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs"
              style={{ color: MUTED }}
            >
              {worker.email && (
                <ContactLink
                  icon={Mail}
                  value={worker.email}
                  href={`mailto:${worker.email}`}
                />
              )}
              {worker.phone && (
                <ContactLink
                  icon={Phone}
                  value={worker.phone}
                  href={`tel:${worker.phone.replace(/\s/g, "")}`}
                />
              )}
            </div>
          </div>
          <div
            className="w-full min-w-0 border-t pt-3 xl:w-auto xl:max-w-sm xl:border-t-0 xl:pt-0"
            style={{ borderColor: BORDER }}
          >
            {credentialsKnown ? (
              <ReadinessSummary
                worker={worker}
                topReason={topReason}
                credentialsComplete={credentialsComplete}
                translate={translate}
                onAction={() => setTab("credentials")}
              />
            ) : (
              <div
                role={credentialsQuery.isError ? "alert" : "status"}
                className="flex flex-wrap items-center justify-between gap-2 text-sm text-cc-muted"
              >
                <span>
                  {credentialsQuery.isError
                    ? "Credential status could not be loaded."
                    : "Loading credential status..."}
                </span>
                {credentialsQuery.isError && (
                  <Button
                    variant="outline"
                    onClick={() => void credentialsQuery.refetch()}
                  >
                    Retry credentials
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* At-a-glance stat strip */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 divide-x"
          style={{ borderTop: `1px solid ${BORDER}`, borderColor: BORDER }}
        >
          {statCells.map((cell) => (
            <div
              key={cell.label}
              className={fullScreen ? "px-3 py-2.5" : "px-3 py-2.5"}
              style={{ borderColor: BORDER }}
            >
              <p
                className="text-[10px] font-bold uppercase tracking-wide"
                style={{ color: MUTED }}
              >
                {cell.label}
              </p>
              <p
                className={`${fullScreen ? "text-lg" : "text-base"} font-semibold tabular-nums mt-0.5`}
                style={{ color: cell.color ?? TEXT }}
              >
                {cell.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Keep section navigation within the profile's existing scroll container. */}
      <div
        ref={sectionsRef}
        className={`flex flex-col gap-5 scroll-mt-[var(--profile-nav-top)] lg:flex-row lg:items-start ${scrollContext === "page" ? "[--profile-nav-top:90px] lg:[--profile-nav-top:152px]" : "[--profile-nav-top:12px]"}`}
      >
        <div className="sticky top-[var(--profile-nav-top)] z-20 w-full rounded-xl border border-cc-border bg-[var(--cc-bg)] p-3 shadow-sm lg:hidden">
          <label
            htmlFor={`worker-section-${worker.id}`}
            className="mb-1.5 block text-xs font-medium text-cc-muted"
          >
            Profile section
          </label>
          <select
            id={`worker-section-${worker.id}`}
            value={tab}
            onChange={(e) =>
              selectProfileTab(e.target.value as WorkerDetailTab)
            }
            className="h-11 w-full min-w-0 rounded-lg border border-cc-border bg-transparent px-3 text-sm font-medium text-cc-text"
          >
            {ALL_WORKER_DETAIL_TABS.map((t) => (
              <option key={t} value={t}>
                {translate(`team.detail.tab.${t}`)}
                {tabBadges[t] ? ` (${tabBadges[t]?.text})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div
          role="navigation"
          aria-label="Worker profile sections"
          className={`sticky top-[var(--profile-nav-top)] hidden max-h-[calc(100dvh-var(--profile-nav-top)-24px)] shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain rounded-xl border border-cc-border bg-[var(--cc-surface)] p-2 [scrollbar-width:thin] lg:flex ${fullScreen ? "lg:w-52" : "lg:w-48"}`}
        >
          {ALL_WORKER_DETAIL_TABS.map((t) => {
            const badge = tabBadges[t];
            const badgeColor =
              badge?.severity === "danger"
                ? "var(--cc-status-danger)"
                : badge?.severity === "warning"
                  ? "var(--cc-status-warning)"
                  : MUTED;
            const badgeBg =
              badge?.severity === "danger"
                ? "var(--cc-status-danger-bg)"
                : badge?.severity === "warning"
                  ? "var(--cc-status-warning-bg)"
                  : SOFT;
            const active = tab === t;
            const Icon = TAB_ICON[t];
            return (
              <button
                key={t}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => selectProfileTab(t)}
                className="relative flex min-h-11 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 hover:bg-black/[0.03]"
                style={{
                  background: active ? SOFT : "transparent",
                  color: active ? TEXT : MUTED,
                  outlineColor: PLUM,
                }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
                    style={{
                      background: active ? PLUM : SOFT,
                      color: active ? "#fff" : MUTED,
                    }}
                  >
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 break-words leading-5">
                    {translate(
                      `team.detail.tab.${t}` as "team.detail.tab.overview",
                    )}
                  </span>
                </span>
                {badge && (
                  <span
                    className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: badgeBg, color: badgeColor }}
                  >
                    {badge.text}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="w-full min-w-0 flex-1 [overflow-wrap:anywhere]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${worker.id}-${tab}`}
              role="region"
              aria-label={translate(`team.detail.tab.${tab}`)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceProfileMotion ? 0 : 0.15 }}
            >
              <header className="mb-5 border-b border-cc-border pb-4">
                <h2 className="text-xl font-semibold tracking-tight text-cc-text">
                  {translate(`team.detail.tab.${tab}`)}
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-cc-muted">
                  {TAB_DESCRIPTION[tab]}
                </p>
              </header>
              {(tab === "personal" || tab === "overview") && (
                <PersonalInfoTab
                  worker={worker}
                  translate={translate}
                  missingCredentialTypes={missingCredentialTypes}
                  statusKnown={
                    credentialsKnown &&
                    !trainingQuery.isLoading &&
                    !trainingQuery.isError
                  }
                  trainingPendingCount={trainingPendingCount}
                  onJumpToTab={jumpToTab}
                />
              )}
              {tab === "shifts" && (
                <ShiftsTab worker={worker} translate={translate} />
              )}
              {tab === "participants" && <ParticipantsTab worker={worker} />}
              {tab === "documents" && (
                <DocumentsTab worker={worker} translate={translate} />
              )}
              {tab === "credentials" && !credentialsQuery.isError && (
                <CredentialsTab
                  credentials={workerCredentials}
                  isLoading={credentialsQuery.isLoading}
                  credentialsCompleteCount={credentialsCompleteCount}
                  focusCredentialType={focusCredentialType}
                  topReason={topReason}
                  translate={translate}
                />
              )}
              {tab === "availability" && (
                <div className="space-y-4">
                  <AvailabilitySummaryStrip worker={worker} />
                  <WorkerAvailabilityPanel worker={worker} />
                </div>
              )}
              {tab === "training" && (
                <TrainingTab
                  worker={worker}
                  topReason={topReason}
                  translate={translate}
                />
              )}
              {tab === "induction" && (
                <InductionTab worker={worker} translate={translate} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  icon,
  tone,
  emptyText,
}: {
  label: string;
  value?: string | null;
  icon: typeof FileText;
  tone?: "success" | "warning";
  /** Shown, in muted italic, when value is empty — a designed empty state instead of "N/A". */
  emptyText?: string;
}) {
  const color =
    tone === "success"
      ? "var(--cc-status-success)"
      : tone === "warning"
        ? "var(--cc-status-warning)"
        : MUTED;
  const bg =
    tone === "success"
      ? "var(--cc-status-success-bg)"
      : tone === "warning"
        ? "var(--cc-status-warning-bg)"
        : SOFT;
  return (
    <div
      className="flex min-w-0 items-start gap-3 px-4 py-3 sm:[&:last-child:nth-child(odd)]:col-span-2"
      style={{ background: SURFACE }}
    >
      <IconBadge icon={icon} color={color} bg={bg} />
      <div className="min-w-0 flex-1">
        <p
          className="text-[10px] font-bold uppercase tracking-wide"
          style={{ color: MUTED }}
        >
          {label}
        </p>
        {value ? (
          <p
            className="break-words text-sm font-medium mt-0.5"
            style={{ color: TEXT }}
          >
            {value}
          </p>
        ) : (
          <p className="text-sm italic mt-0.5" style={{ color: MUTED }}>
            {emptyText}
          </p>
        )}
      </div>
    </div>
  );
}

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Availability + (would-be) SCHADS classification strip, so switching into this tab doesn't
 * lose the at-a-glance context — same pattern as every other tab's summary strip. Same
 * worker-availability query key as WorkerAvailabilityPanel below it, so this doesn't trigger a
 * second network request, just reads the same cached data.
 *
 * SCHADS classification (e.g. "SACS Level 2") is intentionally NOT shown here: it does not
 * exist anywhere in this codebase — no field, no table, no API — same situation as the earlier
 * "Person Archive" reference. Building an editable classification field with nowhere real to
 * save it would just be a fake control; this is flagged rather than faked. */
function AvailabilitySummaryStrip({ worker }: { worker: WorkerStats }) {
  const { data } = useOrgQuery(["worker-availability", worker.id], {
    queryFn: () => getWorkerAvailability(worker.id),
  });
  const a = data?.availability;

  return (
    <div
      className="rounded-xl border px-5 py-4"
      style={{ background: SOFT, borderColor: BORDER }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Clock size={14} style={{ color: PLUM }} />
        <p
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: MUTED }}
        >
          Availability
        </p>
      </div>
      {a ? (
        <p className="text-sm font-bold" style={{ color: TEXT }}>
          Available up to {a.max_hours_per_week} hours per week
          {a.available_days?.length > 0 &&
            ` · ${a.available_days
              .map((d) => DAY_ABBR[d - 1])
              .filter(Boolean)
              .join(", ")}`}
        </p>
      ) : (
        <p className="text-sm" style={{ color: MUTED }}>
          No availability set yet.
        </p>
      )}
    </div>
  );
}

function ProfileCard({ worker }: { worker: WorkerStats }) {
  const skillsQuery = useOrgQuery(["worker-skills", worker.id], {
    queryFn: () => getWorkerSkills(worker.id),
  });
  const skills = skillsQuery.data ?? [];

  if (
    !worker.profile_summary &&
    !worker.profile_experience_years &&
    skills.length === 0
  ) {
    return null;
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <div className="flex items-center gap-2">
        <Sparkles size={14} style={{ color: PLUM }} />
        <p
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: MUTED }}
        >
          Profile
        </p>
      </div>
      {worker.profile_summary && (
        <p className="mt-2.5 text-sm leading-relaxed" style={{ color: TEXT }}>
          {worker.profile_summary}
        </p>
      )}
      {worker.profile_experience_years && (
        <p className="mt-2 text-xs font-semibold" style={{ color: TEXT }}>
          {worker.profile_experience_years}
        </p>
      )}
      {skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <span
              key={s.skill}
              className="rounded-full px-2.5 py-1 text-[10px] font-bold"
              style={{
                background: s.is_certified
                  ? "var(--cc-status-success-bg)"
                  : SOFT,
                color: s.is_certified ? "var(--cc-status-success)" : MUTED,
              }}
              title={s.is_certified ? "Certified" : "Unverified: from resume"}
            >
              {s.skill}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileDetailsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <details
      className="group overflow-hidden rounded-xl border"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-cc-text">
            {title}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-cc-muted">
            {description}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="shrink-0 text-cc-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div
        className="space-y-3 border-t p-3 sm:p-4"
        style={{ borderColor: BORDER }}
      >
        {children}
      </div>
    </details>
  );
}

function PersonalInfoTab({
  statusKnown,
  worker,
  translate,
  missingCredentialTypes,
  trainingPendingCount,
  onJumpToTab,
}: {
  statusKnown: boolean;
  worker: WorkerStats;
  translate: (k: string) => string;
  missingCredentialTypes: string[];
  trainingPendingCount: number;
  onJumpToTab: (tab: WorkerDetailTab, credentialType?: string) => void;
}) {
  const onboardingPending =
    worker.role === "support_worker" && worker.onboarding_completed === false;

  const coachingQuery = useOrgQuery(
    ["worker-medication-coaching-signal", worker.id],
    {
      queryFn: () => getWorkerCoachingSignal(worker.id),
      enabled: worker.role === "support_worker",
    },
  );
  const coaching = coachingQuery.data?.signal;

  // Discrete checklist step the worker is currently on, not just a pending/complete boolean —
  // genuinely new information instead of repeating the header's "Onboarding Pending" badge.
  const onboardingQuery = useOrgQuery(["team-onboarding"], {
    queryFn: getTeamOnboarding,
    enabled: onboardingPending,
  });
  const workerChecklist = (onboardingQuery.data ?? []).find(
    (row) => String(row.id) === worker.id,
  )?.onboarding_checklist as Record<string, boolean> | undefined;
  const currentStepKey = workerChecklist
    ? CHECKLIST_STEP_ORDER.find((key) => !workerChecklist[key])
    : undefined;
  const currentStepLabel = currentStepKey
    ? CHECKLIST_LABELS[currentStepKey]
    : undefined;

  const [nextStepsOpen, setNextStepsOpen] = useState(false);

  const nextSteps: { label: string; onClick?: () => void }[] = [];
  if (onboardingPending) {
    nextSteps.push({
      label: currentStepLabel
        ? `Onboarding: currently on "${currentStepLabel}"`
        : "Onboarding checklist not yet complete",
    });
  }
  // One row per missing credential, each linking straight to that credential's row in the
  // Credentials tab — not one block of text with a single generic "go to tab" arrow.
  for (const type of missingCredentialTypes) {
    nextSteps.push({
      label: credentialLabel(type),
      onClick: () => onJumpToTab("credentials", type),
    });
  }
  if (worker.training_overdue) {
    nextSteps.push({
      label: "Mandatory training is overdue",
      onClick: () => onJumpToTab("training"),
    });
  }
  if (trainingPendingCount > 0) {
    nextSteps.push({
      label: `${trainingPendingCount} training completion${trainingPendingCount !== 1 ? "s" : ""} awaiting your review`,
      onClick: () => onJumpToTab("training"),
    });
  }

  return (
    <div className="space-y-4">
      {/* Concrete, clickable next steps instead of a generic "needs attention" status —
          each row names the actual gap and jumps straight to where it's fixed. Collapsible
          since once reviewed it's mostly reference, not something to keep taking up space. */}
      {nextSteps.length > 0 ? (
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            borderColor: "var(--cc-status-warning)",
            background: "var(--cc-status-warning-bg)",
          }}
        >
          <button
            type="button"
            aria-expanded={nextStepsOpen}
            onClick={() => setNextStepsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3"
          >
            <span className="flex items-center gap-2">
              <AlertCircle
                size={15}
                style={{ color: "var(--cc-status-warning)" }}
              />
              <span
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--cc-status-warning)" }}
              >
                Next steps ({nextSteps.length})
              </span>
            </span>
            {nextStepsOpen ? (
              <ChevronUp
                size={14}
                style={{ color: "var(--cc-status-warning)" }}
              />
            ) : (
              <ChevronDown
                size={14}
                style={{ color: "var(--cc-status-warning)" }}
              />
            )}
          </button>
          {nextStepsOpen && (
            <div
              className="divide-y"
              style={{ borderColor: "var(--cc-status-warning)" }}
            >
              {nextSteps.map((step) =>
                step.onClick ? (
                  <button
                    key={step.label}
                    type="button"
                    onClick={step.onClick}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.03]"
                  >
                    <span
                      className="text-sm font-semibold"
                      style={{ color: TEXT }}
                    >
                      {step.label}
                    </span>
                    <ArrowRight
                      size={14}
                      className="shrink-0"
                      style={{ color: "var(--cc-status-warning)" }}
                    />
                  </button>
                ) : (
                  <div key={step.label} className="px-4 py-3">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: TEXT }}
                    >
                      {step.label}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ) : statusKnown ? (
        <div
          className="rounded-xl border p-4 flex items-center gap-2.5"
          style={{
            borderColor: "var(--cc-status-success)",
            background: "var(--cc-status-success-bg)",
          }}
        >
          <CheckCircle2
            size={16}
            style={{ color: "var(--cc-status-success)" }}
          />
          <p
            className="text-sm font-bold"
            style={{ color: "var(--cc-status-success)" }}
          >
            Nothing outstanding, fully up to date.
          </p>
        </div>
      ) : null}

      {/* Coaching input, not a compliance flag — deliberately its own card, never mixed
          into the stat strip or any compliance-facing surface. */}
      {coaching?.triggered && (
        <div
          className="rounded-xl p-4"
          style={{ background: SOFT, boxShadow: CARD_SHADOW }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <TrendingUp size={15} style={{ color: PLUM }} />
            <p
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: PLUM }}
            >
              {translate("team.detail.coachingTitle")}
            </p>
          </div>
          <p className="text-sm" style={{ color: TEXT }}>
            {coaching.trigger_reason}
          </p>
        </div>
      )}

      <section
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: BORDER, background: SURFACE }}
        aria-label="Personal details"
      >
        <h3
          className="border-b px-4 py-3 text-sm font-semibold text-cc-text"
          style={{ borderColor: BORDER }}
        >
          Personal details
        </h3>
        <div
          className="grid gap-px sm:grid-cols-2"
          style={{ background: BORDER }}
        >
          <DetailRow
            icon={MapPin}
            label="Address"
            value={worker.address ?? undefined}
            emptyText="Not on file"
          />
          <DetailRow
            icon={MapPin}
            label="Suburb"
            value={worker.suburb ?? undefined}
            emptyText="Not on file"
          />
          <DetailRow
            icon={Cake}
            label="Date of birth"
            value={
              worker.date_of_birth
                ? safeFormat(worker.date_of_birth)
                : undefined
            }
            emptyText="Not on file"
          />
          <DetailRow
            icon={PhoneCall}
            label="Emergency contact"
            value={
              emergencyContactDisplay(
                worker.emergency_contact as Parameters<
                  typeof emergencyContactDisplay
                >[0],
              )?.text || undefined
            }
            emptyText="Not on file"
          />
          <DetailRow
            icon={MessageCircle}
            label={translate("team.detail.preferredContact")}
            value={worker.preferred_contact_method}
            emptyText={translate("team.detail.contactNotSet")}
          />
          <DetailRow
            icon={IdCard}
            label="Employee ID"
            value={worker.employee_id ?? undefined}
            emptyText="Not assigned"
          />
        </div>
      </section>

      <ProfileDetailsGroup
        title="Work details"
        description="Coordinator, classification, buddy and registrations"
      >
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <CoordinatorAssignmentSection worker={worker} />
          <ClassificationLevelSection worker={worker} />
          <BuddyAssignmentSection worker={worker} />
        </div>
        <div
          className="grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2"
          style={{ background: BORDER, borderColor: BORDER }}
        >
          <DetailRow
            icon={Stethoscope}
            label="Discipline"
            value={worker.discipline ?? undefined}
            emptyText="Not on file"
          />
          <DetailRow
            icon={ShieldCheck}
            label="AHPRA registration"
            value={worker.ahpra_registration_number ?? undefined}
            emptyText="Not on file"
          />
          <DetailRow
            icon={Building2}
            label="Business name"
            value={worker.business_name ?? undefined}
            emptyText="Not on file"
          />
          <DetailRow
            icon={FileCheck}
            label="Professional indemnity"
            value={
              worker.professional_indemnity_confirmed == null
                ? undefined
                : worker.professional_indemnity_confirmed
                  ? "Confirmed"
                  : "Not confirmed"
            }
            emptyText="Not on file"
          />
        </div>
      </ProfileDetailsGroup>

      <ProfileDetailsGroup
        title="Account & preferences"
        description="Account activity, onboarding and communication preferences"
      >
        <div
          className="grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2"
          style={{ background: BORDER, borderColor: BORDER }}
        >
          <DetailRow
            icon={CalendarDays}
            label={translate("team.detail.joined")}
            value={worker.joined_at ? safeFormat(worker.joined_at) : undefined}
            emptyText={translate("team.detail.noJoinDate")}
          />
          <DetailRow
            icon={LogIn}
            label={translate("team.detail.lastLogin")}
            value={
              worker.last_login
                ? safeFormat(worker.last_login, "MMM d, yyyy h:mm a")
                : undefined
            }
            emptyText={translate("team.detail.noLoginYet")}
          />
          <DetailRow
            icon={ClipboardCheck}
            label={translate("team.detail.onboardingStatus")}
            value={
              worker.onboarding_completed == null
                ? undefined
                : worker.onboarding_completed
                  ? translate("team.detail.onboardingComplete")
                  : "In progress"
            }
            emptyText="Not on file"
          />
          <DetailRow
            icon={Languages}
            label="Preferred language"
            value={
              LANGUAGE_LABELS[worker.preferred_language ?? ""] ??
              worker.preferred_language ??
              undefined
            }
            emptyText="Not on file"
          />
          <DetailRow
            icon={Briefcase}
            label="Account type"
            value={
              ACCOUNT_TYPE_LABELS[worker.account_type ?? ""] ??
              worker.account_type ??
              undefined
            }
            emptyText="Not on file"
          />
          <DetailRow
            icon={ClipboardCheck}
            label="Profile completed"
            value={
              worker.profile_completed == null
                ? undefined
                : worker.profile_completed
                  ? "Yes"
                  : "No"
            }
            emptyText="Not on file"
          />
          <DetailRow
            icon={ClipboardCheck}
            label="Role-specific profile completed"
            value={
              worker.role_specific_profile_completed == null
                ? undefined
                : worker.role_specific_profile_completed
                  ? "Yes"
                  : "No"
            }
            emptyText="Not on file"
          />
          <DetailRow
            icon={Sparkles}
            label="Matching opt-in"
            value={
              worker.matching_opt_in == null
                ? undefined
                : worker.matching_opt_in
                  ? "Yes"
                  : "No"
            }
            emptyText="Not on file"
          />
        </div>
      </ProfileDetailsGroup>

      <ProfileDetailsGroup
        title="Experience & interests"
        description="Profile summary, skills and matching preferences"
      >
        <ProfileCard worker={worker} />
        <WorkerTagsSection workerId={worker.id} />
      </ProfileDetailsGroup>
    </div>
  );
}

/** Worker-Participant Matching Enhancement, Phase 1 — coordinator view of a
 * worker's self-reported interests/lived-experience tags, including any
 * marked visible_to_coordinator_only (every coordinator/MD in the org sees
 * those, not just an assigned coordinator - see migration 144's comment on
 * worker_tags). A coordinator can also add a tag on the worker's behalf. */
/** MD-only - who this worker's dashboard/session-review/credential-alert
 * scoping is under (users.coordinator_id). Local optimistic state rather
 * than invalidating md/staff.tsx's own worker-stats fetch (a plain useEffect
 * fetch, not react-query) so the dropdown reflects the change immediately
 * without needing that page's whole list to refetch. */
function CoordinatorAssignmentSection({ worker }: { worker: WorkerStats }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { hasCapability, grantFor } = useMyAccessGrants();
  const { data: coordinators = [] } = useOrgQuery(["org-coordinators"], {
    queryFn: () =>
      getCoordinatorWorkerStats().then((list) =>
        list.filter((w) => w.role === "support_coordinator"),
      ),
  });
  const [coordinatorId, setCoordinatorId] = useState<string | null>(
    worker.coordinator_id ?? null,
  );

  const assignMutation = useMutation({
    mutationFn: (nextId: string | null) =>
      assignWorkerCoordinator(worker.id, nextId),
    onSuccess: (_, nextId) => setCoordinatorId(nextId),
    onError: (err) =>
      toast({
        title: "Could not update coordinator",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const isMD = user?.role === "managing_director";
  const viaGrant = !isMD && hasCapability("reassign_coordinator");
  if ((!isMD && !viaGrant) || worker.role !== "support_worker") return null;

  const grant = viaGrant ? grantFor("reassign_coordinator") : undefined;

  return (
    <div
      className="rounded-xl overflow-hidden border p-5"
      style={{
        background: SURFACE,
        borderColor: BORDER,
        boxShadow: CARD_SHADOW,
      }}
    >
      {grant && (
        <TemporaryAccessBanner
          grant={grant}
          label="Reassign a worker's coordinator"
        />
      )}
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        Assigned coordinator
      </p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        Who this worker's dashboard, session review, and credential alerts are
        scoped to.
      </p>
      <div className="mt-3 max-w-xs">
        <Select
          value={coordinatorId ?? "unassigned"}
          onValueChange={(value) =>
            assignMutation.mutate(value === "unassigned" ? null : value)
          }
          disabled={assignMutation.isPending}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {coordinators.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Coordinator/MD - sets a worker's SCHADS Award classification and
 * employment type, the data schads_engine.py needs to price their shifts.
 * Set manually, never derived from worker.qualifications - classification
 * reflects the duties actually performed, not the certificate on file. */
function ClassificationLevelSection({ worker }: { worker: WorkerStats }) {
  const { toast } = useToast();
  const { data: classifications = [] } = useOrgQuery(
    ["award-classifications"],
    {
      queryFn: getAwardClassifications,
    },
  );
  const [classificationId, setClassificationId] = useState<string | null>(
    worker.classification_id ?? null,
  );
  const [employmentType, setEmploymentType] = useState<string | null>(
    worker.employment_type ?? null,
  );

  const assignMutation = useMutation({
    mutationFn: (payload: {
      classification_id?: string | null;
      employment_type?: string | null;
    }) => assignWorkerClassification(worker.id, payload),
    onError: (err) =>
      toast({
        title: "Could not update classification",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  if (worker.role !== "support_worker") return null;

  return (
    <div
      className="rounded-xl overflow-hidden border p-5"
      style={{
        background: SURFACE,
        borderColor: BORDER,
        boxShadow: CARD_SHADOW,
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        SCHADS classification
      </p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        Sets the Award level and employment type used to calculate this worker's
        pay per shift.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <div className="max-w-[220px] flex-1">
          <Select
            value={classificationId ?? "unset"}
            onValueChange={(value) => {
              const next = value === "unset" ? null : value;
              setClassificationId(next);
              assignMutation.mutate({ classification_id: next });
            }}
            disabled={assignMutation.isPending}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not set</SelectItem>
              {classifications.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  SACS Level {c.level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-w-[160px] flex-1">
          <Select
            value={employmentType ?? "unset"}
            onValueChange={(value) => {
              const next = value === "unset" ? null : value;
              setEmploymentType(next);
              assignMutation.mutate({ employment_type: next });
            }}
            disabled={assignMutation.isPending}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not set</SelectItem>
              <SelectItem value="casual">Casual</SelectItem>
              <SelectItem value="part_time">Part-time</SelectItem>
              <SelectItem value="full_time">Full-time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

/** Coordinator/MD - pairs a new worker with an experienced, active worker
 * before their first shift. Suggestions come from a simple heuristic
 * (matching_opt_in workers, most recently active, same suburb favoured) —
 * the coordinator always makes the final call, same as every other match in
 * this system, so a hand-picked buddy outside the suggestion list is also
 * shown once assigned. */
function BuddyAssignmentSection({ worker }: { worker: WorkerStats }) {
  const { toast } = useToast();
  const { data: currentBuddy } = useOrgQuery(["worker-buddy", worker.id], {
    queryFn: () => getWorkerBuddy(worker.id),
  });
  const { data: suggestions = [] } = useOrgQuery(
    ["buddy-suggestions", worker.id],
    {
      queryFn: () => getBuddySuggestions(worker.id),
    },
  );

  const [buddyId, setBuddyId] = useState<string | null>(null);
  useEffect(() => {
    setBuddyId(currentBuddy?.buddy_worker_id ?? null);
  }, [currentBuddy?.buddy_worker_id]);

  const assignMutation = useMutation({
    mutationFn: (nextId: string | null) => assignWorkerBuddy(worker.id, nextId),
    onSuccess: (_, nextId) => setBuddyId(nextId),
    onError: (err) =>
      toast({
        title: "Could not update buddy",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  if (worker.role !== "support_worker") return null;

  const options = [...suggestions];
  if (
    buddyId &&
    currentBuddy?.full_name &&
    !options.some((o) => o.id === buddyId)
  ) {
    options.unshift({
      id: buddyId,
      full_name: currentBuddy.full_name,
      same_suburb: false,
    });
  }

  return (
    <div
      className="rounded-xl overflow-hidden border p-5"
      style={{
        background: SURFACE,
        borderColor: BORDER,
        boxShadow: CARD_SHADOW,
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        Buddy
      </p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        An experienced worker to help them settle in before their first shift.
      </p>
      <div className="mt-3 max-w-xs">
        <Select
          value={buddyId ?? "none"}
          onValueChange={(value) =>
            assignMutation.mutate(value === "none" ? null : value)
          }
          disabled={assignMutation.isPending}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="No buddy assigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No buddy assigned</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.full_name}
                {o.same_suburb ? " · same suburb" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function WorkerTagsSection({ workerId }: { workerId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tagsKey = ["worker-tags", workerId];
  const catalogKey = ["coordinator-tags"];

  const { data: tags = [], isLoading } = useOrgQuery(tagsKey, {
    queryFn: () => getWorkerTags(workerId),
  });
  const { data: catalog = [] } = useOrgQuery(catalogKey, {
    queryFn: getTagCatalog,
  });

  const [selectedTagId, setSelectedTagId] = useState("");

  const availableTags = (() => {
    const already = new Set(tags.map((t) => t.tag_id));
    return catalog.flatMap((category) =>
      category.tags
        .filter((t) => t.is_active && !already.has(t.id))
        .map((t) => ({ ...t, categoryName: category.name })),
    );
  })();

  // useOrgQuery scopes tagsKey's actual cache entry under [orgId, ...tagsKey], so a bare-key
  // invalidate wouldn't match it - use the predicate pattern already established elsewhere in
  // this file (DocumentsTab, TrainingTab) instead of threading orgId through here too.
  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey.includes("worker-tags"),
    });

  const addMutation = useMutation({
    mutationFn: (tagId: string) => addWorkerTag(workerId, tagId),
    onSuccess: () => {
      setSelectedTagId("");
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not add tag",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (tagId: string) => removeWorkerTag(workerId, tagId),
    onSuccess: invalidate,
    onError: (err) =>
      toast({
        title: "Could not remove tag",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  if (isLoading) return null;

  return (
    <div
      className="rounded-xl overflow-hidden border p-5"
      style={{
        background: SURFACE,
        borderColor: BORDER,
        boxShadow: CARD_SHADOW,
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        Interests & lived experience
      </p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        Self-reported by the worker (or added here) - used to suggest a
        better-fitting participant match.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <p className="text-xs italic" style={{ color: MUTED }}>
            Nothing on file yet.
          </p>
        )}
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
            style={{ borderColor: BORDER, background: SOFT, color: TEXT }}
          >
            {tag.label}
            {tag.visible_to_coordinator_only && (
              <span
                className="text-[9px] font-semibold uppercase"
                style={{ color: PLUM }}
              >
                Private
              </span>
            )}
            <button
              type="button"
              onClick={() => removeMutation.mutate(tag.tag_id)}
              aria-label={`Remove ${tag.label}`}
              className="opacity-60 hover:opacity-100"
            >
              <XIcon size={11} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <select
          title="Add a tag"
          value={selectedTagId}
          onChange={(event) => setSelectedTagId(event.target.value)}
          className="h-8 flex-1 rounded-lg border px-2 text-xs"
          style={{ borderColor: BORDER }}
        >
          <option value="">Add an interest...</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.categoryName} · {tag.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedTagId || addMutation.isPending}
          onClick={() => selectedTagId && addMutation.mutate(selectedTagId)}
          className="rounded-lg px-3 text-xs font-bold text-white disabled:opacity-50"
          style={{ background: PLUM }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function documentTypeLabel(
  type: WorkerOnboardingDocumentType,
  translate: (k: string) => string,
): string {
  return translate(
    `team.documents.type.${type}` as "team.documents.type.other",
  );
}

function DocumentsTab({
  worker,
  translate,
}: {
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  const documentsQuery = useOrgQuery(
    ["worker-onboarding-documents", worker.id],
    {
      queryFn: () => getWorkerOnboardingDocuments(worker.id),
    },
  );
  const documents = documentsQuery.data ?? [];
  const visibleDocuments = documents.filter((doc) =>
    [doc.title, doc.notes, documentTypeLabel(doc.document_type, translate)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWorkerOnboardingDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.includes("worker-onboarding-documents"),
      });
      toast({ title: translate("team.documents.removed") });
    },
    onError: () =>
      toast({
        title: translate("team.documents.saveFailed"),
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-4">
      {/* Summary strip — same pattern as every other tab. No "expiring within 30 days" count:
          these documents (offer letters, references, correspondence) have no expiry concept in
          this data model at all, not just none set, so that clause never applies here. */}
      <div
        className="flex items-center justify-between gap-3 rounded-xl px-5 py-4"
        style={{ background: SOFT, color: TEXT }}
      >
        <div>
          <p className="text-lg font-semibold">
            {documentsQuery.isLoading
              ? "Loading documents"
              : documentsQuery.isError
                ? "Documents unavailable"
                : `${documents.length} document${documents.length !== 1 ? "s" : ""}`}
          </p>
          <p className="text-xs font-bold mt-0.5" style={{ color: MUTED }}>
            General storage: offer letters, references, correspondence
          </p>
        </div>
        <FileText size={22} style={{ color: MUTED }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText size={16} style={{ color: PLUM }} />
          <p className="text-sm font-semibold" style={{ color: TEXT }}>
            {translate("team.documents.title")}
          </p>
        </div>
        <Button
          variant="navy"
          size="sm"
          className="gap-1.5 rounded-xl"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={13} /> {translate("team.documents.add")}
        </Button>
      </div>

      {documents.length > 0 && (
        <div className="space-y-2">
          <label
            htmlFor="worker-document-search"
            className="text-sm font-medium text-cc-text"
          >
            Find a document
          </label>
          <Input
            id="worker-document-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, type or notes"
          />
          <p role="status" className="text-xs text-cc-muted">
            {visibleDocuments.length} of {documents.length} documents
          </p>
        </div>
      )}
      {documents.length > 0 && visibleDocuments.length === 0 && (
        <p className="rounded-xl border border-cc-border p-5 text-sm text-cc-muted">
          No matching documents. Try another search.
        </p>
      )}
      {documentsQuery.isLoading && (
        <p className="text-sm" style={{ color: MUTED }}>
          {translate("common.loading")}
        </p>
      )}

      {documentsQuery.isError && (
        <div
          role="alert"
          className="rounded-xl border border-cc-border p-4 text-sm text-cc-text"
        >
          Documents could not be loaded.
          <Button
            variant="outline"
            className="ml-2"
            onClick={() => void documentsQuery.refetch()}
          >
            Retry documents
          </Button>
        </div>
      )}
      {!documentsQuery.isLoading &&
        !documentsQuery.isError &&
        documents.length === 0 && (
          <div
            className="rounded-xl p-8 text-center border"
            style={{
              background: SURFACE,
              borderColor: BORDER,
              boxShadow: CARD_SHADOW,
            }}
          >
            <FileText
              size={28}
              className="mx-auto mb-2"
              style={{ color: MUTED }}
            />
            <p className="text-sm font-bold" style={{ color: MUTED }}>
              {translate("team.documents.empty")}
            </p>
            <Button
              variant="navy"
              size="sm"
              className="mt-4 gap-1.5 rounded-xl"
              onClick={() => setAddOpen(true)}
            >
              <Plus size={13} /> {translate("team.documents.add")}
            </Button>
          </div>
        )}

      {documents.length > 0 && (
        <div
          className="rounded-xl divide-y border"
          style={{
            background: SURFACE,
            boxShadow: CARD_SHADOW,
            borderColor: BORDER,
          }}
        >
          {visibleDocuments.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5"
            >
              <div className="min-w-0 flex items-start gap-3">
                <div
                  className="h-9 w-9 rounded-xl shrink-0 flex items-center justify-center"
                  style={{ background: SOFT }}
                >
                  <FileText size={15} style={{ color: PLUM }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: TEXT }}>
                      {doc.title}
                    </p>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: SOFT, color: PLUM }}
                    >
                      {documentTypeLabel(doc.document_type, translate)}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                    {translate("team.documents.uploadedOn")}{" "}
                    {safeFormat(doc.created_at)}
                    {doc.uploaded_by && doc.uploaded_by === user?.id
                      ? " · Uploaded by you"
                      : ""}
                    {doc.notes ? ` · ${doc.notes}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {doc.file_url ? (
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    title={translate("team.documents.download")}
                    aria-label={translate("team.documents.download")}
                  >
                    <Download size={14} style={{ color: PLUM }} />
                  </a>
                ) : null}
                <button
                  onClick={() => {
                    if (
                      window.confirm(translate("team.documents.removeConfirm"))
                    )
                      deleteMut.mutate(doc.id);
                  }}
                  className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  title={translate("team.documents.remove")}
                  aria-label={translate("team.documents.remove")}
                >
                  <Trash2 size={14} style={{ color: MUTED }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddDocumentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        worker={worker}
        translate={translate}
      />
    </div>
  );
}

function AddDocumentDialog({
  open,
  onOpenChange,
  worker,
  translate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [docType, setDocType] =
    useState<WorkerOnboardingDocumentType>("offer_letter");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const saveMut = useMutation({
    mutationFn: () =>
      uploadWorkerOnboardingDocument(worker.id, {
        document_type: docType,
        title: title.trim(),
        notes: notes.trim() || undefined,
        file: file || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.includes("worker-onboarding-documents"),
      });
      toast({ title: translate("team.documents.saved") });
      onOpenChange(false);
      setDocType("offer_letter");
      setTitle("");
      setNotes("");
      setFile(null);
    },
    onError: () =>
      toast({
        title: translate("team.documents.saveFailed"),
        variant: "destructive",
      }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
        style={{ background: SURFACE }}
      >
        <SheetHeader>
          <SheetTitle
            className="flex items-center gap-2"
            style={{ color: TEXT }}
          >
            <FileText size={18} style={{ color: PLUM }} />{" "}
            {translate("team.documents.dialogTitle").replace(
              "{name}",
              worker.full_name,
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              {translate("team.documents.docType")}
            </label>
            <Select
              value={docType}
              onValueChange={(v) =>
                setDocType(v as WorkerOnboardingDocumentType)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="offer_letter">
                  {translate("team.documents.type.offer_letter")}
                </SelectItem>
                <SelectItem value="service_agreement">
                  {translate("team.documents.type.service_agreement")}
                </SelectItem>
                <SelectItem value="other">
                  {translate("team.documents.type.other")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              {translate("team.documents.docTitle")}
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={translate("team.documents.docTitlePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              {translate("team.documents.notes")}
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={translate("team.documents.notesPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              {translate("team.documents.file")}
            </label>
            {/* Same drag-and-drop widget already built for medication documents
                (ParticipantMedicationsPanel), reused here instead of a third upload pattern. */}
            <FileDropzone
              accept="application/pdf,image/jpeg,image/png"
              maxSizeBytes={10 * 1024 * 1024}
              onFile={setFile}
              onRejected={(reason) =>
                toast({ title: reason, variant: "destructive" })
              }
              label={file ? file.name : "Drag a file here, or click to browse"}
              hint={file ? undefined : "PDF, JPEG or PNG, up to 10MB"}
            />
          </div>
        </div>

        <SheetFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate("common.cancel")}
          </Button>
          <Button
            variant="navy"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title.trim()}
          >
            {saveMut.isPending
              ? translate("common.saving")
              : translate("team.documents.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function CredentialsTab({
  credentials,
  isLoading,
  credentialsCompleteCount,
  focusCredentialType,
  topReason,
  translate,
}: {
  credentials: Credential[];
  isLoading: boolean;
  credentialsCompleteCount: number;
  /** Set when arriving here via a specific Next Steps row (e.g. "Working With Children Check")
   * rather than the tab in general — scrolls that row into view and briefly highlights it. */
  focusCredentialType?: string | null;
  /** Same value shown on Overview — the fact carries over onto this tab's strip instead of
   * resetting to a locally-recomputed (and possibly different) reason. */
  topReason: TopReason;
  translate: (k: string) => string;
}) {
  const [attentionOnly, setAttentionOnly] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { requireReAuth, modal } = useReAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const byType = new Map(credentials.map((c) => [c.credential_type, c]));
  const rows = REQUIRED_CREDENTIAL_TYPES.map((type) => ({
    type,
    credential: byType.get(type) ?? null,
  }));
  const extras = credentials.filter(
    (c) => !REQUIRED_CREDENTIAL_TYPES.includes(c.credential_type),
  );
  const allRows = [
    ...rows,
    ...extras.map((c) => ({ type: c.credential_type, credential: c })),
  ];
  const needsAttention = (credential: Credential | null) =>
    !credential ||
    credential.status !== "valid" ||
    (credential.credential_type === "ndis_screening" &&
      isScreeningRecheckDue(credential));
  const visibleRows = attentionOnly
    ? allRows.filter((row) => needsAttention(row.credential))
    : allRows;
  const total = REQUIRED_CREDENTIAL_TYPES.length;
  const complete = credentialsCompleteCount >= total;

  useEffect(() => {
    if (!focusCredentialType) return;
    setAttentionOnly(false);
    const el = document.getElementById(`cred-row-${focusCredentialType}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCredentialType]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: [orgId, "team-credentials"] });

  const reviewMutation = useMutation({
    mutationFn: ({
      credential,
      status,
    }: {
      credential: Credential;
      status: "valid" | "rejected";
    }) => requireReAuth(() => reviewCredential(credential.id, { status })),
    onSuccess: () => {
      invalidate();
      toast({ title: "Credential review saved" });
    },
    onError: (err) =>
      toast({
        title: "Review failed",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const recheckMutation = useMutation({
    mutationFn: (credential: Credential) =>
      requireReAuth(() =>
        reviewCredential(credential.id, {
          status: "valid",
          last_checked_against_nwsd: new Date().toISOString().slice(0, 10),
        }),
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Recorded as rechecked on the NDIS Commission portal" });
    },
    onError: (err) =>
      toast({
        title: "Could not record recheck",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return (
      <p className="text-sm" style={{ color: MUTED }}>
        {translate("common.loading")}
      </p>
    );
  }

  // Strip colour follows the same carried-over topReason as Overview and Training, not a
  // locally-recomputed complete/incomplete framing — if training overdue outranks credentials
  // as the true top blocker, this strip says so too instead of quietly disagreeing.
  const stripLevel: ReadinessLevel = topReason?.level ?? "good";
  const stripBg =
    stripLevel === "good"
      ? "var(--cc-status-success-bg)"
      : stripLevel === "warning"
        ? "var(--cc-status-warning-bg)"
        : "var(--cc-status-danger-bg)";
  const stripColor =
    stripLevel === "good"
      ? "var(--cc-status-success)"
      : stripLevel === "warning"
        ? "var(--cc-status-warning)"
        : "var(--cc-status-danger)";

  return (
    <div className="space-y-4">
      {modal}
      <div
        className="flex items-center justify-between gap-3 rounded-xl px-5 py-4"
        style={{ background: stripBg, color: stripColor }}
      >
        <div>
          <p className="text-lg font-semibold">
            {credentialsCompleteCount} / {total} complete
          </p>
          <p className="text-xs font-bold mt-0.5">
            {topReason
              ? topReason.label
              : translate("team.detail.credentialsComplete")}
          </p>
        </div>
        {stripLevel === "good" ? (
          <CheckCircle2 size={22} />
        ) : (
          <AlertTriangle size={22} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-cc-text">
          <input
            type="checkbox"
            checked={attentionOnly}
            onChange={(event) => setAttentionOnly(event.target.checked)}
            className="h-4 w-4 accent-[var(--cc-plum)]"
          />
          Needs attention (
          {allRows.filter((row) => needsAttention(row.credential)).length})
        </label>
        <p role="status" className="text-xs text-cc-muted">
          {visibleRows.length} of {allRows.length} credentials
        </p>
      </div>
      {attentionOnly && visibleRows.length === 0 && (
        <p className="rounded-xl border border-cc-border p-4 text-sm text-cc-muted">
          No credentials need attention.
        </p>
      )}
      <div
        className="rounded-xl divide-y border"
        style={{
          background: SURFACE,
          boxShadow: CARD_SHADOW,
          borderColor: BORDER,
        }}
      >
        {visibleRows.map(({ type, credential }, i) => {
          const style = statusStyle(credential?.status ?? "missing");
          const { Icon } = style;
          const reviewable = !!credential && credential.status !== "valid";
          // Include "expiring" — isScreeningRecheckDue flags a recheck as due
          // starting at the same 60-day-to-expiry mark that flips a
          // credential's status from "valid" to "expiring" (see
          // _status_for in credentials.py), so requiring strictly "valid"
          // here made the action disappear right when it becomes needed.
          const canRecheck =
            !!credential &&
            type === "ndis_screening" &&
            (credential.status === "valid" || credential.status === "expiring");
          const recheckDue =
            !!credential &&
            type === "ndis_screening" &&
            isScreeningRecheckDue(credential);
          const focused = focusCredentialType === type;
          return (
            <div
              key={`${type}-${i}`}
              id={`cred-row-${type}`}
              className="flex flex-col gap-3 px-5 py-4 xl:flex-row xl:items-center transition-colors"
              style={
                focused
                  ? {
                      background: "var(--cc-status-info-bg)",
                      boxShadow: "inset 3px 0 0 var(--cc-status-info)",
                    }
                  : undefined
              }
            >
              {/* Status dot + name */}
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: style.color }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: TEXT }}>
                  {credentialLabel(type)}
                </p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                  {credential
                    ? [
                        credential.credential_number
                          ? `#${credential.credential_number}`
                          : null,
                        credential.issuer,
                        credential.expiry_date
                          ? `Expires ${safeFormat(credential.expiry_date)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || translate("team.detail.onFile")
                    : translate("team.detail.notOnFile")}
                </p>
                {type === "ndis_screening" && credential && (
                  <p
                    className="text-xs mt-0.5 font-semibold"
                    style={{
                      color: recheckDue ? "var(--cc-status-warning)" : MUTED,
                    }}
                  >
                    {credential.screening_number
                      ? `Screening #: ${credential.screening_number} · `
                      : ""}
                    {credential.last_checked_against_nwsd
                      ? `Last checked on NDIS Commission portal: ${safeFormat(credential.last_checked_against_nwsd)}`
                      : "Not yet checked on the NDIS Commission portal"}
                    {recheckDue ? " · Recheck due" : ""}
                  </p>
                )}
              </div>
              {/* Right-aligned action: expiry date if complete, a status badge if awaiting review
                or otherwise not simply missing, nothing manufactured if missing entirely — this
                app doesn't let coordinators upload on a worker's behalf, so no fake "Upload"
                control pretending that's possible. */}
              <div className="flex flex-wrap items-center gap-2">
                {credential?.status === "valid" ? (
                  <span
                    className="text-xs font-semibold"
                    style={{ color: MUTED }}
                  >
                    {credential.expiry_date
                      ? `Expires ${safeFormat(credential.expiry_date)}`
                      : translate("team.detail.onFile")}
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full"
                    style={{ background: style.bg, color: style.color }}
                  >
                    <Icon size={12} /> {style.label}
                  </span>
                )}
                {reviewable && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() =>
                        reviewMutation.mutate({
                          credential: credential!,
                          status: "valid",
                        })
                      }
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Verify
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      style={{ color: CORAL }}
                      onClick={() =>
                        reviewMutation.mutate({
                          credential: credential!,
                          status: "rejected",
                        })
                      }
                    >
                      Reject
                    </Button>
                  </>
                )}
                {canRecheck && (
                  <Button
                    variant={recheckDue ? "outline" : "ghost"}
                    size="sm"
                    className="gap-1"
                    style={{ color: CORAL }}
                    onClick={() => recheckMutation.mutate(credential!)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Mark rechecked
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function completionStatusStyle(status: string) {
  switch (status) {
    case "confirmed":
      return {
        bg: "var(--cc-status-success-bg)",
        color: "var(--cc-status-success)",
        label: "Completed",
      };
    case "awaiting_confirmation":
      return {
        bg: "var(--cc-status-warning-bg)",
        color: "var(--cc-status-warning)",
        label: "Awaiting review",
      };
    case "rejected":
      return {
        bg: "var(--cc-status-danger-bg)",
        color: "var(--cc-status-danger)",
        label: "Rejected",
      };
    default:
      return { bg: SOFT, color: MUTED, label: status };
  }
}

function TrainingTab({
  worker,
  topReason,
  translate,
}: {
  worker: WorkerStats;
  /** Same value shown on Overview and Credentials — carried over, not recomputed. */
  topReason: TopReason;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState<
    Record<string, string>
  >({});

  const assignmentsQuery = useOrgQuery(
    ["worker-training-assignments", worker.id],
    {
      queryFn: () => getWorkerTrainingAssignments(worker.id),
    },
  );

  const dismissMut = useMutation({
    mutationFn: (id: string) => dismissTrainingAssignment(id),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.includes("worker-training-assignments"),
      });
      toast({ title: "Assignment removed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not remove assignment",
        description: error.message,
        variant: "destructive",
      }),
  });

  const reviewMut = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      reviewTrainingCompletion(
        id,
        approved,
        approved ? undefined : revisionFeedback[id]?.trim(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.includes("worker-training-assignments"),
      });
      toast({ title: "Training completion reviewed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not review completion",
        description: error.message,
        variant: "destructive",
      }),
  });

  const recommendations = assignmentsQuery.data?.recommendations ?? [];
  const history = assignmentsQuery.data?.history ?? [];
  const completedModuleIds = new Set(
    history
      .filter(
        (h) => h.status === "confirmed" || h.status === "awaiting_confirmation",
      )
      .map((h) => h.module_id),
  );

  // Overdue first, then soonest-due, then no-due-date last — a coordinator scanning this tab
  // should see what's overdue immediately, not have to search for it among upcoming modules.
  const now = Date.now();
  const inProgress = recommendations
    .filter((r) => !completedModuleIds.has(r.training_module_id))
    .map((r) => ({
      ...r,
      overdue: !!r.due_at && new Date(r.due_at).getTime() < now,
    }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.due_at && b.due_at)
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return 0;
    });
  const overdueCount = inProgress.filter((r) => r.overdue).length;

  return (
    <div className="space-y-4">
      {!assignmentsQuery.isLoading && !assignmentsQuery.isError && (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "In progress", value: inProgress.length },
            { label: "Overdue", value: overdueCount },
            {
              label: "Awaiting review",
              value: history.filter(
                (item) => item.status === "awaiting_confirmation",
              ).length,
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-xl border border-cc-border bg-[var(--cc-surface)] px-4 py-3"
            >
              <dt className="text-xs text-cc-muted">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-cc-text">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!assignmentsQuery.isLoading &&
        !assignmentsQuery.isError &&
        overdueCount > 0 && (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            Some assigned training is overdue. Review the deadlines below.
          </p>
        )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} style={{ color: PLUM }} />
          <p className="text-sm font-semibold" style={{ color: TEXT }}>
            {translate("team.training.title")}
          </p>
        </div>
        <Button
          variant="navy"
          size="sm"
          className="gap-1.5 rounded-xl"
          onClick={() => setAssignOpen(true)}
        >
          <Plus size={13} /> {translate("team.training.assign")}
        </Button>
      </div>

      {assignmentsQuery.isLoading && (
        <p className="text-sm" style={{ color: MUTED }}>
          {translate("common.loading")}
        </p>
      )}

      {assignmentsQuery.isError && (
        <p role="alert" className="text-sm">
          Unable to load training.{" "}
          <button
            onClick={() => void assignmentsQuery.refetch()}
            className="underline"
          >
            Try again
          </button>
        </p>
      )}
      {!assignmentsQuery.isLoading &&
        !assignmentsQuery.isError &&
        recommendations.length === 0 &&
        history.length === 0 && (
          <div
            className="rounded-xl p-8 text-center border"
            style={{
              background: SURFACE,
              borderColor: BORDER,
              boxShadow: CARD_SHADOW,
            }}
          >
            <GraduationCap
              size={28}
              className="mx-auto mb-2"
              style={{ color: MUTED }}
            />
            <p className="text-sm font-bold" style={{ color: MUTED }}>
              {translate("team.training.empty")}
            </p>
          </div>
        )}

      {inProgress.length > 0 && (
        <div
          className="rounded-xl divide-y border"
          style={{
            background: SURFACE,
            boxShadow: CARD_SHADOW,
            borderColor: BORDER,
          }}
        >
          {inProgress.map((rec) => (
            <div
              key={rec.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <IconBadge
                icon={GraduationCap}
                color={
                  rec.overdue
                    ? "var(--cc-status-danger)"
                    : "var(--cc-status-info)"
                }
                bg={
                  rec.overdue
                    ? "var(--cc-status-danger-bg)"
                    : "var(--cc-status-info-bg)"
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: TEXT }}>
                  {rec.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                  {translate("team.training.assignedOn")}{" "}
                  {safeFormat(rec.recommended_at)}
                  {rec.due_at ? ` · Due ${safeFormat(rec.due_at)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{
                    background: rec.overdue
                      ? "var(--cc-status-danger-bg)"
                      : "var(--cc-status-info-bg)",
                    color: rec.overdue
                      ? "var(--cc-status-danger)"
                      : "var(--cc-status-info)",
                  }}
                >
                  {rec.overdue
                    ? "Overdue"
                    : translate("team.training.inProgress")}
                </span>
                <button
                  disabled={dismissMut.isPending}
                  onClick={() => dismissMut.mutate(rec.id)}
                  className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  title={translate("team.training.remove")}
                  aria-label={translate("team.training.remove")}
                >
                  <XIcon size={13} style={{ color: MUTED }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-2"
            style={{ color: MUTED }}
          >
            {translate("team.training.history")}
          </p>
          <div
            className="rounded-xl divide-y border"
            style={{
              background: SURFACE,
              boxShadow: CARD_SHADOW,
              borderColor: BORDER,
            }}
          >
            {history.map((h) => {
              const style = completionStatusStyle(h.status);
              return (
                <div
                  key={h.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <IconBadge
                    icon={GraduationCap}
                    color={style.color}
                    bg={style.bg}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold" style={{ color: TEXT }}>
                      {h.training_modules?.title ??
                        translate("team.training.module")}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                      {translate("team.training.completedOn")}{" "}
                      {safeFormat(h.completed_at)}
                    </p>
                    {h.note && (
                      <p
                        className="text-xs mt-0.5 italic"
                        style={{ color: MUTED }}
                      >
                        "{h.note}"
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {h.status === "awaiting_confirmation" ? (
                      <>
                        <input
                          aria-label={`Revision feedback for ${h.training_modules?.title ?? "training"}`}
                          placeholder="Feedback for revision"
                          value={revisionFeedback[h.id] ?? ""}
                          onChange={(e) =>
                            setRevisionFeedback((prev) => ({
                              ...prev,
                              [h.id]: e.target.value,
                            }))
                          }
                          className="h-9 min-w-0 rounded-lg border bg-background px-3 text-xs"
                        />
                        <Button
                          disabled={reviewMut.isPending}
                          size="sm"
                          variant="outline"
                          className="text-xs gap-1 text-green-700 border-green-200 hover:bg-green-50"
                          onClick={() =>
                            reviewMut.mutate({ id: h.id, approved: true })
                          }
                        >
                          <Check size={12} />{" "}
                          {translate("team.training.approve")}
                        </Button>
                        <Button
                          disabled={
                            reviewMut.isPending ||
                            !revisionFeedback[h.id]?.trim()
                          }
                          size="sm"
                          variant="outline"
                          className="text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() =>
                            reviewMut.mutate({ id: h.id, approved: false })
                          }
                        >
                          <XIcon size={12} />{" "}
                          {translate("team.training.reject")}
                        </Button>
                      </>
                    ) : (
                      <span
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                        style={{ background: style.bg, color: style.color }}
                      >
                        {style.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AssignTrainingDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        worker={worker}
        translate={translate}
      />
    </div>
  );
}

/** One-time first-day checklist, distinct from ongoing TrainingTab — read-only
 * here (the worker ticks items off themselves), no assign/dismiss/review
 * actions since induction has no coordinator-review workflow. */
function InductionTab({
  worker,
  translate,
}: {
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const progressQuery = useOrgQuery(["worker-induction", worker.id], {
    queryFn: () => getWorkerInduction(worker.id),
  });

  const items = [...(progressQuery.data?.items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const mandatoryTotal = progressQuery.data?.mandatory_total ?? 0;
  const mandatoryComplete = progressQuery.data?.mandatory_complete ?? 0;
  const allDone = mandatoryTotal > 0 && mandatoryComplete >= mandatoryTotal;
  const stripBg =
    mandatoryTotal === 0
      ? SOFT
      : allDone
        ? "var(--cc-status-success-bg)"
        : "var(--cc-status-warning-bg)";
  const stripColor =
    mandatoryTotal === 0
      ? MUTED
      : allDone
        ? "var(--cc-status-success)"
        : "var(--cc-status-warning)";

  return (
    <div className="space-y-4">
      <div
        className="flex items-center justify-between gap-3 rounded-xl px-5 py-4"
        style={{ background: stripBg, color: stripColor }}
      >
        <div>
          <p className="text-lg font-semibold">
            {progressQuery.isLoading
              ? "Loading induction"
              : progressQuery.isError
                ? "Induction unavailable"
                : `${mandatoryComplete} / ${mandatoryTotal} mandatory complete`}
          </p>
          <p className="text-xs font-bold mt-0.5">
            {progressQuery.isLoading || progressQuery.isError
              ? "Progress will appear when the checklist is available"
              : mandatoryTotal === 0
                ? "No induction items set up yet"
                : allDone
                  ? "Induction complete"
                  : "Induction in progress"}
          </p>
        </div>
        {allDone ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
      </div>

      {progressQuery.isLoading && (
        <p className="text-sm" style={{ color: MUTED }}>
          {translate("common.loading")}
        </p>
      )}

      {progressQuery.isError && (
        <div
          role="alert"
          className="rounded-xl border border-cc-border p-4 text-sm text-cc-text"
        >
          Induction progress could not be loaded.
          <Button
            variant="outline"
            className="ml-2"
            onClick={() => void progressQuery.refetch()}
          >
            Retry induction
          </Button>
        </div>
      )}
      {!progressQuery.isLoading &&
        !progressQuery.isError &&
        items.length === 0 && (
          <div
            className="rounded-xl p-8 text-center border"
            style={{
              background: SURFACE,
              borderColor: BORDER,
              boxShadow: CARD_SHADOW,
            }}
          >
            <ClipboardCheck
              size={28}
              className="mx-auto mb-2"
              style={{ color: MUTED }}
            />
            <p className="text-sm font-bold" style={{ color: MUTED }}>
              No induction items configured for this organisation yet.
            </p>
          </div>
        )}

      {items.length > 0 && (
        <div
          className="rounded-xl divide-y border"
          style={{
            background: SURFACE,
            boxShadow: CARD_SHADOW,
            borderColor: BORDER,
          }}
        >
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-5 py-4">
              <IconBadge
                icon={ClipboardCheck}
                color={
                  item.completed_at
                    ? "var(--cc-status-success)"
                    : "var(--cc-status-warning)"
                }
                bg={
                  item.completed_at
                    ? "var(--cc-status-success-bg)"
                    : "var(--cc-status-warning-bg)"
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: TEXT }}>
                  {item.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                  {item.completed_at
                    ? "Completed"
                    : item.is_mandatory
                      ? "Mandatory, not yet completed"
                      : "Optional"}
                </p>
              </div>
              {item.completed_at ? (
                <CheckCircle2
                  size={16}
                  style={{ color: "var(--cc-status-success)" }}
                />
              ) : !item.is_mandatory ? (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: SOFT, color: MUTED }}
                >
                  Optional
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function complianceBandColor(band: string | undefined) {
  if (band === "green")
    return {
      color: "var(--cc-status-success)",
      bg: "var(--cc-status-success-bg)",
    };
  if (band === "amber")
    return {
      color: "var(--cc-status-warning)",
      bg: "var(--cc-status-warning-bg)",
    };
  if (band === "red")
    return {
      color: "var(--cc-status-danger)",
      bg: "var(--cc-status-danger-bg)",
    };
  return { color: MUTED, bg: SOFT };
}

function ShiftsTab({
  worker,
  translate,
}: {
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const historyQuery = useOrgQuery(["worker-shift-history", worker.id], {
    queryFn: () => getWorkerShiftHistory(worker.id),
  });
  const dashboardQuery = useOrgQuery(
    ["worker-performance-dashboard", worker.id],
    {
      queryFn: () => getWorkerPerformanceDashboard(worker.id),
    },
  );
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);

  const shifts = historyQuery.data?.shifts ?? [];
  const dashboard = dashboardQuery.data;
  const openShift = openShiftId
    ? (shifts.find((s) => s.id === openShiftId) ?? null)
    : null;

  return (
    <div className="space-y-4">
      {dashboardQuery.isError && (
        <ProfileLoadError
          label="Performance summary"
          retry={() => void dashboardQuery.refetch()}
        />
      )}
      {/* Performance breakdown - the detail behind a single compliance number */}
      <div
        className="rounded-xl border p-5"
        style={{
          background: SURFACE,
          borderColor: BORDER,
          boxShadow: CARD_SHADOW,
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: MUTED }}
            >
              Last 30 days
            </p>
            <p className="mt-1 text-2xl font-semibold" style={{ color: TEXT }}>
              {dashboard?.average_score_30d != null
                ? `${Math.round(dashboard.average_score_30d)}%`
                : "N/A"}
            </p>
          </div>
          {dashboard?.trend && (
            <div className="text-right">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold"
                style={complianceBandColor(dashboard.compliance_band)}
              >
                <TrendingUp
                  size={11}
                  style={{
                    transform:
                      dashboard.trend.direction === "down"
                        ? "scaleY(-1)"
                        : undefined,
                  }}
                />
                {dashboard.trend.direction === "up"
                  ? "Improving"
                  : dashboard.trend.direction === "down"
                    ? "Declining"
                    : "Steady"}
              </span>
            </div>
          )}
        </div>
        {dashboard?.trend?.sentence && (
          <p className="mt-2 text-xs" style={{ color: MUTED }}>
            {dashboard.trend.sentence}
          </p>
        )}

        {(!!dashboard?.strengths?.length ||
          !!dashboard?.focus_areas?.length) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {!!dashboard?.strengths?.length && (
              <div>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: "var(--cc-status-success)" }}
                >
                  Strengths
                </p>
                <ul className="mt-1.5 space-y-1">
                  {dashboard.strengths.map((s) => (
                    <li
                      key={s.label}
                      className="text-xs"
                      style={{ color: TEXT }}
                    >
                      {s.label}{" "}
                      <span style={{ color: MUTED }}>({s.count})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!dashboard?.focus_areas?.length && (
              <div>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: "var(--cc-status-warning)" }}
                >
                  Focus areas
                </p>
                <ul className="mt-1.5 space-y-1">
                  {dashboard.focus_areas.map((s) => (
                    <li
                      key={s.label}
                      className="text-xs"
                      style={{ color: TEXT }}
                    >
                      {s.label}{" "}
                      <span style={{ color: MUTED }}>({s.count})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!!dashboard?.badges?.some((b) => b.unlocked) && (
          <div
            className="mt-4 flex flex-wrap gap-1.5 border-t pt-3"
            style={{ borderColor: BORDER }}
          >
            {dashboard.badges
              .filter((b) => b.unlocked)
              .map((b) => (
                <span
                  key={b.key}
                  title={b.description}
                  className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: "var(--cc-plum-soft)", color: PLUM }}
                >
                  {b.title}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Shift-by-shift history */}
      <div
        className="rounded-xl border"
        style={{
          background: SURFACE,
          borderColor: BORDER,
          boxShadow: CARD_SHADOW,
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: BORDER }}
        >
          <p className="text-sm font-semibold" style={{ color: TEXT }}>
            Completed shifts
          </p>
          <span className="text-xs font-bold" style={{ color: MUTED }}>
            {historyQuery.isLoading || historyQuery.isError
              ? "Not available"
              : shifts.length}
          </span>
        </div>
        {historyQuery.isLoading ? (
          <p className="px-5 py-6 text-sm" style={{ color: MUTED }}>
            {translate("common.loading")}
          </p>
        ) : historyQuery.isError ? (
          <ProfileLoadError
            label="Shift history"
            retry={() => void historyQuery.refetch()}
          />
        ) : shifts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-center" style={{ color: MUTED }}>
            No completed shifts on file yet.
          </p>
        ) : (
          <ShiftHistoryList shifts={shifts} onOpenShift={setOpenShiftId} />
        )}
      </div>

      {/* Per-shift audit trail - a side panel rather than an inline dropdown,
          so a shift with a lot to show (incidents, flagged tasks, notes) gets
          real room instead of squeezing into an expanding row. */}
      <Sheet
        open={!!openShift}
        onOpenChange={(open) => {
          if (!open) setOpenShiftId(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl [&>button]:z-20 [&>button]:flex [&>button]:h-10 [&>button]:w-10 [&>button]:items-center [&>button]:justify-center"
          style={{ background: SURFACE }}
        >
          {openShift && (
            <ShiftAuditPanel
              key={openShift.id}
              workerId={worker.id}
              shift={openShift}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Worker-Participant Matching Enhancement, Phase 3 — the first completed
 * shift for each participant this worker has worked with gets a "First
 * shift" badge, prompting the coordinator toward the light-touch check-in
 * the design spec calls for on new pairings. Computed client-side from the
 * already-fetched shift list rather than a new backend field. */
function ShiftHistoryList({
  shifts,
  onOpenShift,
}: {
  shifts: ShiftHistoryRow[];
  onOpenShift: (id: string) => void;
}) {
  const firstPairingShiftIds = useMemo(() => {
    const earliestByParticipant = new Map<
      string,
      { id: string; time: number }
    >();
    for (const s of shifts) {
      if (!s.participant_id || !s.scheduled_start) continue;
      const time = new Date(s.scheduled_start).getTime();
      const current = earliestByParticipant.get(s.participant_id);
      if (!current || time < current.time)
        earliestByParticipant.set(s.participant_id, { id: s.id, time });
    }
    return new Set(Array.from(earliestByParticipant.values()).map((v) => v.id));
  }, [shifts]);

  return (
    <div className="divide-y" style={{ borderColor: BORDER }}>
      {shifts.slice(0, 30).map((s) => (
        <ShiftHistoryRowItem
          key={s.id}
          shift={s}
          isFirstPairing={firstPairingShiftIds.has(s.id)}
          onOpen={() => onOpenShift(s.id)}
        />
      ))}
    </div>
  );
}

/** clocked_in_at/clocked_out_at when available (what actually happened),
 * falling back to scheduled_start/end - a completed shift almost always has
 * the real clock times, but older/backfilled rows may not. */
function formatShiftTimeRange(s: ShiftHistoryRow): string | null {
  const start = s.clocked_in_at || s.scheduled_start;
  const end = s.clocked_out_at || s.scheduled_end;
  if (!start || !end) return null;
  const startLabel = safeFormat(start, "h:mm a");
  const endLabel = safeFormat(end, "h:mm a");
  if (!startLabel || !endLabel) return null;
  return `${startLabel} – ${endLabel}`;
}

/** A plain summary row - clicking it opens the full audit trail as a side
 * panel (ShiftAuditPanel) rather than expanding inline, so incidents,
 * flagged tasks, and notes all get proper room instead of a cramped dropdown. */
function ShiftHistoryRowItem({
  shift: s,
  isFirstPairing,
  onOpen,
}: {
  shift: ShiftHistoryRow;
  isFirstPairing: boolean;
  onOpen: () => void;
}) {
  const band = complianceBandColor(s.compliance_band);
  const timeRange = formatShiftTimeRange(s);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-black/[0.02]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-bold truncate" style={{ color: TEXT }}>
            {s.participant_name || "Participant"}
          </p>
          {isFirstPairing && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
              style={{ background: "var(--cc-plum-soft)", color: PLUM }}
            >
              First shift
            </span>
          )}
        </div>
        <p className="text-xs mt-0.5" style={{ color: MUTED }}>
          {safeFormat(s.scheduled_start, "d MMM yyyy")}
          {timeRange ? ` · ${timeRange}` : ""}
          {s.duration_minutes
            ? ` · ${Math.round((s.duration_minutes / 60) * 10) / 10}h`
            : ""}
        </p>
        {s.compliance_explanation && (
          <p className="mt-1 text-xs truncate" style={{ color: MUTED }}>
            {s.compliance_explanation}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="rounded-full px-2 py-1 text-[10px] font-semibold"
          style={band}
        >
          {s.compliance_score != null
            ? `${Math.round(s.compliance_score)}%`
            : s.compliance_band}
        </span>
        <ChevronRight size={14} style={{ color: MUTED }} />
      </div>
    </button>
  );
}

const FLAG_TYPE_LABEL: Record<string, string> = {
  no_evidence: "completed without evidence",
  incomplete: "not completed",
  low_compliance: "low overall compliance",
};

type ShiftIncidentSummary = {
  id: string;
  title?: string | null;
  description?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  status?: string | null;
  worker_actions?: string | null;
  corrective_actions?: string | null;
  incident_date?: string | null;
  resolved_date?: string | null;
  ndis_reportable?: boolean | null;
};

/** Full per-shift audit trail, opened as a side panel: outcome/score,
 * incidents reported during this shift (what happened, action taken, when),
 * flagged tasks, what went well, shift notes, and coordinator feedback. This
 * is the "what did they actually do" view behind a single shift's score. */
export function ShiftAuditPanel({
  workerId,
  shift,
}: {
  workerId: string;
  shift: ShiftHistoryRow;
}) {
  const [section, setSection] = useState<
    "summary" | "timeline" | "incidents" | "pay"
  >("summary");
  const contentRef = useRef<HTMLDivElement>(null);
  const band = complianceBandColor(shift.compliance_band);
  const timeRange = formatShiftTimeRange(shift);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { translate } = useAccessibility();

  const {
    data,
    isLoading,
    isError: detailError,
    refetch: retryDetail,
  } = useOrgQuery(["worker-shift-history-detail", workerId, shift.id], {
    queryFn: () => getWorkerShiftHistoryDetail(workerId, shift.id),
  });
  const {
    data: incidents,
    isLoading: incidentsLoading,
    isError: incidentsError,
    refetch: retryIncidents,
  } = useOrgQuery(["shift-incidents", shift.id], {
    queryFn: () =>
      listIncidents<ShiftIncidentSummary[]>({ shift_id: shift.id }),
  });
  const {
    data: payPreview,
    isLoading: payLoading,
    isError: payError,
    refetch: retryPay,
  } = useOrgQuery(["shift-pay-preview", shift.id], {
    queryFn: () => getShiftPayPreview(shift.id),
  });
  const {
    data: eventTimeline,
    isLoading: timelineLoading,
    isError: timelineError,
    refetch: retryTimeline,
  } = useOrgQuery(["shift-event-timeline", workerId, shift.id], {
    queryFn: () => getWorkerShiftEventTimeline(workerId, shift.id),
  });

  const [markingSleepover, setMarkingSleepover] = useState(false);
  const [sleepoverStart, setSleepoverStart] = useState("");
  const [sleepoverEnd, setSleepoverEnd] = useState("");
  const [loggingCallOut, setLoggingCallOut] = useState(false);
  const [callOutStart, setCallOutStart] = useState("");
  const [callOutEnd, setCallOutEnd] = useState("");
  const [callOutNote, setCallOutNote] = useState("");

  // useOrgQuery scopes this under [orgId, "shift-pay-preview", shift.id], so a bare-key
  // invalidate wouldn't match it - predicate pattern instead, as used elsewhere in this file.
  const invalidatePay = () => {
    qc.invalidateQueries({
      predicate: (q) => q.queryKey.includes("shift-pay-preview"),
    });
  };

  const sleepoverMut = useMutation({
    mutationFn: () =>
      markShiftSleepover(shift.id, {
        sleepover_start: datetimeLocalValueToUtcIso(sleepoverStart),
        sleepover_end: datetimeLocalValueToUtcIso(sleepoverEnd),
      }),
    onSuccess: () => {
      toast({ title: "Shift marked as sleepover" });
      setMarkingSleepover(false);
      invalidatePay();
    },
    onError: (err) =>
      toast({
        title: "Could not mark sleepover",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const callOutMut = useMutation({
    mutationFn: () =>
      logShiftCallOut(shift.id, {
        start: datetimeLocalValueToUtcIso(callOutStart),
        end: datetimeLocalValueToUtcIso(callOutEnd),
        note: callOutNote || undefined,
      }),
    onSuccess: () => {
      toast({ title: "Call-out logged" });
      setLoggingCallOut(false);
      setCallOutStart("");
      setCallOutEnd("");
      setCallOutNote("");
      invalidatePay();
    },
    onError: (err) =>
      toast({
        title: "Could not log call-out",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  const flagged = data?.flagged_tasks ?? [];
  const tasks = (data?.tasks ?? []) as Array<{
    task_id?: string;
    label?: string;
    completed?: boolean;
    marked_na?: boolean;
    has_photo?: boolean;
    has_voice?: boolean;
    note?: string;
  }>;
  const doneWell = tasks.filter(
    (t) =>
      !t.marked_na &&
      t.completed &&
      (t.has_photo || t.has_voice || (t.note && t.note.trim().length >= 20)),
  );

  return (
    <>
      <SheetHeader className="shrink-0 border-b border-cc-border px-5 pb-4 pt-6 pr-16 text-left sm:px-6 sm:pr-16">
        <p className="text-sm font-medium text-cc-muted">Shift history</p>
        <SheetTitle
          className="break-words text-xl font-semibold"
          style={{ color: TEXT }}
        >
          {shift.participant_name || "Participant"}
        </SheetTitle>
        <SheetDescription className="text-sm text-cc-muted">
          {safeFormat(shift.scheduled_start, "EEE d MMM yyyy")}{" "}
          {timeRange ? ` | ${timeRange}` : ""}
        </SheetDescription>
      </SheetHeader>
      <nav
        aria-label="Shift detail sections"
        className="grid shrink-0 grid-cols-4 gap-1 border-b border-cc-border px-3 py-2"
      >
        {(
          [
            ["summary", "Summary"],
            ["timeline", "Timeline"],
            ["incidents", "Incidents"],
            ["pay", "Pay"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => {
              setSection(key);
              contentRef.current?.scrollTo({ top: 0 });
            }}
            className="min-h-11 rounded-lg px-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              background: section === key ? SOFT : "transparent",
              color: section === key ? PLUM : MUTED,
            }}
          >
            {label}
            {key === "incidents" && !incidentsError && incidents?.length
              ? ` (${incidents.length})`
              : ""}
          </button>
        ))}
      </nav>
      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 [overflow-wrap:anywhere]"
      >
        <div className="space-y-5">
          <section
            hidden={section !== "summary"}
            aria-label="Shift summary"
            className="space-y-5"
          >
            {/* Summary: date, time, duration, participant, score, outcome */}
            <div
              className="rounded-xl border p-4 space-y-1.5"
              style={{ borderColor: BORDER, background: SOFT }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color: TEXT }}>
                  {safeFormat(shift.scheduled_start, "EEEE d MMM yyyy")}
                </p>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={band}
                >
                  {shift.compliance_score != null
                    ? `${Math.round(shift.compliance_score)}%`
                    : shift.compliance_band}
                </span>
              </div>
              <p className="text-sm" style={{ color: MUTED }}>
                {timeRange || "Clock in/out not recorded"}
                {shift.duration_minutes
                  ? ` · ${Math.round((shift.duration_minutes / 60) * 10) / 10}h`
                  : ""}
              </p>
              <p className="text-sm" style={{ color: MUTED }}>
                Participant:{" "}
                <span style={{ color: TEXT }}>
                  {shift.participant_name || "Not recorded"}
                </span>
              </p>
              {shift.compliance_explanation && (
                <p className="pt-1.5 text-sm" style={{ color: TEXT }}>
                  {shift.compliance_explanation}
                </p>
              )}
            </div>
          </section>
          <section
            hidden={section !== "pay"}
            aria-label="Shift pay"
            className="space-y-4"
          >
            <div>
              <h3 className="text-base font-semibold text-cc-text">
                Pay and adjustments
              </h3>
              <p className="mt-1 text-sm leading-6 text-cc-muted">
                Review the recorded pay estimate and sleepover or call-out
                details.
              </p>
            </div>
            {payLoading ? (
              <p role="status" className="text-sm text-cc-muted">
                Loading pay details...
              </p>
            ) : payError ? (
              <ProfileLoadError
                label="Pay details"
                retry={() => void retryPay()}
              />
            ) : !payPreview ? (
              <p className="text-sm text-cc-muted">
                No pay preview is available for this shift.
              </p>
            ) : (
              <>
                {payPreview && payPreview.total_cents >= 0 && (
                  <p
                    className="pt-1.5 text-sm font-bold"
                    style={{ color: TEXT }}
                  >
                    SCHADS pay estimate: $
                    {(payPreview.total_cents / 100).toFixed(2)}
                    {payPreview.is_sleepover ? " · sleepover" : ""}
                  </p>
                )}
                {payPreview?.emergency_flagged && (
                  <p
                    className="pt-1.5 text-sm"
                    style={{ color: "var(--cc-status-danger)" }}
                  >
                    Emergency flagged
                    {payPreview.emergency_note
                      ? `: ${payPreview.emergency_note}`
                      : ""}
                  </p>
                )}
                {/* Sleepover marking / call-out logging - see schads_engine.py's
            sleepover pricing path, verified against FWCFB 292. */}
                <div
                  className="rounded-xl border p-3 space-y-2"
                  style={{ borderColor: BORDER }}
                >
                  {!payPreview?.is_sleepover ? (
                    markingSleepover ? (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label
                            className="text-xs font-semibold"
                            style={{ color: TEXT }}
                          >
                            {translate(
                              "coordinator.shiftAssign.sleepoverStart",
                            )}
                          </label>
                          <DateTimePicker
                            value={sleepoverStart}
                            onChange={setSleepoverStart}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label
                            className="text-xs font-semibold"
                            style={{ color: TEXT }}
                          >
                            {translate("coordinator.shiftAssign.sleepoverEnd")}
                          </label>
                          <DateTimePicker
                            value={sleepoverEnd}
                            onChange={setSleepoverEnd}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => sleepoverMut.mutate()}
                            disabled={
                              !sleepoverStart ||
                              !sleepoverEnd ||
                              new Date(sleepoverEnd) <=
                                new Date(sleepoverStart) ||
                              sleepoverMut.isPending
                            }
                            className="rounded-full px-3.5 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                            style={{ background: PLUM }}
                          >
                            {translate("coordinator.shiftAssign.markSleepover")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setMarkingSleepover(false)}
                            className="text-sm font-bold"
                            style={{ color: MUTED }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setMarkingSleepover(true)}
                        className="text-sm font-bold"
                        style={{ color: PLUM }}
                      >
                        {translate("coordinator.shiftAssign.markSleepover")}
                      </button>
                    )
                  ) : loggingCallOut ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label
                          className="text-xs font-semibold"
                          style={{ color: TEXT }}
                        >
                          {translate("coordinator.shiftAssign.callOutStart")}
                        </label>
                        <DateTimePicker
                          value={callOutStart}
                          onChange={setCallOutStart}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          className="text-xs font-semibold"
                          style={{ color: TEXT }}
                        >
                          {translate("coordinator.shiftAssign.callOutEnd")}
                        </label>
                        <DateTimePicker
                          value={callOutEnd}
                          onChange={setCallOutEnd}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          className="text-xs font-semibold"
                          style={{ color: TEXT }}
                        >
                          {translate("coordinator.shiftAssign.callOutNote")}
                        </label>
                        <Input
                          value={callOutNote}
                          onChange={(e) => setCallOutNote(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => callOutMut.mutate()}
                          disabled={
                            !callOutStart ||
                            !callOutEnd ||
                            new Date(callOutEnd) <= new Date(callOutStart) ||
                            callOutMut.isPending
                          }
                          className="rounded-full px-3.5 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                          style={{ background: PLUM }}
                        >
                          {translate("coordinator.shiftAssign.callOutSave")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLoggingCallOut(false)}
                          className="text-sm font-bold"
                          style={{ color: MUTED }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLoggingCallOut(true)}
                      className="text-sm font-bold"
                      style={{ color: PLUM }}
                    >
                      {translate("coordinator.shiftAssign.logCallOut")}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
          <section hidden={section !== "timeline"} aria-label="Shift timeline">
            {/* Event timeline - every clock-in-to-clock-out event this shift
            wrote to audit_logs (clock-in, task updates, notes, evidence,
            acknowledgements, clock-out), for full audit-trail visibility. */}
            <div>
              <p
                className="text-sm font-semibold mb-3"
                style={{ color: MUTED }}
              >
                Shift activity
              </p>
              {timelineLoading ? (
                <p className="text-sm" style={{ color: MUTED }}>
                  Loading…
                </p>
              ) : timelineError ? (
                <ProfileLoadError
                  label="Timeline"
                  retry={() => void retryTimeline()}
                />
              ) : !eventTimeline || eventTimeline.length === 0 ? (
                <p className="text-sm" style={{ color: MUTED }}>
                  No events recorded for this shift.
                </p>
              ) : (
                <div className="space-y-2">
                  {eventTimeline.map((event, i) => (
                    <div
                      key={i}
                      className="relative flex flex-col gap-1 border-l-2 py-3 pl-4 sm:flex-row sm:justify-between sm:gap-3"
                      style={{ borderColor: BORDER, background: SOFT }}
                    >
                      <div className="min-w-0">
                        <p
                          className="text-sm font-bold"
                          style={{ color: TEXT }}
                        >
                          {event.label}
                        </p>
                        {event.actor_name && (
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: MUTED }}
                          >
                            {event.actor_name}
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 text-xs" style={{ color: MUTED }}>
                        {event.created_at
                          ? safeFormat(event.created_at, "d MMM, h:mm a")
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section
            hidden={section !== "incidents"}
            aria-label="Shift incidents"
          >
            {/* Incidents - explicit audit-trail requirement: what happened, what
            action was taken, and when, for anything reported off this shift. */}
            <div>
              <p
                className="text-sm font-semibold mb-3"
                style={{ color: MUTED }}
              >
                Incidents this shift
              </p>
              {incidentsLoading ? (
                <p className="text-sm" style={{ color: MUTED }}>
                  Loading…
                </p>
              ) : incidentsError ? (
                <ProfileLoadError
                  label="Incidents"
                  retry={() => void retryIncidents()}
                />
              ) : !incidents || incidents.length === 0 ? (
                <p className="text-sm" style={{ color: MUTED }}>
                  No incidents reported for this shift.
                </p>
              ) : (
                <div className="space-y-2">
                  {incidents.map((inc) => (
                    <div
                      key={inc.id}
                      className="rounded-xl border p-3"
                      style={{
                        borderColor: "var(--cc-status-danger)",
                        background: "var(--cc-status-danger-bg)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className="text-sm font-semibold"
                          style={{ color: TEXT }}
                        >
                          {inc.title ||
                            (inc.incident_type ?? "incident").replace(
                              /_/g,
                              " ",
                            )}
                        </p>
                        {inc.severity && (
                          <span
                            className="shrink-0 text-[9px] font-semibold uppercase"
                            style={{ color: "var(--cc-status-danger)" }}
                          >
                            {inc.severity}
                          </span>
                        )}
                      </div>
                      {inc.description && (
                        <p className="mt-1 text-sm" style={{ color: TEXT }}>
                          {inc.description}
                        </p>
                      )}
                      {(inc.worker_actions || inc.corrective_actions) && (
                        <p className="mt-1.5 text-sm" style={{ color: MUTED }}>
                          <span className="font-bold" style={{ color: TEXT }}>
                            Action taken:{" "}
                          </span>
                          {inc.worker_actions || inc.corrective_actions}
                        </p>
                      )}
                      <p
                        className="mt-1.5 text-[10px]"
                        style={{ color: MUTED }}
                      >
                        {inc.incident_date
                          ? safeFormat(inc.incident_date, "d MMM yyyy, h:mm a")
                          : "Date not recorded"}
                        {" · "}
                        {inc.status
                          ? String(inc.status).replace(/_/g, " ")
                          : "Status not set"}
                        {inc.resolved_date
                          ? ` · resolved ${safeFormat(inc.resolved_date, "d MMM yyyy")}`
                          : ""}
                        {inc.ndis_reportable ? " · NDIS reportable" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          <section
            hidden={section !== "summary"}
            aria-label="Shift documentation"
            className="space-y-5"
          >
            {isLoading ? (
              <p className="text-sm" style={{ color: MUTED }}>
                Loading shift detail…
              </p>
            ) : detailError ? (
              <ProfileLoadError
                label="Shift documentation"
                retry={() => void retryDetail()}
              />
            ) : (
              <>
                {flagged.length > 0 && (
                  <div>
                    <p
                      className="text-sm font-semibold mb-3"
                      style={{ color: "var(--cc-status-danger)" }}
                    >
                      Needs review
                    </p>
                    <ul className="space-y-1">
                      {flagged.map((f, i) => (
                        <li
                          key={`${f.task_id ?? "overall"}-${i}`}
                          className="flex items-start gap-1.5 text-sm"
                          style={{ color: TEXT }}
                        >
                          <AlertTriangle
                            size={12}
                            className="mt-0.5 shrink-0"
                            style={{ color: "var(--cc-status-danger)" }}
                          />
                          <span>
                            {(f.label as string) || "Overall compliance"}
                            {f.flag_type
                              ? `: ${FLAG_TYPE_LABEL[f.flag_type as string] ?? f.flag_type}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {doneWell.length > 0 && (
                  <div>
                    <p
                      className="text-sm font-semibold mb-3"
                      style={{ color: "var(--cc-status-success)" }}
                    >
                      Completed with supporting evidence
                    </p>
                    <ul className="space-y-1">
                      {doneWell.map((t) => (
                        <li
                          key={t.task_id}
                          className="flex items-start gap-1.5 text-sm"
                          style={{ color: TEXT }}
                        >
                          <CheckCircle2
                            size={12}
                            className="mt-0.5 shrink-0"
                            style={{ color: "var(--cc-status-success)" }}
                          />
                          {t.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!data?.notes && (
                  <p className="rounded-lg border border-cc-border p-4 text-sm text-cc-muted">
                    No shift notes recorded.
                  </p>
                )}
                {data?.notes && (
                  <div>
                    <p
                      className="text-sm font-semibold mb-3"
                      style={{ color: MUTED }}
                    >
                      Shift notes
                    </p>
                    <p
                      className="whitespace-pre-wrap text-sm"
                      style={{ color: TEXT }}
                    >
                      {data.notes}
                    </p>
                  </div>
                )}

                {data?.feedback && data.feedback.length > 0 && (
                  <div>
                    <p
                      className="text-sm font-semibold mb-3"
                      style={{ color: MUTED }}
                    >
                      Coordinator feedback
                    </p>
                    <ul className="space-y-1.5">
                      {data.feedback.map((f) => (
                        <li
                          key={f.id}
                          className="text-sm"
                          style={{ color: TEXT }}
                        >
                          <span className="font-bold">
                            {f.coordinator_name ?? "Coordinator"}:
                          </span>{" "}
                          {f.strengths}
                          {f.areas_to_improve ? ` · ${f.areas_to_improve}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            <details className="rounded-xl border border-cc-border p-4">
              <summary className="cursor-pointer text-sm font-semibold text-cc-text">
                Feedback on participant support
              </summary>
              <div className="mt-4">
                <ShiftMatchFeedbackForm shiftId={shift.id} />
              </div>
            </details>
          </section>
        </div>
      </div>
    </>
  );
}

/** Compact coordinator-side match feedback: 1-5 rating, would-repeat, and an
 * optional note on how the participant responded. Independent of the
 * worker's own reflection (worker.py's /shifts/{id}/match-feedback) - either
 * side can record first. */
function ShiftMatchFeedbackForm({ shiftId }: { shiftId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const feedbackKey = ["shift-match-feedback", shiftId];
  const { data: feedback, isLoading } = useOrgQuery(feedbackKey, {
    queryFn: () => getShiftMatchFeedback(shiftId),
  });

  const [rating, setRating] = useState<number | null>(null);
  const [wouldRepeat, setWouldRepeat] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [hydrated, setHydrated] = useState(false);

  if (feedback && !hydrated) {
    setRating(feedback.outcome_rating ?? null);
    setWouldRepeat(feedback.would_repeat ?? null);
    setNote(feedback.participant_response ?? "");
    setHydrated(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      postShiftMatchFeedback(shiftId, {
        outcome_rating: rating,
        would_repeat: wouldRepeat,
        participant_response: note || null,
      }),
    onSuccess: () => {
      toast({ title: "Saved" });
      // useOrgQuery scopes feedbackKey's actual cache entry under [orgId, ...feedbackKey],
      // so a bare-key invalidate wouldn't match it - predicate instead, as used elsewhere in this file.
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey.includes("shift-match-feedback"),
      });
    },
    onError: (err) =>
      toast({
        title: "Could not save",
        description: (err as Error).message,
        variant: "destructive",
      }),
  });

  if (isLoading) return null;

  return (
    <div
      className="mt-3 rounded-xl border p-3"
      style={{ borderColor: BORDER, background: SOFT }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        How did this pairing go?
      </p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className="p-0.5"
            >
              <Star
                size={16}
                fill={rating != null && n <= rating ? PLUM : "none"}
                style={{ color: PLUM }}
              />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWouldRepeat(true)}
            className="rounded-lg px-2 py-1 text-[11px] font-bold"
            style={{
              background:
                wouldRepeat === true
                  ? "var(--cc-status-success-bg)"
                  : "transparent",
              color: wouldRepeat === true ? "var(--cc-status-success)" : MUTED,
            }}
          >
            Would roster together again
          </button>
          <button
            type="button"
            onClick={() => setWouldRepeat(false)}
            className="rounded-lg px-2 py-1 text-[11px] font-bold"
            style={{
              background:
                wouldRepeat === false
                  ? "var(--cc-status-danger-bg)"
                  : "transparent",
              color: wouldRepeat === false ? "var(--cc-status-danger)" : MUTED,
            }}
          >
            Would not roster together again
          </button>
        </div>
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="How did the participant respond? (optional)"
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border p-2 text-xs"
        style={{ borderColor: BORDER, background: SURFACE }}
      />
      {feedback?.worker_feedback && (
        <p className="mt-2 text-xs italic" style={{ color: MUTED }}>
          Worker's note: "{feedback.worker_feedback}"
        </p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          style={{ background: PLUM }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** practitioner_allocations (the formal roster) and actual completed shifts
 * are two independent facts - a worker can genuinely have worked with a
 * participant many times without ever being formally "assigned" to them
 * (e.g. one-off cover, pre-assignment-rollout history). Showing only the
 * formal list made this tab look broken/empty for a worker who clearly has
 * real participant relationships - the "worked with" section below is
 * derived straight from real shift history so that history is never hidden. */
function ParticipantsTab({ worker }: { worker: WorkerStats }) {
  const assignmentsQuery = useOrgQuery(["worker-assignments", worker.id], {
    queryFn: () => getWorkerAssignments(worker.id),
  });
  const assignments = assignmentsQuery.data ?? [];

  const historyQuery = useOrgQuery(["worker-shift-history", worker.id], {
    queryFn: () => getWorkerShiftHistory(worker.id),
  });
  const shifts = historyQuery.data?.shifts ?? [];

  const workedWith = useMemo(() => {
    const assignedIds = new Set(assignments.map((a) => a.patient_id));
    const byParticipant = new Map<
      string,
      { id: string; name: string; count: number; lastShift: string }
    >();
    for (const s of shifts) {
      if (!s.participant_id || assignedIds.has(s.participant_id)) continue;
      const shiftDate = s.scheduled_start ?? "";
      const existing = byParticipant.get(s.participant_id);
      if (existing) {
        existing.count += 1;
        if (shiftDate > existing.lastShift) existing.lastShift = shiftDate;
      } else {
        byParticipant.set(s.participant_id, {
          id: s.participant_id,
          name: s.participant_name || "Participant",
          count: 1,
          lastShift: shiftDate,
        });
      }
    }
    return Array.from(byParticipant.values()).sort((a, b) =>
      (b.lastShift || "").localeCompare(a.lastShift || ""),
    );
  }, [shifts, assignments]);

  const isLoading = assignmentsQuery.isLoading || historyQuery.isLoading;

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border"
        style={{
          background: SURFACE,
          borderColor: BORDER,
          boxShadow: CARD_SHADOW,
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: BORDER }}
        >
          <p className="text-sm font-semibold" style={{ color: TEXT }}>
            Assigned participants
          </p>
          <span className="text-xs font-bold" style={{ color: MUTED }}>
            {assignmentsQuery.isLoading || assignmentsQuery.isError
              ? "Not available"
              : assignments.length}
          </span>
        </div>
        {assignmentsQuery.isLoading ? (
          <p className="px-5 py-6 text-sm" style={{ color: MUTED }}>
            Loading…
          </p>
        ) : assignmentsQuery.isError ? (
          <ProfileLoadError
            label="Participant assignments"
            retry={() => void assignmentsQuery.refetch()}
          />
        ) : assignments.length === 0 ? (
          <p className="px-5 py-6 text-sm text-center" style={{ color: MUTED }}>
            Not currently assigned to any participant.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {assignments.map((a) => (
              <a
                key={a.id}
                href={`/patients?id=${encodeURIComponent(a.patient_id)}`}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-black/[0.02]"
              >
                <div className="min-w-0">
                  <p
                    className="text-sm font-bold truncate"
                    style={{ color: TEXT }}
                  >
                    {a.participant?.full_name || "Participant"}
                  </p>
                  {a.participant?.ndis_number && (
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                      NDIS {a.participant.ndis_number}
                    </p>
                  )}
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold capitalize"
                  style={{ background: SOFT, color: MUTED }}
                >
                  {a.allocated_role.replace(/_/g, " ")}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      {historyQuery.isError && (
        <ProfileLoadError
          label="Participant shift history"
          retry={() => void historyQuery.refetch()}
        />
      )}
      {!isLoading &&
        !historyQuery.isError &&
        !assignmentsQuery.isError &&
        workedWith.length > 0 && (
          <div
            className="rounded-xl border"
            style={{
              background: SURFACE,
              borderColor: BORDER,
              boxShadow: CARD_SHADOW,
            }}
          >
            <div className="px-5 py-4 border-b" style={{ borderColor: BORDER }}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold" style={{ color: TEXT }}>
                  Also worked with
                </p>
                <span className="text-xs font-bold" style={{ color: MUTED }}>
                  {workedWith.length}
                </span>
              </div>
              <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                From completed shifts, not a standing assignment.
              </p>
            </div>
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {workedWith.map((p) => (
                <a
                  key={p.id}
                  href={`/patients?id=${encodeURIComponent(p.id)}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-black/[0.02]"
                >
                  <p
                    className="text-sm font-bold truncate"
                    style={{ color: TEXT }}
                  >
                    {p.name}
                  </p>
                  <span className="shrink-0 text-xs" style={{ color: MUTED }}>
                    {p.count} shift{p.count !== 1 ? "s" : ""}
                    {p.lastShift
                      ? ` · last ${safeFormat(p.lastShift, "d MMM yyyy")}`
                      : ""}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}

function AssignTrainingDialog({
  open,
  onOpenChange,
  worker,
  translate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const modulesQuery = useOrgQuery(["training-modules"], {
    queryFn: getTrainingModules,
    enabled: open,
  });
  const modules = (modulesQuery.data ?? []).filter((m) => !m.is_locked);

  const createModuleMut = useMutation({
    mutationFn: () =>
      createTrainingModule({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
      }),
    onSuccess: (mod: TrainingModule) => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.includes("training-modules"),
      });
      assignMut.mutate({ id: mod.id, title: mod.title });
    },
    onError: () =>
      toast({ title: "Failed to create module", variant: "destructive" }),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      assignTraining(worker.id, id, title),
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.includes("worker-training-assignments"),
      });
      toast({ title: translate("team.training.assignedToast") });
      onOpenChange(false);
      setSelectedModuleId("");
      setNewTitle("");
      setNewDescription("");
      setMode("existing");
    },
    onError: () =>
      toast({ title: "Failed to assign training", variant: "destructive" }),
  });

  const handleAssign = () => {
    if (mode === "new") {
      if (!newTitle.trim()) return;
      createModuleMut.mutate();
    } else {
      const mod = modules.find((m) => m.id === selectedModuleId);
      if (!mod) return;
      assignMut.mutate({ id: mod.id, title: mod.title });
    }
  };

  const pending = createModuleMut.isPending || assignMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
        style={{ background: SURFACE }}
      >
        <SheetHeader>
          <SheetTitle
            className="flex items-center gap-2"
            style={{ color: TEXT }}
          >
            <GraduationCap size={18} style={{ color: PLUM }} />{" "}
            {translate("team.training.assignTo").replace(
              "{name}",
              worker.full_name,
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors"
              style={{
                background: mode === m ? "var(--cc-bg)" : "transparent",
                color: mode === m ? PLUM : MUTED,
              }}
            >
              {m === "existing"
                ? translate("team.training.pickExisting")
                : translate("team.training.createNew")}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <div className="space-y-1.5 py-1">
            <label
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              {translate("team.training.module")}
            </label>
            {modules.length === 0 && !modulesQuery.isLoading ? (
              <p className="text-xs" style={{ color: MUTED }}>
                {translate("team.training.noModules")}
              </p>
            ) : (
              <Select
                value={selectedModuleId}
                onValueChange={setSelectedModuleId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={translate("team.training.chooseModule")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: MUTED }}
              >
                {translate("team.training.moduleTitle")}
              </label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={translate("team.training.moduleTitlePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: MUTED }}
              >
                {translate("team.training.moduleDescription")}
              </label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={translate(
                  "team.training.moduleDescriptionPlaceholder",
                )}
              />
            </div>
          </div>
        )}

        <SheetFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate("common.cancel")}
          </Button>
          <Button
            variant="navy"
            onClick={handleAssign}
            disabled={
              pending ||
              (mode === "existing" ? !selectedModuleId : !newTitle.trim())
            }
          >
            {pending
              ? translate("common.saving")
              : translate("team.training.assign")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
