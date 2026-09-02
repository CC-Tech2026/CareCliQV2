import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft, AlertTriangle, CheckCircle2, XCircle, Clock3,
  GraduationCap, Plus, Check, X as XIcon, FileText, Download, Trash2,
  Mail, Phone, IdCard, Hourglass, AlertCircle, ShieldCheck, Sparkles,
  CalendarDays, LogIn, MessageCircle, ArrowRight, TrendingUp,
  MoreHorizontal, Clock, Link2, UserX, UserCheck, Copy, ClipboardCheck, KeyRound, ChevronUp, ChevronDown, ChevronRight,
  Maximize2, Minimize2, Star,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getTeamCredentials, getTrainingModules, getWorkerTrainingAssignments, getWorkerAvailability,
  assignTraining, dismissTrainingAssignment, reviewTrainingCompletion, createTrainingModule,
  getWorkerOnboardingDocuments, uploadWorkerOnboardingDocument, deleteWorkerOnboardingDocument,
  getWorkerSkills, getWorkerShiftHistory, getWorkerShiftHistoryDetail, getWorkerPerformanceDashboard, getWorkerAssignments,
  getWorkerTags, addWorkerTag, removeWorkerTag, getTagCatalog,
  getShiftMatchFeedback, postShiftMatchFeedback,
  getCoordinatorWorkerStats, assignWorkerCoordinator,
  getWorkerBuddy, getBuddySuggestions, assignWorkerBuddy,
  type WorkerStats, type TrainingModule, type WorkerOnboardingDocument, type WorkerOnboardingDocumentType,
} from "@/services/coordinatorService";
import type { ShiftHistoryRow, ShiftHistoryDetail } from "@/services/workerPerformanceService";
import { listIncidents } from "@/services/incidentService";
import { getWorkerInduction } from "@/services/inductionService";
import { reviewCredential, type Credential } from "@/services/credentialsService";
import { getTeamOnboarding, CHECKLIST_STEP_ORDER, CHECKLIST_LABELS } from "@/services/onboardingService";
import { getWorkerCoachingSignal } from "@/services/medicationService";
import { WorkerAvailabilityPanel } from "@/components/coordinator/WorkerAvailabilityPanel";
import { safeFormat } from "@/lib/participant-format";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const CARD_SHADOW = "var(--cc-card-shadow)";

// "overview" stays a valid value (not in ALL_WORKER_DETAIL_TABS, so no tab
// button renders for it) purely so an old bookmarked ?tab=overview deep link
// still resolves to something - it's treated as an alias for "personal"
// wherever tab is read, rather than the two staying separate tabs.
export type WorkerDetailTab = "overview" | "personal" | "documents" | "credentials" | "availability" | "training" | "induction" | "shifts" | "participants";

const ALL_WORKER_DETAIL_TABS: WorkerDetailTab[] = [
  "personal", "shifts", "participants", "documents", "credentials", "availability", "training", "induction",
];

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

/** A worker is "verified" once every mandatory credential type is on file and valid/expiring (not missing/expired/rejected). */
export function isWorkerCredentialsComplete(credentials: Credential[], workerId: string): boolean {
  const workerCreds = credentials.filter((c) => c.user_id === workerId);
  const byType = new Map(workerCreds.map((c) => [c.credential_type, c]));
  return REQUIRED_CREDENTIAL_TYPES.every((type) => {
    const cred = byType.get(type);
    return !!cred && (cred.status === "valid" || cred.status === "expiring");
  });
}

function credentialLabel(type: string) {
  return CREDENTIAL_TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
      return { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)", Icon: CheckCircle2, label: "Valid" };
    case "expiring":
      return { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)", Icon: Clock3, label: "Expiring soon" };
    case "expired":
      return { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", Icon: AlertTriangle, label: "Expired" };
    case "pending_review":
      return { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)", Icon: Clock3, label: "Pending review" };
    case "rejected":
      return { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", Icon: XCircle, label: "Rejected" };
    default:
      return { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", Icon: XCircle, label: "Not on file" };
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
  const daysSinceChecked = (Date.now() - new Date(credential.last_checked_against_nwsd).getTime()) / 86_400_000;
  if (daysSinceChecked > SCREENING_RECHECK_STALE_DAYS) return true;
  if (credential.expiry_date) {
    const daysUntilExpiry = (new Date(credential.expiry_date).getTime() - Date.now()) / 86_400_000;
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
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/** Small rounded icon square used to give list rows (documents/credentials/training) consistent visual weight. */
function IconBadge({ icon: Icon, color, bg }: { icon: typeof FileText; color: string; bg: string }) {
  return (
    <div className="h-9 w-9 rounded-xl shrink-0 flex items-center justify-center" style={{ background: bg }}>
      <Icon size={15} style={{ color }} />
    </div>
  );
}

/** Turns a static phone/email row into something you can act on: click the value to call/email
 * (tel:/mailto:), or copy it without leaving the page. Mirrors ParticipantProfileCard's
 * conditional-link convention so contact info reads consistently across the app. */
export function ContactLink({ icon: Icon, value, href }: { icon: typeof Mail; value: string; href: string }) {
  const { toast } = useToast();
  return (
    <span className="group inline-flex items-center gap-1">
      <a
        href={href}
        className="inline-flex items-center gap-1.5 hover:underline"
        style={{ color: "inherit" }}
      >
        <Icon size={13} /> {value}
      </a>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          navigator.clipboard.writeText(value)
            .then(() => toast({ title: "Copied" }))
            .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
        }}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded p-0.5 transition-opacity hover:bg-black/5"
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
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SOFT} strokeWidth="4" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ} strokeLinecap="round"
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - score / 100) }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-black" style={{ color }}>{Math.round(score)}</span>
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
    return { level: "warning", label: `Blocked by credentials · ${credentialsCompleteCount}/${credentialsTotal}` };
  }
  if (worker.flagged_count > 0) {
    return { level: "danger", label: translateFlagged(worker.flagged_count, translate) };
  }
  return null;
}

/** Unifies the compliance ring + onboarding pill + credentials pill into one "can I roster
 * this person" answer, with a single most-urgent blocking reason and an action to fix it. */
function ReadinessSummary({
  worker, topReason, credentialsComplete, translate, onAction,
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
  const actionLabel = !credentialsComplete ? translate("team.detail.completeCredentials") : null;

  const levelColor = level === "good" ? "var(--cc-status-success)" : level === "warning" ? "var(--cc-status-warning)" : "var(--cc-status-danger)";
  const score = worker.avg_compliance;
  const message = score != null
    ? (topReason ? `Readiness ${Math.round(score)}% · ${topReason.label}` : `Readiness ${Math.round(score)}%`)
    : (topReason?.label ?? translate("team.detail.readyToRoster"));
  const a11yText = message;

  return (
    <div className="flex items-center gap-3 rounded-2xl border px-3 py-2" style={{ background: SURFACE, borderColor: levelColor, boxShadow: CARD_SHADOW }} role="status" aria-label={a11yText}>
      {score != null && <ScoreRing score={score} />}
      <div className="min-w-0">
        <p className="text-[12px] font-bold leading-tight" style={{ color: levelColor }}>{message}</p>
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

function translateFlagged(count: number, translate: (k: string) => string): string {
  return `${count} ${translate(count === 1 ? "team.detail.flaggedSession" : "team.detail.flaggedSessions")}`;
}

export function WorkerDetail({
  worker, onBack, initialTab,
  onAssignShift, onAssignClient, onReminder, onDeactivate, onActivate, onSendPasswordReset, onDeleteAccount,
  fullScreen, onToggleFullScreen,
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
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
}) {
  const { translate } = useAccessibility();
  const [tab, setTab] = useState<WorkerDetailTab>(!initialTab || initialTab === "overview" ? "personal" : initialTab);
  const [focusCredentialType, setFocusCredentialType] = useState<string | null>(null);

  // Next Steps rows for missing credentials jump straight to that specific row in the
  // Credentials tab (scrolled into view + briefly highlighted), not just the tab in general.
  function jumpToTab(nextTab: WorkerDetailTab, credentialType?: string) {
    setTab(nextTab);
    setFocusCredentialType(credentialType ?? null);
  }

  const credentialsQuery = useOrgQuery(["team-credentials"], {
    queryFn: getTeamCredentials,
  });
  const documentsQuery = useOrgQuery(["worker-onboarding-documents", worker.id], {
    queryFn: () => getWorkerOnboardingDocuments(worker.id),
  });
  const trainingQuery = useOrgQuery(["worker-training-assignments", worker.id], {
    queryFn: () => getWorkerTrainingAssignments(worker.id),
  });

  const workerCredentials = (credentialsQuery.data ?? []).filter((c: Credential) => c.user_id === worker.id);
  const credentialsComplete = !credentialsQuery.isLoading && isWorkerCredentialsComplete(credentialsQuery.data ?? [], worker.id);
  const onboardingPending = worker.role === "support_worker" && worker.onboarding_completed === false;
  const credentialsCompleteCount = REQUIRED_CREDENTIAL_TYPES.filter((type) => {
    const cred = workerCredentials.find((c) => c.credential_type === type);
    return cred && (cred.status === "valid" || cred.status === "expiring");
  }).length;
  const missingCredentialTypes = REQUIRED_CREDENTIAL_TYPES.filter((type) => {
    const cred = workerCredentials.find((c) => c.credential_type === type);
    return !cred || !(cred.status === "valid" || cred.status === "expiring");
  });
  const topReason = computeTopReason(
    worker, credentialsComplete, credentialsCompleteCount, REQUIRED_CREDENTIAL_TYPES.length, onboardingPending, translate,
  );
  const documentsCount = documentsQuery.data?.length ?? 0;
  const trainingPendingCount = (trainingQuery.data?.recommendations ?? [])
    .filter((r) => !(trainingQuery.data?.history ?? []).some((h) => h.module_id === r.training_module_id)).length;

  const tabBadges: Partial<Record<WorkerDetailTab, { text: string; severity: "neutral" | "warning" | "danger" }>> = {
    documents: documentsCount > 0 ? { text: String(documentsCount), severity: "neutral" } : undefined,
    credentials: {
      text: `${credentialsCompleteCount}/${REQUIRED_CREDENTIAL_TYPES.length}`,
      severity: credentialsComplete ? "neutral" : credentialsCompleteCount === 0 ? "danger" : "warning",
    },
    training: trainingPendingCount > 0 ? { text: String(trainingPendingCount), severity: "warning" } : undefined,
  };

  const statCells: { label: string; value: string | number; color?: string }[] = [
    { label: translate("team.col.sessions"), value: worker.total_sessions },
    { label: translate("team.col.thisWeek"), value: worker.sessions_this_week },
    { label: translate("team.detail.draftCount"), value: worker.draft_count },
    {
      label: translate("team.detail.flaggedCount"),
      value: worker.flagged_count,
      color: worker.flagged_count > 0 ? "var(--cc-status-danger)" : undefined,
    },
  ];
  const avatar = avatarColor(worker.full_name || "?");

  const hasQuickActions = onAssignShift || onAssignClient || onReminder || onDeactivate || onActivate || onSendPasswordReset || onDeleteAccount;

  return (
    <div className={fullScreen ? "mx-auto w-full max-w-[1400px] space-y-4 xl:px-6" : "space-y-4"}>
      {/* Back + quick actions - pr-8 keeps the "..." trigger clear of a Sheet's
          own built-in close (X) button, which sits fixed top-right whenever
          this panel is opened inside one (e.g. md/staff.tsx). */}
      <div className="flex items-center justify-between pr-8">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold transition-colors"
          style={{ color: PLUM }}
        >
          <ArrowLeft size={15} /> {translate("team.detail.back")}
        </button>
        <div className="flex items-center gap-2">
          {onToggleFullScreen && (
            <button
              type="button"
              onClick={onToggleFullScreen}
              className="hidden lg:flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-black/5"
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
                className="rounded-lg p-2 transition-colors hover:bg-black/5"
                style={{ color: MUTED }}
                aria-label={`Actions for ${worker.full_name}`}
              >
                <MoreHorizontal size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onAssignShift && (
                <DropdownMenuItem onClick={onAssignShift}>
                  <Clock size={13} className="mr-1.5" /> {translate("team.assignShift")}
                </DropdownMenuItem>
              )}
              {onAssignClient && (
                <DropdownMenuItem onClick={onAssignClient}>
                  <Link2 size={13} className="mr-1.5" /> {translate("team.assignClient")}
                </DropdownMenuItem>
              )}
              {onReminder && (
                <DropdownMenuItem onClick={onReminder}>
                  <Mail size={13} className="mr-1.5" /> {translate("team.reminder")}
                </DropdownMenuItem>
              )}
              {onSendPasswordReset && (
                <DropdownMenuItem onClick={onSendPasswordReset}>
                  <KeyRound size={13} className="mr-1.5" /> Send password reset email
                </DropdownMenuItem>
              )}
              {(onDeactivate || onActivate) && <DropdownMenuSeparator />}
              {onDeactivate && worker.is_active !== false && (
                <DropdownMenuItem onClick={onDeactivate} className="text-red-600 focus:text-red-600">
                  <UserX size={13} className="mr-1.5" /> {translate("team.deactivate")}
                </DropdownMenuItem>
              )}
              {onActivate && worker.is_active === false && (
                <DropdownMenuItem onClick={onActivate} className="text-green-700 focus:text-green-700">
                  <UserCheck size={13} className="mr-1.5" /> {translate("team.reactivate")}
                </DropdownMenuItem>
              )}
              {onDeleteAccount && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDeleteAccount} className="text-red-600 focus:text-red-600">
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
      <div className="rounded-2xl overflow-hidden border" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
        <div className={`flex flex-col sm:flex-row sm:items-start gap-4 ${fullScreen ? "p-6 xl:p-7" : "p-5"}`}>
          <div
            className={`${fullScreen ? "h-20 w-20 text-2xl" : "h-16 w-16 text-xl"} rounded-full shrink-0 flex items-center justify-center font-black shadow-sm`}
            style={{ background: avatar.bg, color: avatar.fg }}
          >
            {(worker.full_name || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`${fullScreen ? "text-2xl" : "text-lg"} font-black truncate`} style={{ color: TEXT }}>{worker.full_name}</h2>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: worker.is_active !== false ? "var(--cc-status-success-bg)" : "var(--cc-status-danger-bg)",
                  color: worker.is_active !== false ? "var(--cc-status-success)" : "var(--cc-status-danger)",
                }}
              >
                {worker.is_active !== false ? translate("team.status.active") : translate("team.status.inactive")}
              </span>
              {onboardingPending && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ borderColor: "var(--cc-status-warning)", color: "var(--cc-status-warning)" }}
                >
                  <Hourglass size={10} /> {translate("team.detail.onboardingPending")}
                </span>
              )}
              {worker.training_overdue && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)" }}
                >
                  <AlertCircle size={10} /> {translate("team.detail.trainingOverdue")}
                </span>
              )}
            </div>
            <p className="text-xs mt-1 capitalize" style={{ color: MUTED }}>
              {(worker.role || "").replace(/_/g, " ")}
              <span className="mx-1.5">·</span>
              <span className="font-bold" style={{ color: TEXT }}>{worker.employee_id || worker.id.slice(0, 8)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs" style={{ color: MUTED }}>
              {worker.email && <ContactLink icon={Mail} value={worker.email} href={`mailto:${worker.email}`} />}
              {worker.phone && <ContactLink icon={Phone} value={worker.phone} href={`tel:${worker.phone.replace(/\s/g, "")}`} />}
            </div>
          </div>
          <div className="shrink-0 w-full sm:w-auto">
            <ReadinessSummary
              worker={worker}
              topReason={topReason}
              credentialsComplete={credentialsComplete}
              translate={translate}
              onAction={() => setTab("credentials")}
            />
          </div>
        </div>

        {/* At-a-glance stat strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ borderTop: `1px solid ${BORDER}`, borderColor: BORDER }}>
          {statCells.map((cell) => (
            <div key={cell.label} className={fullScreen ? "px-5 py-4" : "px-4 py-3"} style={{ borderColor: BORDER }}>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{cell.label}</p>
              <p className={`${fullScreen ? "text-lg" : "text-base"} font-black tabular-nums mt-0.5`} style={{ color: cell.color ?? TEXT }}>{cell.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs + content - vertical sidebar tabs on wide screens (this panel is
          wide enough now to earn it, and 8 tabs was starting to overflow a
          horizontal scroller), falling back to the original horizontal
          scrollable strip on narrow/mobile widths. */}
      <div className={`flex flex-col gap-5 lg:flex-row lg:items-start ${fullScreen ? "xl:gap-8" : ""}`}>
        <div role="tablist" className="flex gap-1 overflow-x-auto scrollbar-none border-b lg:hidden" style={{ borderColor: BORDER }}>
          {ALL_WORKER_DETAIL_TABS.map((t) => {
            const badge = tabBadges[t];
            const badgeColor = badge?.severity === "danger" ? "var(--cc-status-danger)" : badge?.severity === "warning" ? "var(--cc-status-warning)" : MUTED;
            const badgeBg = badge?.severity === "danger" ? "var(--cc-status-danger-bg)" : badge?.severity === "warning" ? "var(--cc-status-warning-bg)" : SOFT;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t ? "true" : "false"}
                onClick={() => setTab(t)}
                className="relative shrink-0 flex items-center gap-1.5 whitespace-nowrap px-3 pb-3 pt-1 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-t-lg"
                style={{ color: tab === t ? TEXT : MUTED, outlineColor: PLUM }}
              >
                {translate(`team.detail.tab.${t}` as "team.detail.tab.overview")}
                {badge && (
                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: badgeBg, color: badgeColor }}>
                    {badge.text}
                  </span>
                )}
                {tab === t && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full" style={{ background: PLUM }} />}
              </button>
            );
          })}
        </div>

        <div role="tablist" className={`hidden shrink-0 flex-col gap-0.5 lg:flex ${fullScreen ? "lg:w-56 xl:w-64" : "lg:w-52"}`}>
          {ALL_WORKER_DETAIL_TABS.map((t) => {
            const badge = tabBadges[t];
            const badgeColor = badge?.severity === "danger" ? "var(--cc-status-danger)" : badge?.severity === "warning" ? "var(--cc-status-warning)" : MUTED;
            const badgeBg = badge?.severity === "danger" ? "var(--cc-status-danger-bg)" : badge?.severity === "warning" ? "var(--cc-status-warning-bg)" : SOFT;
            const active = tab === t;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active ? "true" : "false"}
                onClick={() => setTab(t)}
                className="relative flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-[13px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ background: active ? SOFT : "transparent", color: active ? TEXT : MUTED, outlineColor: PLUM }}
              >
                <span className="flex items-center gap-2">
                  {active && <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: PLUM }} />}
                  {translate(`team.detail.tab.${t}` as "team.detail.tab.overview")}
                </span>
                {badge && (
                  <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: badgeBg, color: badgeColor }}>
                    {badge.text}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className={`min-w-0 flex-1 ${fullScreen ? "xl:max-w-3xl" : ""}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {(tab === "personal" || tab === "overview") && (
                <PersonalInfoTab
                  worker={worker}
                  translate={translate}
                  missingCredentialTypes={missingCredentialTypes}
                  trainingPendingCount={trainingPendingCount}
                  onJumpToTab={jumpToTab}
                />
              )}
              {tab === "shifts" && <ShiftsTab worker={worker} translate={translate} />}
              {tab === "participants" && <ParticipantsTab worker={worker} />}
              {tab === "documents" && <DocumentsTab worker={worker} translate={translate} />}
              {tab === "credentials" && (
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
              {tab === "training" && <TrainingTab worker={worker} topReason={topReason} translate={translate} />}
              {tab === "induction" && <InductionTab worker={worker} translate={translate} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {fullScreen && (
          <div className="hidden xl:flex xl:w-80 xl:shrink-0 xl:flex-col gap-4">
            <RailCard title="Contact">
              <RailRow icon={Mail} label="Email" value={worker.email} emptyText="Not on file" />
              <RailRow icon={Phone} label="Phone" value={worker.phone ?? undefined} emptyText="Not on file" />
              <RailRow icon={IdCard} label="Employee ID" value={worker.employee_id ?? undefined} emptyText="Not assigned" />
              <RailRow icon={CalendarDays} label={translate("team.detail.joined")} value={safeFormat(worker.joined_at)} emptyText={translate("team.detail.noJoinDate")} />
              <RailRow icon={LogIn} label={translate("team.detail.lastLogin")} value={worker.last_login ? safeFormat(worker.last_login, "MMM d, yyyy h:mm a") : undefined} emptyText={translate("team.detail.noLoginYet")} />
            </RailCard>

            <RailCard title="Compliance snapshot">
              <RailStatusRow
                label="Credentials"
                value={`${credentialsCompleteCount}/${REQUIRED_CREDENTIAL_TYPES.length}`}
                tone={credentialsComplete ? "success" : credentialsCompleteCount === 0 ? "danger" : "warning"}
                onClick={() => setTab("credentials")}
              />
              <RailStatusRow
                label="Training"
                value={worker.training_overdue ? "Overdue" : trainingPendingCount > 0 ? `${trainingPendingCount} to review` : "Up to date"}
                tone={worker.training_overdue ? "danger" : trainingPendingCount > 0 ? "warning" : "success"}
                onClick={() => setTab("training")}
              />
              <RailStatusRow
                label="Documents"
                value={`${documentsCount} on file`}
                tone="neutral"
                onClick={() => setTab("documents")}
              />
              {onboardingPending && (
                <RailStatusRow
                  label="Onboarding"
                  value="In progress"
                  tone="warning"
                  onClick={() => setTab("personal")}
                />
              )}
            </RailCard>

            {hasQuickActions && (
              <RailCard title="Quick actions">
                <div className="flex flex-col gap-1.5">
                  {onAssignShift && <RailActionButton icon={Clock} label={translate("team.assignShift")} onClick={onAssignShift} />}
                  {onAssignClient && <RailActionButton icon={Link2} label={translate("team.assignClient")} onClick={onAssignClient} />}
                  {onReminder && <RailActionButton icon={Mail} label={translate("team.reminder")} onClick={onReminder} />}
                  {onSendPasswordReset && <RailActionButton icon={KeyRound} label="Send password reset email" onClick={onSendPasswordReset} />}
                  {onDeactivate && worker.is_active !== false && (
                    <RailActionButton icon={UserX} label={translate("team.deactivate")} onClick={onDeactivate} tone="danger" />
                  )}
                  {onActivate && worker.is_active === false && (
                    <RailActionButton icon={UserCheck} label={translate("team.reactivate")} onClick={onActivate} tone="success" />
                  )}
                  {onDeleteAccount && (
                    <RailActionButton icon={Trash2} label="Remove account" onClick={onDeleteAccount} tone="danger" />
                  )}
                </div>
              </RailCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact card shell for the full-screen right rail — same visual language as the
 * main content cards (SURFACE/BORDER/CARD_SHADOW), just tighter padding since it's
 * secondary, at-a-glance context rather than primary content. */
function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
      <p className="px-4 pt-3.5 pb-2 text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{title}</p>
      <div className="divide-y" style={{ borderColor: BORDER }}>
        {children}
      </div>
    </div>
  );
}

function RailRow({
  icon: Icon, label, value, emptyText,
}: {
  icon: typeof Mail;
  label: string;
  value?: string | null;
  emptyText: string;
}) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <Icon size={13} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
        <p className={`text-[13px] font-semibold mt-0.5 truncate ${value ? "" : "italic"}`} style={{ color: value ? TEXT : MUTED }}>
          {value || emptyText}
        </p>
      </div>
    </div>
  );
}

function RailStatusRow({
  label, value, tone, onClick,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
  onClick: () => void;
}) {
  const color = tone === "success" ? "var(--cc-status-success)" : tone === "warning" ? "var(--cc-status-warning)" : tone === "danger" ? "var(--cc-status-danger)" : TEXT;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.03]"
    >
      <span className="text-[13px] font-bold" style={{ color: TEXT }}>{label}</span>
      <span className="flex items-center gap-1 text-[12px] font-black" style={{ color }}>
        {value}
        <ArrowRight size={11} />
      </span>
    </button>
  );
}

function RailActionButton({
  icon: Icon, label, onClick, tone,
}: {
  icon: typeof Mail;
  label: string;
  onClick: () => void;
  tone?: "danger" | "success";
}) {
  const color = tone === "danger" ? "var(--cc-status-danger)" : tone === "success" ? "var(--cc-status-success)" : PLUM;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-bold transition-colors hover:bg-black/[0.04]"
      style={{ color }}
    >
      <Icon size={13} className="shrink-0" />
      {label}
    </button>
  );
}

function DetailRow({
  label, value, icon, tone, emptyText,
}: {
  label: string;
  value?: string | null;
  icon: typeof FileText;
  tone?: "success" | "warning";
  /** Shown, in muted italic, when value is empty — a designed empty state instead of "N/A". */
  emptyText?: string;
}) {
  const color = tone === "success" ? "var(--cc-status-success)" : tone === "warning" ? "var(--cc-status-warning)" : MUTED;
  const bg = tone === "success" ? "var(--cc-status-success-bg)" : tone === "warning" ? "var(--cc-status-warning-bg)" : SOFT;
  return (
    <div className="flex items-center gap-3 px-5 py-3.5" style={{ background: SURFACE }}>
      <IconBadge icon={icon} color={color} bg={bg} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
        {value ? (
          <p className="text-sm font-semibold mt-0.5" style={{ color: TEXT }}>{value}</p>
        ) : (
          <p className="text-sm italic mt-0.5" style={{ color: MUTED }}>{emptyText}</p>
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
    <div className="rounded-2xl border px-5 py-4" style={{ background: SOFT, borderColor: BORDER }}>
      <div className="flex items-center gap-2 mb-1">
        <Clock size={14} style={{ color: PLUM }} />
        <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Availability</p>
      </div>
      {a ? (
        <p className="text-sm font-bold" style={{ color: TEXT }}>
          Available up to {a.max_hours_per_week} hours per week
          {a.available_days?.length > 0 && ` · ${a.available_days.map((d) => DAY_ABBR[d - 1]).filter(Boolean).join(", ")}`}
        </p>
      ) : (
        <p className="text-sm" style={{ color: MUTED }}>No availability set yet.</p>
      )}
      <p className="text-[11px] mt-1.5 italic" style={{ color: MUTED }}>
        SCHADS classification isn't tracked in CareCliQ yet — this would need a new field before it can show here.
      </p>
    </div>
  );
}

function ProfileCard({ worker }: { worker: WorkerStats }) {
  const skillsQuery = useOrgQuery(["worker-skills", worker.id], {
    queryFn: () => getWorkerSkills(worker.id),
  });
  const skills = skillsQuery.data ?? [];

  if (!worker.profile_summary && !worker.profile_experience_years && skills.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex items-center gap-2">
        <Sparkles size={14} style={{ color: PLUM }} />
        <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Profile</p>
      </div>
      {worker.profile_summary && (
        <p className="mt-2.5 text-sm leading-relaxed" style={{ color: TEXT }}>{worker.profile_summary}</p>
      )}
      {worker.profile_experience_years && (
        <p className="mt-2 text-xs font-semibold" style={{ color: TEXT }}>{worker.profile_experience_years}</p>
      )}
      {skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <span
              key={s.skill}
              className="rounded-full px-2.5 py-1 text-[10px] font-bold"
              style={{ background: s.is_certified ? "var(--cc-status-success-bg)" : SOFT, color: s.is_certified ? "var(--cc-status-success)" : MUTED }}
              title={s.is_certified ? "Certified" : "Unverified — from resume"}
            >
              {s.skill}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PersonalInfoTab({
  worker, translate, missingCredentialTypes, trainingPendingCount, onJumpToTab,
}: {
  worker: WorkerStats;
  translate: (k: string) => string;
  missingCredentialTypes: string[];
  trainingPendingCount: number;
  onJumpToTab: (tab: WorkerDetailTab, credentialType?: string) => void;
}) {
  const onboardingPending = worker.role === "support_worker" && worker.onboarding_completed === false;

  const coachingQuery = useOrgQuery(["worker-medication-coaching-signal", worker.id], {
    queryFn: () => getWorkerCoachingSignal(worker.id),
    enabled: worker.role === "support_worker",
  });
  const coaching = coachingQuery.data?.signal;

  // Discrete checklist step the worker is currently on, not just a pending/complete boolean —
  // genuinely new information instead of repeating the header's "Onboarding Pending" badge.
  const onboardingQuery = useOrgQuery(["team-onboarding"], {
    queryFn: getTeamOnboarding,
    enabled: onboardingPending,
  });
  const workerChecklist = (onboardingQuery.data ?? []).find((row) => String(row.id) === worker.id)
    ?.onboarding_checklist as Record<string, boolean> | undefined;
  const currentStepKey = workerChecklist
    ? CHECKLIST_STEP_ORDER.find((key) => !workerChecklist[key])
    : undefined;
  const currentStepLabel = currentStepKey ? CHECKLIST_LABELS[currentStepKey] : undefined;

  const [nextStepsOpen, setNextStepsOpen] = useState(true);

  const nextSteps: { label: string; onClick?: () => void }[] = [];
  if (onboardingPending) {
    nextSteps.push({
      label: currentStepLabel ? `Onboarding: currently on "${currentStepLabel}"` : "Onboarding checklist not yet complete",
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
    nextSteps.push({ label: "Mandatory training is overdue", onClick: () => onJumpToTab("training") });
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
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--cc-status-warning)", background: "var(--cc-status-warning-bg)" }}>
          <button
            type="button"
            onClick={() => setNextStepsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3"
          >
            <span className="flex items-center gap-2">
              <AlertCircle size={15} style={{ color: "var(--cc-status-warning)" }} />
              <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--cc-status-warning)" }}>
                Next steps ({nextSteps.length})
              </span>
            </span>
            {nextStepsOpen ? <ChevronUp size={14} style={{ color: "var(--cc-status-warning)" }} /> : <ChevronDown size={14} style={{ color: "var(--cc-status-warning)" }} />}
          </button>
          {nextStepsOpen && (
            <div className="divide-y" style={{ borderColor: "var(--cc-status-warning)" }}>
              {nextSteps.map((step) => (
                step.onClick ? (
                  <button
                    key={step.label}
                    type="button"
                    onClick={step.onClick}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.03]"
                  >
                    <span className="text-sm font-semibold" style={{ color: TEXT }}>{step.label}</span>
                    <ArrowRight size={14} className="shrink-0" style={{ color: "var(--cc-status-warning)" }} />
                  </button>
                ) : (
                  <div key={step.label} className="px-4 py-3">
                    <span className="text-sm font-semibold" style={{ color: TEXT }}>{step.label}</span>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border p-4 flex items-center gap-2.5" style={{ borderColor: "var(--cc-status-success)", background: "var(--cc-status-success-bg)" }}>
          <CheckCircle2 size={16} style={{ color: "var(--cc-status-success)" }} />
          <p className="text-sm font-bold" style={{ color: "var(--cc-status-success)" }}>Nothing outstanding — fully up to date.</p>
        </div>
      )}

      {/* Coaching input, not a compliance flag — deliberately its own card, never mixed
          into the stat strip or any compliance-facing surface. */}
      {coaching?.triggered && (
        <div className="rounded-2xl p-4" style={{ background: SOFT, boxShadow: CARD_SHADOW }}>
          <div className="flex items-center gap-2 mb-1.5">
            <TrendingUp size={15} style={{ color: PLUM }} />
            <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: PLUM }}>
              {translate("team.detail.coachingTitle")}
            </p>
          </div>
          <p className="text-sm" style={{ color: TEXT }}>{coaching.trigger_reason}</p>
        </div>
      )}

      {/* Contact + employment basics */}
      <div className="rounded-2xl overflow-hidden border sm:grid sm:grid-cols-2 sm:gap-px divide-y sm:divide-y-0" style={{ background: BORDER, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
        <DetailRow icon={Mail} label="Email" value={worker.email} emptyText="Not on file" />
        <DetailRow icon={Phone} label="Phone" value={worker.phone ?? undefined} emptyText="Not on file" />
        <DetailRow icon={IdCard} label="Employee ID" value={worker.employee_id ?? undefined} emptyText="Not assigned" />
        <DetailRow
          icon={MessageCircle}
          label={translate("team.detail.preferredContact")}
          value={worker.preferred_contact_method}
          emptyText={translate("team.detail.contactNotSet")}
        />
        <DetailRow icon={CalendarDays} label={translate("team.detail.joined")} value={safeFormat(worker.joined_at)} emptyText={translate("team.detail.noJoinDate")} />
        <DetailRow
          icon={LogIn}
          label={translate("team.detail.lastLogin")}
          value={worker.last_login ? safeFormat(worker.last_login, "MMM d, yyyy h:mm a") : undefined}
          emptyText={translate("team.detail.noLoginYet")}
        />
        {onboardingPending ? (
          <DetailRow icon={Hourglass} tone="warning" label="Onboarding" value="In progress" />
        ) : (
          <DetailRow icon={CheckCircle2} tone="success" label={translate("team.detail.onboardingStatus")} value={translate("team.detail.onboardingComplete")} />
        )}
      </div>

      {/* Resume-derived bio, experience and skills - captured at onboarding and kept on
          their live profile permanently, not just during the hiring process. */}
      <ProfileCard worker={worker} />

      <CoordinatorAssignmentSection worker={worker} />

      <BuddyAssignmentSection worker={worker} />

      <WorkerTagsSection workerId={worker.id} />
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
  const { data: coordinators = [] } = useOrgQuery(["org-coordinators"], {
    queryFn: () => getCoordinatorWorkerStats().then((list) => list.filter((w) => w.role === "support_coordinator")),
  });
  const [coordinatorId, setCoordinatorId] = useState<string | null>(worker.coordinator_id ?? null);

  const assignMutation = useMutation({
    mutationFn: (nextId: string | null) => assignWorkerCoordinator(worker.id, nextId),
    onSuccess: (_, nextId) => setCoordinatorId(nextId),
    onError: (err) => toast({ title: "Could not update coordinator", description: (err as Error).message, variant: "destructive" }),
  });

  if (user?.role !== "managing_director" || worker.role !== "support_worker") return null;

  return (
    <div className="rounded-2xl overflow-hidden border p-5" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
      <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Assigned coordinator</p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        Who this worker's dashboard, session review, and credential alerts are scoped to.
      </p>
      <div className="mt-3 max-w-xs">
        <Select
          value={coordinatorId ?? "unassigned"}
          onValueChange={(value) => assignMutation.mutate(value === "unassigned" ? null : value)}
          disabled={assignMutation.isPending}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {coordinators.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
  const { data: suggestions = [] } = useOrgQuery(["buddy-suggestions", worker.id], {
    queryFn: () => getBuddySuggestions(worker.id),
  });

  const [buddyId, setBuddyId] = useState<string | null>(null);
  useEffect(() => {
    setBuddyId(currentBuddy?.buddy_worker_id ?? null);
  }, [currentBuddy?.buddy_worker_id]);

  const assignMutation = useMutation({
    mutationFn: (nextId: string | null) => assignWorkerBuddy(worker.id, nextId),
    onSuccess: (_, nextId) => setBuddyId(nextId),
    onError: (err) => toast({ title: "Could not update buddy", description: (err as Error).message, variant: "destructive" }),
  });

  if (worker.role !== "support_worker") return null;

  const options = [...suggestions];
  if (buddyId && currentBuddy?.full_name && !options.some((o) => o.id === buddyId)) {
    options.unshift({ id: buddyId, full_name: currentBuddy.full_name, same_suburb: false });
  }

  return (
    <div className="rounded-2xl overflow-hidden border p-5" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
      <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Buddy</p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        An experienced worker to help them settle in before their first shift.
      </p>
      <div className="mt-3 max-w-xs">
        <Select
          value={buddyId ?? "none"}
          onValueChange={(value) => assignMutation.mutate(value === "none" ? null : value)}
          disabled={assignMutation.isPending}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="No buddy assigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No buddy assigned</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.full_name}{o.same_suburb ? " · same suburb" : ""}
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

  const { data: tags = [], isLoading } = useOrgQuery(tagsKey, { queryFn: () => getWorkerTags(workerId) });
  const { data: catalog = [] } = useOrgQuery(catalogKey, { queryFn: getTagCatalog });

  const [selectedTagId, setSelectedTagId] = useState("");

  const availableTags = (() => {
    const already = new Set(tags.map((t) => t.tag_id));
    return catalog.flatMap((category) =>
      category.tags.filter((t) => t.is_active && !already.has(t.id)).map((t) => ({ ...t, categoryName: category.name }))
    );
  })();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: tagsKey });

  const addMutation = useMutation({
    mutationFn: (tagId: string) => addWorkerTag(workerId, tagId),
    onSuccess: () => { setSelectedTagId(""); invalidate(); },
    onError: (err) => toast({ title: "Could not add tag", description: (err as Error).message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (tagId: string) => removeWorkerTag(workerId, tagId),
    onSuccess: invalidate,
    onError: (err) => toast({ title: "Could not remove tag", description: (err as Error).message, variant: "destructive" }),
  });

  if (isLoading) return null;

  return (
    <div className="rounded-2xl overflow-hidden border p-5" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
      <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Interests & lived experience</p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>
        Self-reported by the worker (or added here) - used to suggest a better-fitting participant match.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.length === 0 && <p className="text-xs italic" style={{ color: MUTED }}>Nothing on file yet.</p>}
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
            style={{ borderColor: BORDER, background: SOFT, color: TEXT }}
          >
            {tag.label}
            {tag.visible_to_coordinator_only && (
              <span className="text-[9px] font-black uppercase" style={{ color: PLUM }}>Private</span>
            )}
            <button type="button" onClick={() => removeMutation.mutate(tag.tag_id)} aria-label={`Remove ${tag.label}`} className="opacity-60 hover:opacity-100">
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
            <option key={tag.id} value={tag.id}>{tag.categoryName} · {tag.label}</option>
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

function documentTypeLabel(type: WorkerOnboardingDocumentType, translate: (k: string) => string): string {
  return translate(`team.documents.type.${type}` as "team.documents.type.other");
}

function DocumentsTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const documentsQuery = useOrgQuery(["worker-onboarding-documents", worker.id], {
    queryFn: () => getWorkerOnboardingDocuments(worker.id),
  });
  const documents = documentsQuery.data ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWorkerOnboardingDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-onboarding-documents") });
      toast({ title: translate("team.documents.removed") });
    },
    onError: () => toast({ title: translate("team.documents.saveFailed"), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Summary strip — same pattern as every other tab. No "expiring within 30 days" count:
          these documents (offer letters, references, correspondence) have no expiry concept in
          this data model at all, not just none set, so that clause never applies here. */}
      <div className="flex items-center justify-between gap-3 rounded-2xl px-5 py-4" style={{ background: SOFT, color: TEXT }}>
        <div>
          <p className="text-lg font-black">{documents.length} document{documents.length !== 1 ? "s" : ""}</p>
          <p className="text-xs font-bold mt-0.5" style={{ color: MUTED }}>General storage — offer letters, references, correspondence</p>
        </div>
        <FileText size={22} style={{ color: MUTED }} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} style={{ color: PLUM }} />
          <p className="text-sm font-black" style={{ color: TEXT }}>{translate("team.documents.title")}</p>
        </div>
        <Button variant="navy" size="sm" className="gap-1.5 rounded-xl" onClick={() => setAddOpen(true)}>
          <Plus size={13} /> {translate("team.documents.add")}
        </Button>
      </div>

      {documentsQuery.isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}

      {!documentsQuery.isLoading && documents.length === 0 && (
        <div className="rounded-2xl p-8 text-center border" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
          <FileText size={28} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.documents.empty")}</p>
          <Button variant="navy" size="sm" className="mt-4 gap-1.5 rounded-xl" onClick={() => setAddOpen(true)}>
            <Plus size={13} /> {translate("team.documents.add")}
          </Button>
        </div>
      )}

      {documents.length > 0 && (
        <div className="rounded-2xl divide-y border" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0 flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl shrink-0 flex items-center justify-center" style={{ background: SOFT }}>
                  <FileText size={15} style={{ color: PLUM }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: TEXT }}>{doc.title}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: SOFT, color: PLUM }}>
                      {documentTypeLabel(doc.document_type, translate)}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                    {translate("team.documents.uploadedOn")} {safeFormat(doc.created_at)}
                    {doc.uploaded_by && doc.uploaded_by === user?.id ? " · Uploaded by you" : ""}
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
                    className="rounded-lg p-1.5 hover:bg-black/5"
                    title={translate("team.documents.download")}
                    aria-label={translate("team.documents.download")}
                  >
                    <Download size={14} style={{ color: PLUM }} />
                  </a>
                ) : null}
                <button
                  onClick={() => {
                    if (window.confirm(translate("team.documents.removeConfirm"))) deleteMut.mutate(doc.id);
                  }}
                  className="rounded-lg p-1.5 hover:bg-black/5"
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

      <AddDocumentDialog open={addOpen} onOpenChange={setAddOpen} worker={worker} translate={translate} />
    </div>
  );
}

function AddDocumentDialog({
  open, onOpenChange, worker, translate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: WorkerStats;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<WorkerOnboardingDocumentType>("offer_letter");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const saveMut = useMutation({
    mutationFn: () => uploadWorkerOnboardingDocument(worker.id, {
      document_type: docType,
      title: title.trim(),
      notes: notes.trim() || undefined,
      file: file || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-onboarding-documents") });
      toast({ title: translate("team.documents.saved") });
      onOpenChange(false);
      setDocType("offer_letter");
      setTitle("");
      setNotes("");
      setFile(null);
    },
    onError: () => toast({ title: translate("team.documents.saveFailed"), variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
            <FileText size={18} style={{ color: PLUM }} /> {translate("team.documents.dialogTitle").replace("{name}", worker.full_name)}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.docType")}</label>
            <Select value={docType} onValueChange={(v) => setDocType(v as WorkerOnboardingDocumentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="offer_letter">{translate("team.documents.type.offer_letter")}</SelectItem>
                <SelectItem value="service_agreement">{translate("team.documents.type.service_agreement")}</SelectItem>
                <SelectItem value="other">{translate("team.documents.type.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.docTitle")}</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={translate("team.documents.docTitlePlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.notes")}</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={translate("team.documents.notesPlaceholder")} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.documents.file")}</label>
            {/* Same drag-and-drop widget already built for medication documents
                (ParticipantMedicationsPanel), reused here instead of a third upload pattern. */}
            <FileDropzone
              accept="application/pdf,image/jpeg,image/png"
              maxSizeBytes={10 * 1024 * 1024}
              onFile={setFile}
              onRejected={(reason) => toast({ title: reason, variant: "destructive" })}
              label={file ? file.name : "Drag a file here, or click to browse"}
              hint={file ? undefined : "PDF, JPEG or PNG, up to 10MB"}
            />
          </div>
        </div>

        <SheetFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{translate("common.cancel")}</Button>
          <Button
            variant="navy"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title.trim()}
          >
            {saveMut.isPending ? translate("common.saving") : translate("team.documents.save")}
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
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { requireReAuth, modal } = useReAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const byType = new Map(credentials.map((c) => [c.credential_type, c]));
  const rows = REQUIRED_CREDENTIAL_TYPES.map((type) => ({ type, credential: byType.get(type) ?? null }));
  const extras = credentials.filter((c) => !REQUIRED_CREDENTIAL_TYPES.includes(c.credential_type));
  const total = REQUIRED_CREDENTIAL_TYPES.length;
  const complete = credentialsCompleteCount >= total;

  useEffect(() => {
    if (!focusCredentialType) return;
    const el = document.getElementById(`cred-row-${focusCredentialType}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCredentialType]);

  const invalidate = () => qc.invalidateQueries({ queryKey: [orgId, "team-credentials"] });

  const reviewMutation = useMutation({
    mutationFn: ({ credential, status }: { credential: Credential; status: "valid" | "rejected" }) =>
      requireReAuth(() => reviewCredential(credential.id, { status })),
    onSuccess: () => { invalidate(); toast({ title: "Credential review saved" }); },
    onError: (err) => toast({ title: "Review failed", description: (err as Error).message, variant: "destructive" }),
  });

  const recheckMutation = useMutation({
    mutationFn: (credential: Credential) =>
      requireReAuth(() => reviewCredential(credential.id, {
        status: "valid",
        last_checked_against_nwsd: new Date().toISOString().slice(0, 10),
      })),
    onSuccess: () => { invalidate(); toast({ title: "Recorded as rechecked on the NDIS Commission portal" }); },
    onError: (err) => toast({ title: "Could not record recheck", description: (err as Error).message, variant: "destructive" }),
  });

  if (isLoading) {
    return <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>;
  }

  // Strip colour follows the same carried-over topReason as Overview and Training, not a
  // locally-recomputed complete/incomplete framing — if training overdue outranks credentials
  // as the true top blocker, this strip says so too instead of quietly disagreeing.
  const stripLevel: ReadinessLevel = topReason?.level ?? "good";
  const stripBg = stripLevel === "good" ? "var(--cc-status-success-bg)" : stripLevel === "warning" ? "var(--cc-status-warning-bg)" : "var(--cc-status-danger-bg)";
  const stripColor = stripLevel === "good" ? "var(--cc-status-success)" : stripLevel === "warning" ? "var(--cc-status-warning)" : "var(--cc-status-danger)";

  return (
    <div className="space-y-4">
      {modal}
      <div className="flex items-center justify-between gap-3 rounded-2xl px-5 py-4" style={{ background: stripBg, color: stripColor }}>
        <div>
          <p className="text-lg font-black">{credentialsCompleteCount} / {total} complete</p>
          <p className="text-xs font-bold mt-0.5">
            {topReason ? topReason.label : translate("team.detail.credentialsComplete")}
          </p>
        </div>
        {stripLevel === "good" ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
      </div>

      <div className="rounded-2xl divide-y border" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
      {[...rows, ...extras.map((c) => ({ type: c.credential_type, credential: c }))].map(({ type, credential }, i) => {
        const style = statusStyle(credential?.status ?? "missing");
        const { Icon } = style;
        const reviewable = !!credential && credential.status !== "valid";
        const canRecheck = !!credential && type === "ndis_screening" && credential.status === "valid";
        const recheckDue = !!credential && type === "ndis_screening" && isScreeningRecheckDue(credential);
        const focused = focusCredentialType === type;
        return (
          <div
            key={`${type}-${i}`}
            id={`cred-row-${type}`}
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center transition-colors"
            style={focused ? { background: "var(--cc-status-info-bg)", boxShadow: "inset 3px 0 0 var(--cc-status-info)" } : undefined}
          >
            {/* Status dot + name */}
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: style.color }} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold" style={{ color: TEXT }}>{credentialLabel(type)}</p>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                {credential
                  ? [
                      credential.credential_number ? `#${credential.credential_number}` : null,
                      credential.issuer,
                      credential.expiry_date ? `Expires ${safeFormat(credential.expiry_date)}` : null,
                    ].filter(Boolean).join(" · ") || translate("team.detail.onFile")
                  : translate("team.detail.notOnFile")}
              </p>
              {type === "ndis_screening" && credential && (
                <p className="text-xs mt-0.5 font-semibold" style={{ color: recheckDue ? "var(--cc-status-warning)" : MUTED }}>
                  {credential.screening_number ? `Screening #: ${credential.screening_number} · ` : ""}
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
            <div className="flex items-center gap-2 shrink-0">
              {credential?.status === "valid" ? (
                <span className="text-xs font-semibold" style={{ color: MUTED }}>
                  {credential.expiry_date ? `Expires ${safeFormat(credential.expiry_date)}` : translate("team.detail.onFile")}
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
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => reviewMutation.mutate({ credential: credential!, status: "valid" })}>
                    <ShieldCheck className="h-3.5 w-3.5" /> Verify
                  </Button>
                  <Button variant="ghost" size="sm" className="text-[#7C3AED]" onClick={() => reviewMutation.mutate({ credential: credential!, status: "rejected" })}>
                    Reject
                  </Button>
                </>
              )}
              {canRecheck && (
                <Button variant={recheckDue ? "outline" : "ghost"} size="sm" className="gap-1 text-[#7C3AED]" onClick={() => recheckMutation.mutate(credential!)}>
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
      return { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)", label: "Completed" };
    case "awaiting_confirmation":
      return { bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)", label: "Awaiting review" };
    case "rejected":
      return { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", label: "Rejected" };
    default:
      return { bg: SOFT, color: MUTED, label: status };
  }
}

function TrainingTab({
  worker, topReason, translate,
}: {
  worker: WorkerStats;
  /** Same value shown on Overview and Credentials — carried over, not recomputed. */
  topReason: TopReason;
  translate: (k: string) => string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);

  const assignmentsQuery = useOrgQuery(["worker-training-assignments", worker.id], {
    queryFn: () => getWorkerTrainingAssignments(worker.id),
  });

  const dismissMut = useMutation({
    mutationFn: (id: string) => dismissTrainingAssignment(id),
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-training-assignments") }); toast({ title: "Assignment removed" }); },
  });

  const reviewMut = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => reviewTrainingCompletion(id, approved),
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-training-assignments") }); toast({ title: "Training completion reviewed" }); },
  });

  const recommendations = assignmentsQuery.data?.recommendations ?? [];
  const history = assignmentsQuery.data?.history ?? [];
  const completedModuleIds = new Set(history.map((h) => h.module_id));

  // Overdue first, then soonest-due, then no-due-date last — a coordinator scanning this tab
  // should see what's overdue immediately, not have to search for it among upcoming modules.
  const now = Date.now();
  const inProgress = recommendations
    .filter((r) => !completedModuleIds.has(r.training_module_id))
    .map((r) => ({ ...r, overdue: !!r.due_at && new Date(r.due_at).getTime() < now }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return 0;
    });
  const overdueCount = inProgress.filter((r) => r.overdue).length;

  const totalModuleIds = new Set([...recommendations.map((r) => r.training_module_id), ...history.map((h) => h.module_id)]);
  const total = totalModuleIds.size;
  const completeCount = new Set(history.filter((h) => h.status === "confirmed").map((h) => h.module_id)).size;

  // Same carry-over pattern as Credentials — but only overrides the generic "N complete" text
  // with a training-specific reason if training is genuinely what's overdue here; otherwise
  // this tab still names its own overdue count rather than showing an unrelated blocker.
  const stripLevel: ReadinessLevel = overdueCount > 0 ? "danger" : (topReason?.level ?? "good");
  const stripReason = overdueCount > 0
    ? `${overdueCount} module${overdueCount !== 1 ? "s" : ""} overdue`
    : (topReason?.label ?? "All assigned training complete");
  const stripBg = stripLevel === "good" ? "var(--cc-status-success-bg)" : stripLevel === "warning" ? "var(--cc-status-warning-bg)" : "var(--cc-status-danger-bg)";
  const stripColor = stripLevel === "good" ? "var(--cc-status-success)" : stripLevel === "warning" ? "var(--cc-status-warning)" : "var(--cc-status-danger)";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl px-5 py-4" style={{ background: stripBg, color: stripColor }}>
        <div>
          <p className="text-lg font-black">{completeCount} / {total} complete</p>
          <p className="text-xs font-bold mt-0.5">{stripReason}</p>
        </div>
        {stripLevel === "good" ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} style={{ color: PLUM }} />
          <p className="text-sm font-black" style={{ color: TEXT }}>{translate("team.training.title")}</p>
        </div>
        <Button variant="navy" size="sm" className="gap-1.5 rounded-xl" onClick={() => setAssignOpen(true)}>
          <Plus size={13} /> {translate("team.training.assign")}
        </Button>
      </div>

      {assignmentsQuery.isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}

      {!assignmentsQuery.isLoading && recommendations.length === 0 && history.length === 0 && (
        <div className="rounded-2xl p-8 text-center border" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
          <GraduationCap size={28} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-sm font-bold" style={{ color: MUTED }}>{translate("team.training.empty")}</p>
        </div>
      )}

      {inProgress.length > 0 && (
        <div className="rounded-2xl divide-y border" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
          {inProgress.map((rec) => (
            <div key={rec.id} className="flex items-center gap-3 px-5 py-4">
              <IconBadge
                icon={GraduationCap}
                color={rec.overdue ? "var(--cc-status-danger)" : "var(--cc-status-info)"}
                bg={rec.overdue ? "var(--cc-status-danger-bg)" : "var(--cc-status-info-bg)"}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: TEXT }}>{rec.title}</p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                  {translate("team.training.assignedOn")} {safeFormat(rec.recommended_at)}
                  {rec.due_at ? ` · Due ${safeFormat(rec.due_at)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{
                    background: rec.overdue ? "var(--cc-status-danger-bg)" : "var(--cc-status-info-bg)",
                    color: rec.overdue ? "var(--cc-status-danger)" : "var(--cc-status-info)",
                  }}
                >
                  {rec.overdue ? "Overdue" : translate("team.training.inProgress")}
                </span>
                <button
                  onClick={() => dismissMut.mutate(rec.id)}
                  className="rounded-lg p-1.5 hover:bg-black/5"
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
          <p className="text-[10px] font-black uppercase tracking-[0.14em] mb-2" style={{ color: MUTED }}>{translate("team.training.history")}</p>
          <div className="rounded-2xl divide-y border" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
            {history.map((h) => {
              const style = completionStatusStyle(h.status);
              return (
                <div key={h.id} className="flex items-center gap-3 px-5 py-4">
                  <IconBadge icon={GraduationCap} color={style.color} bg={style.bg} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold" style={{ color: TEXT }}>{h.training_modules?.title ?? translate("team.training.module")}</p>
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>{translate("team.training.completedOn")} {safeFormat(h.completed_at)}</p>
                    {h.note && <p className="text-xs mt-0.5 italic" style={{ color: MUTED }}>"{h.note}"</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {h.status === "awaiting_confirmation" ? (
                      <>
                        <Button size="sm" variant="outline" className="text-xs gap-1 text-green-700 border-green-200 hover:bg-green-50" onClick={() => reviewMut.mutate({ id: h.id, approved: true })}>
                          <Check size={12} /> {translate("team.training.approve")}
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50" onClick={() => reviewMut.mutate({ id: h.id, approved: false })}>
                          <XIcon size={12} /> {translate("team.training.reject")}
                        </Button>
                      </>
                    ) : (
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: style.bg, color: style.color }}>
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

      <AssignTrainingDialog open={assignOpen} onOpenChange={setAssignOpen} worker={worker} translate={translate} />
    </div>
  );
}

/** One-time first-day checklist, distinct from ongoing TrainingTab — read-only
 * here (the worker ticks items off themselves), no assign/dismiss/review
 * actions since induction has no coordinator-review workflow. */
function InductionTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  const progressQuery = useOrgQuery(["worker-induction", worker.id], {
    queryFn: () => getWorkerInduction(worker.id),
  });

  const items = [...(progressQuery.data?.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const mandatoryTotal = progressQuery.data?.mandatory_total ?? 0;
  const mandatoryComplete = progressQuery.data?.mandatory_complete ?? 0;
  const allDone = mandatoryTotal > 0 && mandatoryComplete >= mandatoryTotal;
  const stripBg = mandatoryTotal === 0 ? SOFT : allDone ? "var(--cc-status-success-bg)" : "var(--cc-status-warning-bg)";
  const stripColor = mandatoryTotal === 0 ? MUTED : allDone ? "var(--cc-status-success)" : "var(--cc-status-warning)";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl px-5 py-4" style={{ background: stripBg, color: stripColor }}>
        <div>
          <p className="text-lg font-black">{mandatoryComplete} / {mandatoryTotal} mandatory complete</p>
          <p className="text-xs font-bold mt-0.5">
            {mandatoryTotal === 0 ? "No induction items set up yet" : allDone ? "Induction complete" : "Induction in progress"}
          </p>
        </div>
        {allDone ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
      </div>

      {progressQuery.isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}

      {!progressQuery.isLoading && items.length === 0 && (
        <div className="rounded-2xl p-8 text-center border" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
          <ClipboardCheck size={28} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-sm font-bold" style={{ color: MUTED }}>No induction items configured for this organisation yet.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-2xl divide-y border" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-5 py-4">
              <IconBadge
                icon={ClipboardCheck}
                color={item.completed_at ? "var(--cc-status-success)" : "var(--cc-status-warning)"}
                bg={item.completed_at ? "var(--cc-status-success-bg)" : "var(--cc-status-warning-bg)"}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: TEXT }}>{item.title}</p>
                <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                  {item.completed_at ? "Completed" : item.is_mandatory ? "Mandatory — not yet completed" : "Optional"}
                </p>
              </div>
              {item.completed_at ? (
                <CheckCircle2 size={16} style={{ color: "var(--cc-status-success)" }} />
              ) : !item.is_mandatory ? (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: SOFT, color: MUTED }}>Optional</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function complianceBandColor(band: string | undefined) {
  if (band === "green") return { color: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" };
  if (band === "amber") return { color: "var(--cc-status-warning)", bg: "var(--cc-status-warning-bg)" };
  if (band === "red") return { color: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" };
  return { color: MUTED, bg: SOFT };
}

function ShiftsTab({ worker, translate }: { worker: WorkerStats; translate: (k: string) => string }) {
  const historyQuery = useOrgQuery(["worker-shift-history", worker.id], {
    queryFn: () => getWorkerShiftHistory(worker.id),
  });
  const dashboardQuery = useOrgQuery(["worker-performance-dashboard", worker.id], {
    queryFn: () => getWorkerPerformanceDashboard(worker.id),
  });
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);

  const shifts = historyQuery.data?.shifts ?? [];
  const dashboard = dashboardQuery.data;
  const openShift = openShiftId ? shifts.find((s) => s.id === openShiftId) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Performance breakdown - the detail behind a single compliance number */}
      <div className="rounded-2xl border p-5" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Last 30 days</p>
            <p className="mt-1 text-2xl font-black" style={{ color: TEXT }}>
              {dashboard?.average_score_30d != null ? `${Math.round(dashboard.average_score_30d)}%` : "—"}
            </p>
          </div>
          {dashboard?.trend && (
            <div className="text-right">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black"
                style={complianceBandColor(dashboard.compliance_band)}
              >
                <TrendingUp size={11} style={{ transform: dashboard.trend.direction === "down" ? "scaleY(-1)" : undefined }} />
                {dashboard.trend.direction === "up" ? "Improving" : dashboard.trend.direction === "down" ? "Declining" : "Steady"}
              </span>
            </div>
          )}
        </div>
        {dashboard?.trend?.sentence && (
          <p className="mt-2 text-xs" style={{ color: MUTED }}>{dashboard.trend.sentence}</p>
        )}

        {(!!dashboard?.strengths?.length || !!dashboard?.focus_areas?.length) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {!!dashboard?.strengths?.length && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--cc-status-success)" }}>Strengths</p>
                <ul className="mt-1.5 space-y-1">
                  {dashboard.strengths.map((s) => (
                    <li key={s.label} className="text-xs" style={{ color: TEXT }}>{s.label} <span style={{ color: MUTED }}>({s.count})</span></li>
                  ))}
                </ul>
              </div>
            )}
            {!!dashboard?.focus_areas?.length && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--cc-status-warning)" }}>Focus areas</p>
                <ul className="mt-1.5 space-y-1">
                  {dashboard.focus_areas.map((s) => (
                    <li key={s.label} className="text-xs" style={{ color: TEXT }}>{s.label} <span style={{ color: MUTED }}>({s.count})</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!!dashboard?.badges?.some((b) => b.unlocked) && (
          <div className="mt-4 flex flex-wrap gap-1.5 border-t pt-3" style={{ borderColor: BORDER }}>
            {dashboard.badges.filter((b) => b.unlocked).map((b) => (
              <span key={b.key} title={b.description} className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: "var(--cc-plum-soft)", color: PLUM }}>
                {b.title}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Shift-by-shift history */}
      <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: BORDER }}>
          <p className="text-sm font-black" style={{ color: TEXT }}>Completed shifts</p>
          <span className="text-xs font-bold" style={{ color: MUTED }}>{shifts.length}</span>
        </div>
        {historyQuery.isLoading ? (
          <p className="px-5 py-6 text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>
        ) : shifts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-center" style={{ color: MUTED }}>No completed shifts on file yet.</p>
        ) : (
          <ShiftHistoryList shifts={shifts} onOpenShift={setOpenShiftId} />
        )}
      </div>

      {/* Per-shift audit trail - a side panel rather than an inline dropdown,
          so a shift with a lot to show (incidents, flagged tasks, notes) gets
          real room instead of squeezing into an expanding row. */}
      <Sheet open={!!openShift} onOpenChange={(open) => { if (!open) setOpenShiftId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" style={{ background: SURFACE }}>
          {openShift && <ShiftAuditPanel workerId={worker.id} shift={openShift} />}
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
function ShiftHistoryList({ shifts, onOpenShift }: { shifts: ShiftHistoryRow[]; onOpenShift: (id: string) => void }) {
  const firstPairingShiftIds = useMemo(() => {
    const earliestByParticipant = new Map<string, { id: string; time: number }>();
    for (const s of shifts) {
      if (!s.participant_id || !s.scheduled_start) continue;
      const time = new Date(s.scheduled_start).getTime();
      const current = earliestByParticipant.get(s.participant_id);
      if (!current || time < current.time) earliestByParticipant.set(s.participant_id, { id: s.id, time });
    }
    return new Set(Array.from(earliestByParticipant.values()).map((v) => v.id));
  }, [shifts]);

  return (
    <div className="divide-y" style={{ borderColor: BORDER }}>
      {shifts.slice(0, 30).map((s) => (
        <ShiftHistoryRowItem key={s.id} shift={s} isFirstPairing={firstPairingShiftIds.has(s.id)} onOpen={() => onOpenShift(s.id)} />
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
  shift: s, isFirstPairing, onOpen,
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
          <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{s.participant_name || "Participant"}</p>
          {isFirstPairing && (
            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase" style={{ background: "var(--cc-plum-soft)", color: PLUM }}>
              First shift
            </span>
          )}
        </div>
        <p className="text-xs mt-0.5" style={{ color: MUTED }}>
          {safeFormat(s.scheduled_start, "d MMM yyyy")}
          {timeRange ? ` · ${timeRange}` : ""}
          {s.duration_minutes ? ` · ${Math.round(s.duration_minutes / 60 * 10) / 10}h` : ""}
        </p>
        {s.compliance_explanation && (
          <p className="mt-1 text-xs truncate" style={{ color: MUTED }}>{s.compliance_explanation}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="rounded-full px-2 py-1 text-[10px] font-black" style={band}>
          {s.compliance_score != null ? `${Math.round(s.compliance_score)}%` : s.compliance_band}
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
function ShiftAuditPanel({ workerId, shift }: { workerId: string; shift: ShiftHistoryRow }) {
  const band = complianceBandColor(shift.compliance_band);
  const timeRange = formatShiftTimeRange(shift);

  const { data, isLoading } = useOrgQuery(["worker-shift-history-detail", workerId, shift.id], {
    queryFn: () => getWorkerShiftHistoryDetail(workerId, shift.id),
  });
  const { data: incidents, isLoading: incidentsLoading } = useOrgQuery(
    ["shift-incidents", shift.id],
    { queryFn: () => listIncidents<ShiftIncidentSummary[]>({ shift_id: shift.id }) },
  );

  const flagged = data?.flagged_tasks ?? [];
  const tasks = (data?.tasks ?? []) as Array<{
    task_id?: string; label?: string; completed?: boolean; marked_na?: boolean;
    has_photo?: boolean; has_voice?: boolean; note?: string;
  }>;
  const doneWell = tasks.filter(
    (t) => !t.marked_na && t.completed
      && (t.has_photo || t.has_voice || (t.note && t.note.trim().length >= 20)),
  );

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
          <ClipboardCheck size={18} style={{ color: PLUM }} />
          Shift audit — {shift.participant_name || "Participant"}
        </SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-5">
        {/* Summary: date, time, duration, participant, score, outcome */}
        <div className="rounded-xl border p-4 space-y-1.5" style={{ borderColor: BORDER, background: SOFT }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black" style={{ color: TEXT }}>
              {safeFormat(shift.scheduled_start, "EEEE d MMM yyyy")}
            </p>
            <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black" style={band}>
              {shift.compliance_score != null ? `${Math.round(shift.compliance_score)}%` : shift.compliance_band}
            </span>
          </div>
          <p className="text-xs" style={{ color: MUTED }}>
            {timeRange || "Clock in/out not recorded"}
            {shift.duration_minutes ? ` · ${Math.round(shift.duration_minutes / 60 * 10) / 10}h` : ""}
          </p>
          <p className="text-xs" style={{ color: MUTED }}>
            Participant: <span style={{ color: TEXT }}>{shift.participant_name || "Not recorded"}</span>
          </p>
          {shift.compliance_explanation && (
            <p className="pt-1.5 text-xs" style={{ color: TEXT }}>{shift.compliance_explanation}</p>
          )}
        </div>

        {/* Incidents - explicit audit-trail requirement: what happened, what
            action was taken, and when, for anything reported off this shift. */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>
            Incidents this shift
          </p>
          {incidentsLoading ? (
            <p className="text-xs" style={{ color: MUTED }}>Loading…</p>
          ) : !incidents || incidents.length === 0 ? (
            <p className="text-xs" style={{ color: MUTED }}>No incidents reported for this shift.</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="rounded-xl border p-3"
                  style={{ borderColor: "var(--cc-status-danger)", background: "var(--cc-status-danger-bg)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-black" style={{ color: TEXT }}>
                      {inc.title || (inc.incident_type ?? "incident").replace(/_/g, " ")}
                    </p>
                    {inc.severity && (
                      <span className="shrink-0 text-[9px] font-black uppercase" style={{ color: "var(--cc-status-danger)" }}>
                        {inc.severity}
                      </span>
                    )}
                  </div>
                  {inc.description && (
                    <p className="mt-1 text-xs" style={{ color: TEXT }}>{inc.description}</p>
                  )}
                  {(inc.worker_actions || inc.corrective_actions) && (
                    <p className="mt-1.5 text-xs" style={{ color: MUTED }}>
                      <span className="font-bold" style={{ color: TEXT }}>Action taken: </span>
                      {inc.worker_actions || inc.corrective_actions}
                    </p>
                  )}
                  <p className="mt-1.5 text-[10px]" style={{ color: MUTED }}>
                    {inc.incident_date ? safeFormat(inc.incident_date, "d MMM yyyy, h:mm a") : "Date not recorded"}
                    {" · "}
                    {inc.status ? String(inc.status).replace(/_/g, " ") : "Status not set"}
                    {inc.resolved_date ? ` · resolved ${safeFormat(inc.resolved_date, "d MMM yyyy")}` : ""}
                    {inc.ndis_reportable ? " · NDIS reportable" : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <p className="text-xs" style={{ color: MUTED }}>Loading shift detail…</p>
        ) : (
          <>
            {flagged.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--cc-status-danger)" }}>Flagged</p>
                <ul className="space-y-1">
                  {flagged.map((f, i) => (
                    <li key={`${f.task_id ?? "overall"}-${i}`} className="flex items-start gap-1.5 text-xs" style={{ color: TEXT }}>
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-danger)" }} />
                      <span>
                        {(f.label as string) || "Overall compliance"}
                        {f.flag_type ? ` — ${FLAG_TYPE_LABEL[f.flag_type as string] ?? f.flag_type}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {doneWell.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--cc-status-success)" }}>Done well</p>
                <ul className="space-y-1">
                  {doneWell.map((t) => (
                    <li key={t.task_id} className="flex items-start gap-1.5 text-xs" style={{ color: TEXT }}>
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-success)" }} />
                      {t.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data?.notes && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>Shift notes</p>
                <p className="whitespace-pre-wrap text-xs" style={{ color: TEXT }}>{data.notes}</p>
              </div>
            )}

            {data?.feedback && data.feedback.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>Coordinator feedback</p>
                <ul className="space-y-1.5">
                  {data.feedback.map((f) => (
                    <li key={f.id} className="text-xs" style={{ color: TEXT }}>
                      <span className="font-bold">{f.coordinator_name ?? "Coordinator"}:</span> {f.strengths}
                      {f.areas_to_improve ? ` · ${f.areas_to_improve}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="border-t pt-4" style={{ borderColor: BORDER }}>
          <ShiftMatchFeedbackForm shiftId={shift.id} />
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
  const { data: feedback, isLoading } = useOrgQuery(feedbackKey, { queryFn: () => getShiftMatchFeedback(shiftId) });

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
    mutationFn: () => postShiftMatchFeedback(shiftId, { outcome_rating: rating, would_repeat: wouldRepeat, participant_response: note || null }),
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: feedbackKey });
    },
    onError: (err) => toast({ title: "Could not save", description: (err as Error).message, variant: "destructive" }),
  });

  if (isLoading) return null;

  return (
    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: BORDER, background: SOFT }}>
      <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>How did this pairing go?</p>
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
              <Star size={16} fill={rating != null && n <= rating ? PLUM : "none"} style={{ color: PLUM }} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWouldRepeat(true)}
            className="rounded-lg px-2 py-1 text-[11px] font-bold"
            style={{ background: wouldRepeat === true ? "var(--cc-status-success-bg)" : "transparent", color: wouldRepeat === true ? "var(--cc-status-success)" : MUTED }}
          >
            Would repeat
          </button>
          <button
            type="button"
            onClick={() => setWouldRepeat(false)}
            className="rounded-lg px-2 py-1 text-[11px] font-bold"
            style={{ background: wouldRepeat === false ? "var(--cc-status-danger-bg)" : "transparent", color: wouldRepeat === false ? "var(--cc-status-danger)" : MUTED }}
          >
            Wouldn't repeat
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
        <p className="mt-2 text-xs italic" style={{ color: MUTED }}>Worker's note: "{feedback.worker_feedback}"</p>
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

function ParticipantsTab({ worker }: { worker: WorkerStats }) {
  const assignmentsQuery = useOrgQuery(["worker-assignments", worker.id], {
    queryFn: () => getWorkerAssignments(worker.id),
  });
  const assignments = assignmentsQuery.data ?? [];

  return (
    <div className="rounded-2xl border" style={{ background: SURFACE, borderColor: BORDER, boxShadow: CARD_SHADOW }}>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: BORDER }}>
        <p className="text-sm font-black" style={{ color: TEXT }}>Assigned participants</p>
        <span className="text-xs font-bold" style={{ color: MUTED }}>{assignments.length}</span>
      </div>
      {assignmentsQuery.isLoading ? (
        <p className="px-5 py-6 text-sm" style={{ color: MUTED }}>Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="px-5 py-6 text-sm text-center" style={{ color: MUTED }}>Not currently assigned to any participant.</p>
      ) : (
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {assignments.map((a) => (
            <a
              key={a.id}
              href={`/patients?id=${encodeURIComponent(a.patient_id)}`}
              className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-black/[0.02]"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{a.participant?.full_name || "Participant"}</p>
                {a.participant?.ndis_number && (
                  <p className="text-xs mt-0.5" style={{ color: MUTED }}>NDIS {a.participant.ndis_number}</p>
                )}
              </div>
              <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-black capitalize" style={{ background: SOFT, color: MUTED }}>
                {a.allocated_role.replace(/_/g, " ")}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function AssignTrainingDialog({
  open, onOpenChange, worker, translate,
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
  const modules = modulesQuery.data ?? [];

  const createModuleMut = useMutation({
    mutationFn: () => createTrainingModule({ title: newTitle.trim(), description: newDescription.trim() || undefined }),
    onSuccess: (mod: TrainingModule) => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("training-modules") });
      assignMut.mutate({ id: mod.id, title: mod.title });
    },
    onError: () => toast({ title: "Failed to create module", variant: "destructive" }),
  });

  const assignMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => assignTraining(worker.id, id, title),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("worker-training-assignments") });
      toast({ title: translate("team.training.assignedToast") });
      onOpenChange(false);
      setSelectedModuleId("");
      setNewTitle("");
      setNewDescription("");
      setMode("existing");
    },
    onError: () => toast({ title: "Failed to assign training", variant: "destructive" }),
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
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
            <GraduationCap size={18} style={{ color: PLUM }} /> {translate("team.training.assignTo").replace("{name}", worker.full_name)}
          </SheetTitle>
        </SheetHeader>

        <div className="flex gap-1 rounded-xl p-1" style={{ background: SOFT }}>
          {(["existing", "new"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors"
              style={{ background: mode === m ? "var(--cc-bg)" : "transparent", color: mode === m ? PLUM : MUTED }}
            >
              {m === "existing" ? translate("team.training.pickExisting") : translate("team.training.createNew")}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <div className="space-y-1.5 py-1">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.training.module")}</label>
            {modules.length === 0 && !modulesQuery.isLoading ? (
              <p className="text-xs" style={{ color: MUTED }}>{translate("team.training.noModules")}</p>
            ) : (
              <Select value={selectedModuleId} onValueChange={setSelectedModuleId}>
                <SelectTrigger>
                  <SelectValue placeholder={translate("team.training.chooseModule")} />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.training.moduleTitle")}</label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={translate("team.training.moduleTitlePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{translate("team.training.moduleDescription")}</label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder={translate("team.training.moduleDescriptionPlaceholder")} />
            </div>
          </div>
        )}

        <SheetFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{translate("common.cancel")}</Button>
          <Button
            variant="navy"
            onClick={handleAssign}
            disabled={pending || (mode === "existing" ? !selectedModuleId : !newTitle.trim())}
          >
            {pending ? translate("common.saving") : translate("team.training.assign")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

