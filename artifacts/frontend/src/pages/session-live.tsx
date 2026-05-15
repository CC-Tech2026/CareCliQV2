import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useGetSession, useGetParticipant } from "@workspace/api-client-react";
import { useSettings } from "@/lib/use-settings";
import { Button } from "@/components/ui/button";
import { SmartTextarea } from "@/components/SmartInput";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import {
  ArrowLeft,
  Play,
  Square,
  Mic,
  MicOff,
  Camera,
  CheckCircle2,
  Circle,
  AlertCircle,
  AlertTriangle,
  Activity,
  FileText,
  Target,
  Image as ImageIcon,
  Clock,
  Loader2,
  Globe,
  Shield,
  X,
  XCircle,
  User,
  MapPin,
  HeartPulse,
  MessageSquare,
  Users,
  Home,
  Utensils,
  BookOpen,
  ShieldCheck,
  Send,
  Paperclip,
  Plus,
  Sparkles,
  Zap,
  RefreshCw,
  BarChart2,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { translateToEnglish } from "@/services/translationService";
import {
  checkStructuredCompliance,
  combineStructuredNotes,
  type StructuredNotes,
} from "@/services/ComplianceService";
import { BodyExaminationPanel } from "@/components/BodyExaminationPanel";
import type { BodyMarker } from "@/components/BodyMap";
import {
  detectRestrictivePracticesAll,
  type RPFlag,
  RP_CATEGORY_LABELS,
} from "@/lib/rp-detector";
import { ComplianceResultPanel } from "@/components/ComplianceResultPanel";

// ---------------------------------------------------------------------------
// Brand tokens
// ---------------------------------------------------------------------------

const PURPLE = "#5533CC";
const CORAL  = "#F03060";
const LIME   = "#D9F103";
const NAVY   = "#0D0D55";
const DEEP   = "#050520";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TranslationView = "original" | "translated" | "both";

interface ChatMessage {
  id: string;
  type: "text" | "voice" | "image" | "file" | "activity" | "goal_update" | "system" | "ai_event" | "incident_prompt";
  content: string;
  timestamp: Date;
  mediaUrl?: string;
  translated?: string;
  detectedLanguage?: string;
  isTranslating?: boolean;
  activityType?: string;
  goalId?: string;
  goalStatus?: string;
  aiDelta?: number;
  linkedNoteId?: string;
}

interface GoalItem {
  id: string;
  name: string;
  status: "not_started" | "in_progress" | "achieved" | "needs_review";
}

interface LiveSummary {
  clinicalNotes: string;
  activities: string[];
  goalProgress: string[];
  complianceScore: number;
  duration: string;
  voiceNoteCount: number;
  imageCount: number;
  evidenceSummary: string;
}

interface IncidentDraft {
  step: 0 | 1 | 2;
  what: string;
  actions: string[];
  wellbeing: "stable" | "distressed" | "follow_up" | "";
}

interface BubbleMenu {
  msgId: string;
  top: number;
  right: number;
}

// ---------------------------------------------------------------------------
// Activity category definitions
// ---------------------------------------------------------------------------

interface ActivityDef {
  type: string;
  icon: LucideIcon;
  color: string;
}

interface ActivityCategory {
  label: string;
  icon: LucideIcon;
  items: ActivityDef[];
}

const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  {
    label: "Personal Care",
    icon: User,
    items: [{ type: "Personal Care", icon: User, color: "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100" }],
  },
  {
    label: "Community Access",
    icon: MapPin,
    items: [{ type: "Community Access", icon: MapPin, color: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100" }],
  },
  {
    label: "Therapy Support",
    icon: HeartPulse,
    items: [
      { type: "Mobility Support", icon: Activity, color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" },
      { type: "Behaviour Support", icon: ShieldCheck, color: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" },
    ],
  },
  {
    label: "Communication",
    icon: MessageSquare,
    items: [
      { type: "Communication", icon: MessageSquare, color: "bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100" },
      { type: "Social Skills", icon: Users, color: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100" },
    ],
  },
  {
    label: "Daily Living",
    icon: Home,
    items: [
      { type: "Meal Preparation", icon: Utensils, color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100" },
      { type: "Life Skills", icon: BookOpen, color: "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100" },
    ],
  },
];

function findActivityDef(type: string): ActivityDef | undefined {
  for (const cat of ACTIVITY_CATEGORIES) {
    const found = cat.items.find((a) => a.type === type);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Goal status config
// ---------------------------------------------------------------------------

const GOAL_STATUS_CONFIG = {
  not_started: { label: "Not Started", cls: "bg-slate-700 text-white/50 border-slate-600", icon: Circle },
  in_progress: { label: "In Progress", cls: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: Activity },
  achieved:    { label: "Achieved",    cls: "bg-[#D9F103]/20 text-[#D9F103] border-[#D9F103]/30", icon: CheckCircle2 },
  needs_review:{ label: "Needs Review",cls: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: AlertCircle },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPOSER_PLACEHOLDERS = [
  "What progress did the participant make?",
  "Describe independence or engagement observed…",
  "Mention emotional regulation outcomes…",
  "What support was provided today?",
  "Describe any changes in participant wellbeing…",
];

const INCIDENT_KEYWORDS = /\b(fall|fell|injur|aggress|unsafe|medication error|overdose|seizure|chok|self.?harm|accident|hurt|blood|bruise|hospital|emergency|ambulance|police|paramedic|restrain|seclu)\w*/i;

const OUTCOME_KEYWORDS = /\b(independen|progress|achiev|improve|engag|communicat|participat|calm|settled|confident|motivated|cooperat|goal|success|reduc\w+ prompt)\w*/i;
const GOAL_KEYWORDS    = /\b(goal|target|objective|milestone|outcome|skill)\w*/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function deriveSessionStateLabel(isActive: boolean, score: number): {
  label: string;
  color: string;
  dot: string;
} {
  if (!isActive) return { label: "Idle", color: "bg-slate-700 text-slate-300 border-slate-600", dot: "bg-slate-400" };
  if (score >= 80) return { label: "Claim Ready", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400 animate-pulse" };
  if (score >= 60) return { label: "Live",        color: "bg-blue-500/20 text-blue-300 border-blue-500/30",        dot: "bg-blue-400 animate-pulse" };
  return              { label: "Needs Review",    color: "bg-amber-500/20 text-amber-300 border-amber-500/30",    dot: "bg-amber-400 animate-pulse" };
}

function deriveComplianceActionLabel(score: number, checks: Array<{ label: string; pass: boolean }>): string {
  if (score >= 80) return "Claim Ready";
  const failed = checks.filter((c) => !c.pass).map((c) => c.label);
  if (failed.includes("Goals linked")) return "Link Participant Goals";
  if (failed.includes("Clinical notes completed")) return "Add Clinical Notes";
  if (failed.includes("Activity logged")) return "Log Activities";
  if (failed.includes("Duration recorded")) return "Start Timer";
  if (failed.includes("Photo evidence captured")) return "Add Photo Evidence";
  return "Building Documentation…";
}

function buildSummaryFromMessages(
  session: { session_type: string; duration_minutes: number; notes?: string | null },
  messages: ChatMessage[],
  goals: GoalItem[],
  elapsed: number,
  translationView: TranslationView,
): LiveSummary {
  const durationMins = Math.max(Math.round(elapsed / 60), 1);
  const activityMsgs = messages.filter((m) => m.type === "activity");
  const voiceMsgs    = messages.filter((m) => m.type === "voice");
  const imageMsgs    = messages.filter((m) => m.type === "image");
  const textMsgs     = messages.filter((m) => m.type === "text");

  const activityTypes  = [...new Set(activityMsgs.map((m) => m.activityType || m.content))];
  const achievedGoals  = goals.filter((g) => g.status === "achieved");
  const inProgressGoals= goals.filter((g) => g.status === "in_progress");
  const goalProgress   = goals
    .filter((g) => g.status !== "not_started")
    .map((g) => `${g.name}: ${GOAL_STATUS_CONFIG[g.status].label}`);

  const voiceTexts = voiceMsgs
    .map((v) => (translationView !== "original" && v.translated ? v.translated : v.content))
    .filter(Boolean);
  const allTexts = [...textMsgs.map((m) => m.content), ...voiceTexts];

  const lines: string[] = [];
  lines.push("SESSION RECORD");
  lines.push(`Type: ${session.session_type} | Duration: ${durationMins} minutes`);
  lines.push("");
  if (activityTypes.length > 0) {
    lines.push(`Support provided: ${activityTypes.join(", ")}.`);
  } else {
    lines.push("Support provided: General assistance and supervision.");
  }
  if (achievedGoals.length > 0) lines.push(`Goals achieved: ${achievedGoals.map((g) => g.name).join(", ")}.`);
  if (inProgressGoals.length > 0) lines.push(`Goals worked on: ${inProgressGoals.map((g) => g.name).join(", ")}.`);
  if (allTexts.length > 0) {
    lines.push("");
    lines.push("Practitioner observations:");
    allTexts.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
  }
  if (imageMsgs.length > 0) {
    lines.push("");
    lines.push(`Evidence: ${imageMsgs.length} photo${imageMsgs.length > 1 ? "s" : ""} captured.`);
  }
  if (session.notes) {
    lines.push("");
    lines.push(`Pre-session notes: ${session.notes}`);
  }
  if (translationView !== "original") lines.unshift("[Observations translated to English]\n");

  const clinicalNotes = lines.join("\n");
  let score = 0;
  if (clinicalNotes.length > 30) score += 30;
  if (activityMsgs.length > 0) score += 30;
  if (durationMins > 0) score += 20;
  if (session.session_type) score += 20;
  score = Math.min(score, 100);

  return {
    clinicalNotes,
    activities:    activityMsgs.map((a) => `${a.activityType || a.content} (${format(a.timestamp, "HH:mm")})`),
    goalProgress,
    complianceScore: score,
    duration:       formatDuration(elapsed),
    voiceNoteCount: voiceMsgs.length,
    imageCount:     imageMsgs.length,
    evidenceSummary:
      imageMsgs.length > 0
        ? `${imageMsgs.length} photo${imageMsgs.length > 1 ? "s" : ""} captured`
        : "No photos captured",
  };
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  translationView,
  onLongPress,
  onOpenIncident,
}: {
  msg: ChatMessage;
  translationView: TranslationView;
  onLongPress?: (msgId: string, el: HTMLElement) => void;
  onOpenIncident?: (triggerText: string) => void;
}) {
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleTouchStart() {
    longPressRef.current = setTimeout(() => {
      // Get the element via the touch
      onLongPress?.(msg.id, document.getElementById(`msg-${msg.id}`) as HTMLElement);
    }, 600);
  }
  function handleTouchEnd() {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  }
  function handleContextMenu(e: React.MouseEvent<HTMLElement>) {
    e.preventDefault();
    onLongPress?.(msg.id, e.currentTarget);
  }

  if (msg.type === "system") {
    return (
      <div className="flex justify-center my-2 px-4">
        <span className="text-[10px] text-white/25 italic">{msg.content}</span>
      </div>
    );
  }

  if (msg.type === "ai_event") {
    return (
      <div className="flex justify-center my-2 px-4">
        <div className="flex items-center gap-2 bg-[#5533CC]/12 border border-[#5533CC]/20 rounded-2xl px-4 py-2 max-w-xs">
          <Sparkles className="h-3 w-3 shrink-0" style={{ color: PURPLE }} />
          <span className="text-[10px] font-medium" style={{ color: "#A89EDD" }}>{msg.content}</span>
          {msg.aiDelta != null && msg.aiDelta > 0 && (
            <span className="text-[9px] font-bold" style={{ color: LIME }}>+{msg.aiDelta}%</span>
          )}
        </div>
      </div>
    );
  }

  if (msg.type === "incident_prompt") {
    return (
      <div className="flex justify-center my-2 px-4">
        <button
          onClick={() => onOpenIncident?.(msg.content)}
          className="w-full max-w-xs bg-amber-950/60 border border-amber-700/40 rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-amber-200 text-[11px] font-semibold">Potential incident noted</p>
              <p className="text-amber-300/70 text-[10px] mt-0.5">Tap to document this safely →</p>
            </div>
          </div>
        </button>
      </div>
    );
  }

  if (msg.type === "activity") {
    const def = findActivityDef(msg.activityType || msg.content);
    const AIcon = def?.icon ?? Activity;
    return (
      <div className="flex justify-center my-1.5">
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-full px-3 py-1">
          <AIcon className="h-2.5 w-2.5 shrink-0" style={{ color: LIME }} />
          <span className="text-[10px] text-white/60 font-medium">{msg.activityType || msg.content}</span>
          <span className="text-[9px] text-white/25">• {format(msg.timestamp, "HH:mm")}</span>
        </div>
      </div>
    );
  }

  if (msg.type === "goal_update") {
    return (
      <div className="flex justify-center my-1.5">
        <div className="flex items-center gap-1.5 bg-[#D9F103]/8 border border-[#D9F103]/15 rounded-full px-3 py-1">
          <Target className="h-2.5 w-2.5 shrink-0" style={{ color: LIME }} />
          <span className="text-[10px] text-[#D9F103]/70 font-medium">{msg.content}</span>
          <span className="text-[9px] text-[#D9F103]/30">• {format(msg.timestamp, "HH:mm")}</span>
        </div>
      </div>
    );
  }

  // Worker messages: text, voice, image, file — right aligned
  const isInteractive = msg.type === "text" || msg.type === "voice";
  return (
    <div className="flex justify-end px-1 my-0.5">
      <div
        id={`msg-${msg.id}`}
        className="max-w-[82%] min-w-[60px]"
        onTouchStart={isInteractive ? handleTouchStart : undefined}
        onTouchEnd={isInteractive ? handleTouchEnd : undefined}
        onContextMenu={isInteractive ? handleContextMenu : undefined}
      >
        <div className="bg-[#1a1a6e] border border-[#5271FF]/25 rounded-2xl rounded-tr-sm overflow-hidden shadow-sm">
          {msg.type === "image" && msg.mediaUrl && (
            <div className="relative">
              <img src={msg.mediaUrl} className="w-full max-h-52 object-cover" alt="Evidence" />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                <div className="flex items-center gap-1 text-white/60 text-[9px]">
                  <Camera className="h-2.5 w-2.5" />
                  <span>Photo evidence • {format(msg.timestamp, "HH:mm")}</span>
                </div>
              </div>
            </div>
          )}
          {msg.type === "file" && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-9 w-9 bg-[#5271FF]/20 rounded-lg flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-[#5271FF]" />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-medium leading-tight truncate">{msg.content}</p>
                <p className="text-white/35 text-[10px]">Document attached</p>
              </div>
            </div>
          )}
          {(msg.type === "text" || msg.type === "voice") && (
            <div className="px-4 py-3">
              {msg.type === "voice" && (
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <div className="flex items-center gap-1" style={{ color: LIME }}>
                    <Mic className="h-3 w-3" />
                    <span className="text-[9px] font-bold uppercase tracking-wider">Voice Note</span>
                  </div>
                  {msg.detectedLanguage && msg.detectedLanguage !== "en" && (
                    <span className="text-[9px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-full">
                      {msg.detectedLanguage.toUpperCase()}
                    </span>
                  )}
                  {msg.isTranslating && (
                    <div className="flex items-center gap-1 text-white/35">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      <span className="text-[9px]">Translating…</span>
                    </div>
                  )}
                </div>
              )}
              {(translationView === "original" || translationView === "both" || msg.type === "text") && (
                <p className="text-white text-sm leading-relaxed">{msg.content}</p>
              )}
              {msg.type === "voice" && translationView !== "original" && (
                <div className={cn(translationView === "both" && "mt-2 pt-2 border-t border-white/10")}>
                  {msg.translated ? (
                    <>
                      {translationView === "both" && (
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: LIME }}>EN</p>
                      )}
                      <p className="text-white/80 text-sm leading-relaxed">{msg.translated}</p>
                    </>
                  ) : !msg.isTranslating ? (
                    <p className="text-white/30 text-xs italic">Translation unavailable</p>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="text-white/20 text-[9px] text-right mt-0.5 pr-1">{format(msg.timestamp, "HH:mm")}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreRing
// ---------------------------------------------------------------------------

function ScoreRing({ score }: { score: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <div className="relative flex items-center justify-center w-28 h-28 mx-auto">
      <svg className="absolute inset-0 -rotate-90" width="112" height="112" viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
        <circle
          cx="56" cy="56" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="text-center z-10">
        <p className="text-3xl font-black text-white leading-none">{score}</p>
        <p className="text-[9px] text-white/50 mt-0.5">/ 100</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SessionLive() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: session, isLoading } = useGetSession(id as string, {
    query: { enabled: !!id, queryKey: ["getSession", id] },
  });
  const participantId = session?.participant_id ?? "";
  const { data: participant } = useGetParticipant(participantId, {
    query: { enabled: !!participantId, queryKey: ["getParticipant", participantId] },
  });

  const resolvedGoalTitles: string[] = (() => {
    const addressed = session?.goals_addressed ?? [];
    if (!addressed.length) return [];
    const participantGoals = participant?.goals ?? [];
    const goalMap: Record<string, string> = {};
    for (const g of participantGoals) {
      if (typeof g === "object" && g !== null) {
        const gObj = g as { id?: unknown; title?: unknown };
        if (gObj.id && gObj.title) goalMap[String(gObj.id)] = String(gObj.title);
      }
    }
    return addressed.map((gid) => goalMap[gid] ?? gid);
  })();

  const { settings } = useSettings();

  // ── Primary state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [inputText, setInputText] = useState("");

  // ── Timer ──
  const [isActive, setIsActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const autoStartAppliedRef = useRef(false);

  // ── Voice ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordingText, setRecordingText] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const stopIntentRef = useRef(false);

  // ── Body markers ──
  const [bodyMarkers, setBodyMarkers] = useState<BodyMarker[]>([]);
  const bodyMarkersInitRef = useRef(false);
  const bodyMarkersDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Translation ──
  const [translationView, setTranslationView] = useState<TranslationView>("original");

  // ── UI panels ──
  const [showActivitySheet, setShowActivitySheet] = useState(false);
  const [bodyMapOpen, setBodyMapOpen] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [expandedHealthChip, setExpandedHealthChip] = useState<string | null>(null);
  const [showGoalPicker, setShowGoalPicker] = useState(false);
  const [goalPickerMsgId, setGoalPickerMsgId] = useState<string | null>(null);

  // ── Placeholder rotation ──
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  // ── Bubble long-press menu ──
  const [bubbleMenu, setBubbleMenu] = useState<BubbleMenu | null>(null);
  const [improvingMsgId, setImprovingMsgId] = useState<string | null>(null);

  // ── Incident guided sheet ──
  const [showIncidentSheet, setShowIncidentSheet] = useState(false);
  const [incidentDraft, setIncidentDraft] = useState<IncidentDraft>({
    step: 0, what: "", actions: [], wellbeing: "",
  });

  // ── Approval / completion ──
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [editableNotes, setEditableNotes] = useState("");
  const hasManuallyEditedNotesRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [structuredNotes, setStructuredNotes] = useState<StructuredNotes>({
    activitiesPerformed: "",
    outcomes: "",
    participantResponse: "",
    progressTowardGoals: "",
  });

  // ── Modals ──
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  // ── RP detection ──
  const [rpFlags, setRpFlags] = useState<RPFlag[]>([]);
  const [showRpBottomSheet, setShowRpBottomSheet] = useState(false);
  const [rpAcknowledged, setRpAcknowledged] = useState(false);
  const rpDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── AI micro-events ──
  const prevScoreRef = useRef(0);
  const prevRpCountRef = useRef(0);

  // ── Post-save result ──
  interface PostSaveResult {
    score: number;
    status: string;
    rules?: Array<{ label: string; pass: boolean; note?: string }>;
    rpFlags?: RPFlag[];
  }
  const [postSaveResult, setPostSaveResult] = useState<PostSaveResult | null>(null);

  // ── Plan Goals (Goal Rules Matrix) ──
  const [planGoals, setPlanGoals] = useState<Array<{ id: string; description: string; category: string; is_achieved: boolean }>>([]);
  const [riskProfile, setRiskProfile] = useState<{ risk_level: string; triggers: string; management_plan: string } | null>(null);
  const [showGoalMatrix, setShowGoalMatrix] = useState(false);

  // ── Real-time assess-note score ──
  const [assessScore, setAssessScore] = useState<{
    score: number;
    is_ready_for_billing: boolean;
    breakdown: Record<string, { score: number; max: number; label: string; feedback?: string }>;
    feedback: string;
  } | null>(null);
  const [assessLoading, setAssessLoading] = useState(false);
  const assessDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Reminder ──
  const reminderTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // ── Refs ──
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAttachRef = useRef<HTMLInputElement>(null);
  const messagesInitRef = useRef(false);

  // ── Derived ──
  const activityMessages = messages.filter((m) => m.type === "activity");
  const voiceMessages    = messages.filter((m) => m.type === "voice");
  const imageMessages    = messages.filter((m) => m.type === "image");
  const imageUrls        = imageMessages.map((m) => m.mediaUrl!).filter(Boolean);

  // ── addMessage helper ──
  const addMessage = useCallback(
    (msg: Omit<ChatMessage, "id">): ChatMessage => {
      const newMsg: ChatMessage = { ...msg, id: crypto.randomUUID() };
      setMessages((prev) => [...prev, newMsg]);
      if (id && !["ai_event", "incident_prompt"].includes(msg.type)) {
        fetch(`/api/sessions/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_type: msg.type,
            content: msg.content,
            media_url: (msg as ChatMessage).mediaUrl ?? null,
            sender_role: ["activity", "goal_update", "system"].includes(msg.type) ? "system" : "worker",
            created_at: msg.timestamp.toISOString(),
          }),
        }).catch(() => {});
      }
      return newMsg;
    },
    [id],
  );

  const updateMessage = useCallback((msgId: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ...updates } : m)));
  }, []);

  // ── Auto-scroll ──
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isRecording]);

  // ── Keep combined notes in sync ──
  useEffect(() => {
    if (hasManuallyEditedNotesRef.current) return;
    setEditableNotes(combineStructuredNotes(structuredNotes));
  }, [structuredNotes]);

  // ── Load existing messages ──
  useEffect(() => {
    if (!session?.id || messagesInitRef.current) return;
    messagesInitRef.current = true;
    fetch(`/api/sessions/${session.id}/messages`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages(
            (data as Array<{ id: string; message_type: string; content: string; created_at: string; media_url?: string }>)
              .map((m) => ({
                id: m.id,
                type: m.message_type as ChatMessage["type"],
                content: m.content || "",
                timestamp: new Date(m.created_at),
                mediaUrl: m.media_url || undefined,
              })),
          );
        } else {
          setMessages([{ id: crypto.randomUUID(), type: "system", content: `${session.session_type} session`, timestamp: new Date() }]);
        }
      })
      .catch(() => {
        setMessages([{ id: crypto.randomUUID(), type: "system", content: `${session.session_type} session`, timestamp: new Date() }]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // ── Init body markers ──
  useEffect(() => {
    if (!session || bodyMarkersInitRef.current) return;
    bodyMarkersInitRef.current = true;
    const raw = (session as unknown as { body_markers?: unknown }).body_markers;
    if (Array.isArray(raw) && raw.length > 0) setBodyMarkers(raw as BodyMarker[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // ── Body markers debounced save ──
  const bodyMarkersAutoSaveSkipRef = useRef(true);
  useEffect(() => {
    if (bodyMarkersAutoSaveSkipRef.current) { bodyMarkersAutoSaveSkipRef.current = false; return; }
    if (!id) return;
    if (bodyMarkersDebounceRef.current) clearTimeout(bodyMarkersDebounceRef.current);
    bodyMarkersDebounceRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body_markers: bodyMarkers }),
        });
      } catch { /* silent */ }
    }, 1500);
    return () => { if (bodyMarkersDebounceRef.current) clearTimeout(bodyMarkersDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyMarkers]);

  // ── Init goals + fetch session context (plan goals + risk profile) ──
  useEffect(() => {
    if (!session?.id) return;

    // Seed goal chips from session.goals_addressed (fast, from existing data)
    if (goals.length === 0) {
      const addressed = session.goals_addressed ?? [];
      if (addressed.length > 0 && resolvedGoalTitles.length > 0) {
        setGoals(addressed.map((gid, i) => ({ id: gid, name: resolvedGoalTitles[i] ?? gid, status: "not_started" as const })));
      } else if (addressed.length > 0) {
        setGoals(addressed.map((gid) => ({ id: gid, name: gid, status: "not_started" as const })));
      }
    }

    // Fetch full context payload (plan goals + risk profile)
    fetch(`/api/sessions/${session.id}/context`)
      .then((r) => r.ok ? r.json() : null)
      .then((ctx) => {
        if (!ctx) return;
        if (Array.isArray(ctx.plan_goals) && ctx.plan_goals.length > 0) {
          setPlanGoals(ctx.plan_goals);
          // If no goal chips yet, seed from plan goals
          setGoals((prev) => {
            if (prev.length > 0) return prev;
            return ctx.plan_goals
              .filter((g: any) => !g.is_achieved)
              .map((g: any) => ({ id: g.id, name: g.description?.slice(0, 60) ?? g.id, status: "not_started" as const }));
          });
        }
        if (ctx.risk_profile && ctx.risk_profile.risk_level && ctx.risk_profile.risk_level !== "low") {
          setRiskProfile(ctx.risk_profile);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, resolvedGoalTitles.join(",")]);

  // ── Debounced assess-note ──
  useEffect(() => {
    const noteText = [
      structuredNotes.activitiesPerformed,
      structuredNotes.outcomes,
      structuredNotes.participantResponse,
      structuredNotes.progressTowardGoals,
    ].filter(Boolean).join("\n");

    if (noteText.trim().length < 20) return;

    if (assessDebounceRef.current) clearTimeout(assessDebounceRef.current);
    assessDebounceRef.current = setTimeout(async () => {
      setAssessLoading(true);
      try {
        const res = await fetch("/api/ai/assess-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note_text: noteText,
            session_id: id,
            participant_id: participantId || undefined,
            session_started: isActive,
            goals: planGoals.map((g) => ({ id: g.id, description: g.description, category: g.category })),
          }),
        });
        if (res.ok) setAssessScore(await res.json());
      } catch { /* silent */ }
      finally { setAssessLoading(false); }
    }, 2500);

    return () => { if (assessDebounceRef.current) clearTimeout(assessDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuredNotes.activitiesPerformed, structuredNotes.outcomes, structuredNotes.participantResponse, structuredNotes.progressTowardGoals, isActive]);

  // ── Timer ──
  useEffect(() => {
    if (isActive) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive]);

  // ── Auto-start from settings ──
  useEffect(() => {
    if (!session || !settings || autoStartAppliedRef.current || isActive) return;
    if (settings.sessionDefaults?.autoStartTimer) {
      autoStartAppliedRef.current = true;
      startTimeRef.current = new Date();
      setIsActive(true);
      setElapsed(0);
      setReminderDismissed(true);
      toast({ title: "Session started", description: "Timer started automatically." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, settings]);

  // ── Start reminder ──
  useEffect(() => {
    if (!session || isActive || reminderDismissed) return;
    reminderTimerRef.current = setTimeout(() => {
      toast({
        title: "Session scheduled",
        description: `Ready: ${session.session_type}`,
        duration: 30000,
        action: (
          <ToastAction
            altText="Start Session"
            onClick={() => { handleStart(); setReminderDismissed(true); }}
            className="bg-emerald-600 text-white hover:bg-emerald-700 border-0 text-xs font-semibold"
          >
            Start Session
          </ToastAction>
        ),
      });
      setReminderDismissed(true);
    }, 5000);
    return () => { if (reminderTimerRef.current) clearTimeout(reminderTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isActive]);

  // ── RP detection ──
  useEffect(() => {
    if (rpDebounceRef.current) clearTimeout(rpDebounceRef.current);
    rpDebounceRef.current = setTimeout(() => {
      const flags = detectRestrictivePracticesAll([
        ...messages.filter((m) => ["text", "voice"].includes(m.type)).map((m) => m.content),
        recordingText, editableNotes,
        structuredNotes.activitiesPerformed, structuredNotes.outcomes,
        structuredNotes.participantResponse, structuredNotes.progressTowardGoals,
      ]);
      setRpFlags(flags);
    }, 600);
    return () => { if (rpDebounceRef.current) clearTimeout(rpDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, recordingText, editableNotes,
      structuredNotes.activitiesPerformed, structuredNotes.outcomes,
      structuredNotes.participantResponse, structuredNotes.progressTowardGoals]);

  // ── Placeholder rotation ──
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % COMPOSER_PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // ── AI micro-event injection ──
  const aiMicroEventDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compliance-delta AI event: inject when score increases >= 5 points
  useEffect(() => {
    if (!isActive) return;
    const score = checkStructuredCompliance(
      structuredNotes,
      !!(session?.participant_id),
      elapsed > 0 ? Math.max(1, Math.round(elapsed / 60)) : 0,
      messages.filter((m) => m.type === "activity").length,
      messages.filter((m) => m.type === "image").map((m) => m.mediaUrl!).filter(Boolean).length,
      session?.goals_addressed?.length ?? 0,
    ).score;
    if (score - prevScoreRef.current >= 5 && score > 0) {
      const delta = score - prevScoreRef.current;
      prevScoreRef.current = score;
      if (aiMicroEventDebounce.current) clearTimeout(aiMicroEventDebounce.current);
      aiMicroEventDebounce.current = setTimeout(() => {
        addMessage({
          type: "ai_event",
          content: `Documentation improving — ${score}% compliance`,
          timestamp: new Date(),
          aiDelta: delta,
        });
      }, 300);
    } else if (score > prevScoreRef.current) {
      prevScoreRef.current = score;
    }
    return () => { if (aiMicroEventDebounce.current) clearTimeout(aiMicroEventDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, structuredNotes, elapsed, isActive]);

  // Inject RP detection event
  useEffect(() => {
    if (!isActive) return;
    if (rpFlags.length > prevRpCountRef.current && rpFlags.length > 0) {
      prevRpCountRef.current = rpFlags.length;
      addMessage({
        type: "ai_event",
        content: `Possible restrictive practice language detected — review before saving`,
        timestamp: new Date(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpFlags.length, isActive]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleStart = () => {
    startTimeRef.current = new Date();
    setIsActive(true);
    setElapsed(0);
    setReminderDismissed(true);
    if (reminderTimerRef.current) clearTimeout(reminderTimerRef.current);
    addMessage({ type: "system", content: "Session started", timestamp: new Date() });
    toast({ title: "Session started", description: "Start documenting below." });
    if (settings?.sessionDefaults?.enableVoice) {
      setTimeout(() => startRecording(), 300);
    }
  };

  const checkIncidentTriggers = (text: string) => {
    if (!INCIDENT_KEYWORDS.test(text)) return;
    // Only add if the last message is not already an incident_prompt
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.type === "incident_prompt") return prev;
      return [...prev, { id: crypto.randomUUID(), type: "incident_prompt", content: text, timestamp: new Date() }];
    });
  };

  const injectAiMicroEvent = useCallback((content: string, delta?: number) => {
    if (!isActive) return;
    if (aiMicroEventDebounce.current) clearTimeout(aiMicroEventDebounce.current);
    aiMicroEventDebounce.current = setTimeout(() => {
      addMessage({ type: "ai_event", content, timestamp: new Date(), aiDelta: delta });
    }, 200);
  }, [isActive, addMessage]);

  const sendTextMessage = () => {
    if (!inputText.trim()) return;
    if (!isActive) { toast({ title: "Start the session first", variant: "destructive" }); return; }
    addMessage({ type: "text", content: inputText.trim(), timestamp: new Date() });
    checkIncidentTriggers(inputText.trim());
    setInputText("");
  };

  const logActivity = (type: string) => {
    if (!isActive) { toast({ title: "Start the session first", variant: "destructive" }); setShowActivitySheet(false); return; }
    addMessage({ type: "activity", content: type, timestamp: new Date(), activityType: type });
    setShowActivitySheet(false);
    setShowFab(false);
    toast({ title: `${type} logged` });
    // Inject AI micro-event after activity log
    setTimeout(() => injectAiMicroEvent("Activity logged — compliance improving", 10), 800);
  };

  const cycleGoalStatus = (goalId: string) => {
    const cycle: GoalItem["status"][] = ["not_started", "in_progress", "achieved", "needs_review"];
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const idx = cycle.indexOf(goal.status);
    const newStatus = cycle[(idx + 1) % cycle.length];
    setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, status: newStatus } : g)));
    addMessage({ type: "goal_update", content: `${goal.name} → ${GOAL_STATUS_CONFIG[newStatus].label}`, timestamp: new Date(), goalId, goalStatus: newStatus });
    if (newStatus === "achieved") {
      setTimeout(() => injectAiMicroEvent(`Goal achieved: ${goal.name}`, 8), 600);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    addMessage({ type: "image", content: "Photo evidence", timestamp: new Date(), mediaUrl: url });
    toast({ title: "Photo captured", description: format(new Date(), "HH:mm:ss") });
    e.target.value = "";
    setTimeout(() => injectAiMicroEvent("Photo evidence captured — strengthens claim", 10), 600);
  };

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addMessage({ type: "file", content: file.name, timestamp: new Date() });
    toast({ title: "File attached", description: file.name });
    e.target.value = "";
  };

  const startRecording = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognitionClass = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      toast({ title: "Voice not supported", description: "Use Chrome for voice notes.", variant: "destructive" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-AU";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setRecordingText(transcript);
    };
    recognition.onerror = () => { setIsRecording(false); setRecordingText(""); };
    recognition.onend = () => { if (!stopIntentRef.current) recognition.start(); };
    stopIntentRef.current = false;
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setShowFab(false);
  };

  const stopRecording = async () => {
    stopIntentRef.current = true;
    recognitionRef.current?.stop();
    setIsRecording(false);
    const text = recordingText.trim();
    if (!text) return;

    const needsTranslation = translationView !== "original";
    const newMsg = addMessage({ type: "voice", content: text, timestamp: new Date(), isTranslating: needsTranslation });
    setRecordingText("");
    toast({ title: "Voice note saved" });
    checkIncidentTriggers(text);

    // Detect outcome/goal language
    if (OUTCOME_KEYWORDS.test(text)) {
      setTimeout(() => injectAiMicroEvent("Outcome language detected", 8), 500);
    } else if (GOAL_KEYWORDS.test(text)) {
      setTimeout(() => injectAiMicroEvent("Goal reference detected", 5), 500);
    }

    if (needsTranslation) {
      try {
        const result = await translateToEnglish(text);
        updateMessage(newMsg.id, { isTranslating: false, translated: result.translated, detectedLanguage: result.detectedLanguage });
      } catch {
        updateMessage(newMsg.id, { isTranslating: false });
        toast({ title: "Translation unavailable", description: "Original text preserved.", variant: "destructive" });
      }
    }
  };

  const handleStop = useCallback(async () => {
    if (elapsed === 0) {
      toast({ title: "Session not started", description: 'Click "Start" to begin the timer before ending.', variant: "destructive" });
      return;
    }

    const actMsgs  = messages.filter((m) => m.type === "activity");
    const vMsgs    = messages.filter((m) => m.type === "voice");
    const tMsgs    = messages.filter((m) => m.type === "text");
    const activityTypes   = [...new Set(actMsgs.map((m) => m.activityType || m.content))];
    const achievedGoals   = goals.filter((g) => g.status === "achieved");
    const inProgressGoals = goals.filter((g) => g.status === "in_progress");
    const voiceTexts = vMsgs.map((v) => (translationView !== "original" && v.translated ? v.translated : v.content)).filter(Boolean);
    const textContent = tMsgs.map((m) => m.content);
    const allObs = [...voiceTexts, ...textContent];

    const prefilledHasContent = activityTypes.length > 0 || voiceTexts.length > 0 || textContent.length > 0;
    if (!prefilledHasContent && !session?.notes?.trim()) {
      toast({ title: "Nothing to document yet", description: "Log an activity or add a note before reviewing.", variant: "destructive" });
      return;
    }

    hasManuallyEditedNotesRef.current = false;
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) { stopIntentRef.current = true; recognitionRef.current?.stop(); setIsRecording(false); }

    setSummaryLoading(true);
    setShowSummary(true);

    const prefilled: StructuredNotes = {
      activitiesPerformed: activityTypes.join(", "),
      outcomes: [
        achievedGoals.length > 0 ? `Goals achieved: ${achievedGoals.map((g) => g.name).join(", ")}.` : "",
        allObs.length > 0 ? `Observations: ${allObs.slice(0, 2).join(" ")}` : "",
      ].filter(Boolean).join("\n"),
      participantResponse: "",
      progressTowardGoals: goals.filter((g) => g.status !== "not_started").map((g) => `${g.name}: ${GOAL_STATUS_CONFIG[g.status].label}`).join("\n"),
    };

    const s = buildSummaryFromMessages(
      { session_type: session?.session_type ?? "Session", duration_minutes: session?.duration_minutes ?? 0, notes: session?.notes },
      messages, goals, elapsed, translationView,
    );
    setSummary(s);
    setStructuredNotes(prefilled);
    setSummaryLoading(false);
  }, [session, messages, goals, elapsed, translationView, isRecording, toast]);

  const handleApproveAndSave = useCallback(async () => {
    setShowRpBottomSheet(false);
    if (!id) { navigate("/sessions"); return; }

    const compSettings = settings?.compliance;
    const actMsgs = messages.filter((m) => m.type === "activity");
    const vMsgs   = messages.filter((m) => m.type === "voice");
    const iMsgs   = messages.filter((m) => m.type === "image");
    const iUrls   = iMsgs.map((m) => m.mediaUrl!).filter(Boolean);

    if (compSettings?.requireActivity && actMsgs.length === 0) {
      toast({ title: "Session cannot be approved: no activity logged", variant: "destructive" }); return;
    }
    if (compSettings?.requireNotes) {
      const hasNotes = [structuredNotes.activitiesPerformed, structuredNotes.outcomes, structuredNotes.participantResponse]
        .some((f) => f.trim().length > 0) || editableNotes.trim().length > 0;
      if (!hasNotes) { toast({ title: "Session cannot be approved: clinical notes are required", variant: "destructive" }); return; }
    }
    if (compSettings?.requireDuration && elapsed === 0) {
      toast({ title: "Session cannot be approved: session duration not recorded", variant: "destructive" }); return;
    }

    setIsSaving(true);

    const transcription = vMsgs.map((n) =>
      `[${format(n.timestamp, "HH:mm")}] ${n.content}${n.translated && n.translated !== n.content ? ` [EN: ${n.translated}]` : ""}`
    ).join("\n");

    const durationMinutes = Math.max(1, Math.round(elapsed / 60));
    const activityLog = actMsgs.map((a) => ({ timestamp: format(a.timestamp, "HH:mm"), type: a.activityType || a.content, label: a.activityType || a.content }));

    try {
      const patchBody: Record<string, unknown> = {
        duration_minutes: durationMinutes,
        notes: editableNotes.trim() || undefined,
        transcription: transcription || undefined,
        status: "completed",
        photo_urls: iUrls,
        activities_performed: structuredNotes.activitiesPerformed || undefined,
        outcomes: structuredNotes.outcomes || undefined,
        participant_response: structuredNotes.participantResponse || undefined,
        progress_toward_goals: structuredNotes.progressTowardGoals || undefined,
        structured_notes: structuredNotes,
        activity_log: activityLog,
        body_markers: bodyMarkers,
      };
      Object.keys(patchBody).forEach((k) => patchBody[k] === undefined && delete patchBody[k]);

      const patchRes = await fetch(`/api/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patchBody) });
      if (!patchRes.ok) throw new Error(`Save failed: HTTP ${patchRes.status}`);

      const goalsAddressedCount = session?.goals_addressed?.length ?? 0;
      const liveComplianceLocal = checkStructuredCompliance(structuredNotes, !!(session?.participant_id), durationMinutes, actMsgs.length, iUrls.length, goalsAddressedCount);

      const localResult: PostSaveResult = {
        score: liveComplianceLocal.score,
        status: liveComplianceLocal.score >= 85 ? "Compliant" : liveComplianceLocal.score >= 60 ? "At Risk" : "Non-Compliant",
        rules: liveComplianceLocal.checks.map((c) => ({ label: c.label, pass: c.pass, note: c.note })),
        rpFlags: rpFlags.length > 0 ? rpFlags : undefined,
      };

      try {
        const aiRes = await Promise.race<Response | null>([
          fetch(`/api/sessions/${id}/save-with-ai`, { method: "POST" }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
        ]);
        if (aiRes) {
          const aiData = await aiRes.json().catch(() => ({}));
          if (typeof aiData?.compliance?.score === "number") {
            localResult.score = aiData.compliance.score;
            localResult.status = aiData.compliance.assessment ?? localResult.status;
          }
          const rules = aiData?.session?.ai_insights?.rules_result;
          if (Array.isArray(rules)) localResult.rules = rules;
          const rpFlagsFromAI = aiData?.session?.ai_insights?.rp_flags;
          if (Array.isArray(rpFlagsFromAI) && rpFlagsFromAI.length > 0) {
            localResult.rpFlags = rpFlagsFromAI.map((f: Record<string, unknown>) => ({
              category: String(f.category ?? ""),
              phrase: String(f.phrase ?? ""),
              index: Number(f.index ?? 0),
              suggested_rewrite: (f.suggested_rewrite as string | undefined) ?? (f.suggestion as string | undefined),
            }));
          }
        }
      } catch { /* timeout/error — use local */ }

      setIsSaving(false);
      setPostSaveResult(localResult);
      toast({ title: "Session saved", description: "Notes approved and clinical record updated." });
    } catch (err) {
      setIsSaving(false);
      console.error("session save failed", err);
      toast({ title: "Save failed", description: "Could not save. Please try again.", variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, elapsed, editableNotes, messages, structuredNotes, settings, rpFlags, bodyMarkers, session, toast, navigate]);

  const handleInitiateApprove = useCallback(() => {
    const freshFlags = detectRestrictivePracticesAll([
      editableNotes, structuredNotes.activitiesPerformed, structuredNotes.outcomes,
      structuredNotes.participantResponse, structuredNotes.progressTowardGoals,
      ...voiceMessages.map((n) => n.content),
    ]);
    const flagsToUse = freshFlags.length > 0 ? freshFlags : rpFlags;
    if (flagsToUse.length > 0) {
      if (freshFlags.length > 0) setRpFlags(freshFlags);
      setRpAcknowledged(false);
      setShowRpBottomSheet(true);
    } else {
      void handleApproveAndSave();
    }
  }, [rpFlags, editableNotes, structuredNotes, voiceMessages, handleApproveAndSave]);

  const handleConfirmRestart = () => {
    setPostSaveResult(null);
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    setMessages([{ id: crypto.randomUUID(), type: "system", content: `${session?.session_type ?? "Session"} restarted`, timestamp: new Date() }]);
    setGoals((prev) => prev.map((g) => ({ ...g, status: "not_started" as const })));
    setBodyMarkers([]);
    setShowRestartConfirm(false);
    setShowSummary(false);
    setSummary(null);
    hasManuallyEditedNotesRef.current = false;
    setEditableNotes("");
    setStructuredNotes({ activitiesPerformed: "", outcomes: "", participantResponse: "", progressTowardGoals: "" });
    stopIntentRef.current = true;
    recognitionRef.current?.stop();
    setIsRecording(false);
    prevScoreRef.current = 0;
    prevRpCountRef.current = 0;
    toast({ title: "Session restarted", description: "All logs cleared." });
  };

  // ── Long-press bubble menu handlers ──
  const handleBubbleLongPress = useCallback((msgId: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setBubbleMenu({ msgId, top: rect.top + window.scrollY, right: window.innerWidth - rect.right });
  }, []);

  const handleImproveWithAI = async (msgId: string) => {
    setBubbleMenu(null);
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    setImprovingMsgId(msgId);
    try {
      const res = await fetch("/api/ai/clinical-rewrite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.content }),
      });
      if (res.ok) {
        const data = await res.json();
        const improved = data.rewritten ?? data.result ?? data.text;
        if (improved) updateMessage(msgId, { content: improved });
        toast({ title: "Note improved with AI" });
      }
    } catch { toast({ title: "AI improvement unavailable", variant: "destructive" }); }
    finally { setImprovingMsgId(null); }
  };

  const handleConvertToIncident = (msgId: string) => {
    setBubbleMenu(null);
    const msg = messages.find((m) => m.id === msgId);
    setIncidentDraft({ step: 0, what: msg?.content ?? "", actions: [], wellbeing: "" });
    setShowIncidentSheet(true);
  };

  const handleTranslateBubble = async (msgId: string) => {
    setBubbleMenu(null);
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    try {
      const result = await translateToEnglish(msg.content);
      updateMessage(msgId, { translated: result.translated, detectedLanguage: result.detectedLanguage });
      toast({ title: "Translated to English" });
    } catch { toast({ title: "Translation failed", variant: "destructive" }); }
  };

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: DEEP }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: LIME }} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4" style={{ background: DEEP }}>
        <p className="text-white/50">Session not found</p>
        <Button onClick={() => navigate("/sessions")} variant="outline">Back to Sessions</Button>
      </div>
    );
  }

  const participantName = session.participants?.full_name ?? "Session";
  const goalsAddressedCount = session?.goals_addressed?.length ?? 0;
  const liveCompliance = checkStructuredCompliance(
    structuredNotes, !!(session?.participant_id),
    elapsed > 0 ? Math.max(1, Math.round(elapsed / 60)) : 0,
    activityMessages.length, imageUrls.length, goalsAddressedCount,
  );

  const compSettings = settings?.compliance;
  const bannerItems: { label: string; met: boolean }[] = [];
  if (compSettings?.requireActivity) bannerItems.push({ label: "Activity required", met: activityMessages.length > 0 });
  if (compSettings?.requireNotes) {
    const hasNotes = activityMessages.length > 0 || voiceMessages.length > 0 || messages.filter((m) => m.type === "text").length > 0;
    bannerItems.push({ label: "Clinical notes required", met: hasNotes });
  }
  if (compSettings?.requireDuration) bannerItems.push({ label: "Timer required", met: elapsed > 0 });

  const sessionState = deriveSessionStateLabel(isActive, liveCompliance.score);
  const complianceActionLabel = deriveComplianceActionLabel(liveCompliance.score, liveCompliance.checks);

  // Health strip items
  const healthItems = liveCompliance.checks.map((c) => {
    const tips: Record<string, string> = {
      "Goals linked": "Link NDIS goals in session setup to improve claim defensibility.",
      "Duration recorded": "Start the timer before beginning support activities.",
      "Activity logged": "Tap the + button and log each support activity as it happens.",
      "Clinical notes completed": "Add structured notes in the review screen before saving.",
      "Photo evidence captured": "Tap the camera button to capture photo evidence.",
      "Participant linked": "This session must be linked to a participant.",
    };
    return { label: c.label, pass: c.pass, note: c.note, tip: tips[c.label] ?? "" };
  });

  // Voice overlay keyword detection
  const hasOutcomeLang = OUTCOME_KEYWORDS.test(recordingText);
  const hasGoalLang    = GOAL_KEYWORDS.test(recordingText);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: DEEP }}>

      {/* ── Dynamic Header ── */}
      <div
        className="shrink-0 border-b border-white/10"
        style={{ background: isActive ? NAVY : "#0a0a3a" }}
      >
        {/* Top row: back, session state, controls */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <button
            onClick={() => navigate(`/sessions/${id}`)}
            className="flex items-center gap-1 text-white/60 hover:text-white text-sm transition-colors font-medium shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* Session state chip */}
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold border shrink-0", sessionState.color)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", sessionState.dot)} />
            {sessionState.label}
          </span>

          <div className="flex-1" />

          {/* Translation toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <Globe className="h-3 w-3 text-white/30" />
            <div className="flex rounded-md border border-white/15 overflow-hidden">
              {(["original", "translated", "both"] as TranslationView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setTranslationView(v)}
                  className={cn("px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                    translationView === v ? "bg-white/20 text-white" : "text-white/30 hover:text-white/60")}
                >
                  {v === "original" ? "Orig" : v === "translated" ? "EN" : "Both"}
                </button>
              ))}
            </div>
          </div>

          {elapsed > 0 && (
            <button
              onClick={() => setShowRestartConfirm(true)}
              className="text-white/35 hover:text-white/60 text-[10px] px-2 py-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}

          {!isActive ? (
            <Button
              onClick={handleStart}
              className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-3 py-1.5 h-auto text-xs shrink-0"
            >
              <Play className="h-3 w-3 fill-white" />
              {elapsed > 0 ? "Resume" : "Start"}
            </Button>
          ) : (
            <Button
              onClick={handleStop}
              className="gap-1 bg-red-500 hover:bg-red-600 text-white font-bold px-3 py-1.5 h-auto text-xs shrink-0"
            >
              <Square className="h-3 w-3 fill-white" />
              End
            </Button>
          )}
        </div>

        {/* Second row: name + timer + compliance score */}
        <div className="flex items-end justify-between px-4 pb-2.5 pt-1">
          <div className="min-w-0 flex-1 mr-3">
            <h1 className="text-white font-bold text-base leading-tight truncate">{participantName}</h1>
            <p className="text-white/40 text-[11px] mt-0.5">{session.session_type}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono text-2xl font-black text-white tracking-tight leading-none">
              {formatDuration(elapsed)}
            </p>
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <span
                className="text-[11px] font-bold"
                style={{ color: liveCompliance.score >= 80 ? "#10B981" : liveCompliance.score >= 60 ? "#F59E0B" : CORAL }}
              >
                {liveCompliance.score}%
              </span>
              <span className="text-[10px] text-white/40">· {complianceActionLabel}</span>
            </div>
          </div>
        </div>

        {/* Health strip */}
        <div className="flex gap-1.5 px-3 pb-2.5 overflow-x-auto scrollbar-none">
          {healthItems.map((item) => (
            <div key={item.label}>
              <button
                onClick={() => setExpandedHealthChip(expandedHealthChip === item.label ? null : item.label)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[9px] font-semibold whitespace-nowrap transition-all shrink-0",
                  item.pass
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/25",
                )}
              >
                {item.pass
                  ? <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
                  : <AlertCircle className="h-2.5 w-2.5 shrink-0" />}
                {item.label.replace("Clinical notes completed", "Notes").replace("Photo evidence captured", "Evidence").replace("Participant linked", "Participant").replace("Duration recorded", "Duration").replace("Activity logged", "Activity")}
                {item.note && <span className="opacity-60 ml-0.5">({item.note})</span>}
              </button>
            </div>
          ))}
        </div>

        {/* Expanded health chip tooltip */}
        {expandedHealthChip && (
          <div className="mx-3 mb-2.5 bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-start gap-2">
            <Zap className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-white/70 leading-relaxed flex-1">
              {healthItems.find((h) => h.label === expandedHealthChip)?.tip}
            </p>
            <button onClick={() => setExpandedHealthChip(null)} className="text-white/30 hover:text-white/60">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* ── Goal chips strip ── */}
      {goals.length > 0 ? (
        <div className="shrink-0 border-b border-white/10 bg-[#1A0D2E]/70 px-3 py-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-white/40 shrink-0">
              <Target className="h-3 w-3" /> Goals:
            </span>
            {goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => cycleGoalStatus(goal.id)}
                className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-semibold border transition-all active:scale-95", GOAL_STATUS_CONFIG[goal.status].cls)}
              >
                {goal.name.length > 22 ? goal.name.slice(0, 22) + "…" : goal.name}
              </button>
            ))}
            <button
              onClick={() => setBodyMapOpen((o) => !o)}
              className="ml-auto flex items-center gap-1 text-[9px] text-white/25 hover:text-white/50 transition-colors"
            >
              <HeartPulse className="h-3 w-3" />
              {bodyMapOpen ? "Hide" : "Body Map"}
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 bg-amber-950/30 border-b border-amber-800/20 px-3 py-1.5 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400/70 shrink-0" />
          <p className="text-amber-300/70 text-[10px]">No goals linked — non-compliant. Add goals in session setup.</p>
        </div>
      )}

      {/* ── Risk Profile Alert ── */}
      {riskProfile && (
        <div
          className="shrink-0 border-b px-3 py-2 flex items-start gap-2"
          style={{
            background: riskProfile.risk_level === "high" ? "rgba(220,38,38,0.15)" : "rgba(245,158,11,0.12)",
            borderColor: riskProfile.risk_level === "high" ? "rgba(220,38,38,0.3)" : "rgba(245,158,11,0.25)",
          }}
        >
          <ShieldAlert
            className="h-3.5 w-3.5 shrink-0 mt-0.5"
            style={{ color: riskProfile.risk_level === "high" ? "#F87171" : "#FBBF24" }}
          />
          <div className="flex-1 min-w-0">
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: riskProfile.risk_level === "high" ? "#FCA5A5" : "#FCD34D" }}
            >
              {riskProfile.risk_level === "high" ? "High Risk" : "Medium Risk"} Participant
            </p>
            {riskProfile.triggers && (
              <p className="text-[10px] text-white/50 mt-0.5 truncate">Triggers: {riskProfile.triggers}</p>
            )}
            {riskProfile.management_plan && (
              <p className="text-[10px] text-white/40 truncate">Plan: {riskProfile.management_plan}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Goal Rules Matrix (collapsible) ── */}
      {planGoals.length > 0 && (
        <div className="shrink-0 border-b border-white/10" style={{ background: "rgba(85,51,204,0.08)" }}>
          <button
            onClick={() => setShowGoalMatrix((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-left"
          >
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-purple-300/70">
              <BarChart2 className="h-3 w-3" /> Goal Rules Matrix
              <span className="text-white/30 font-normal normal-case tracking-normal">({planGoals.filter((g) => !g.is_achieved).length} active)</span>
            </span>
            <span className="text-white/25 text-[9px]">{showGoalMatrix ? "▲" : "▼"}</span>
          </button>
          {showGoalMatrix && (
            <div className="px-3 pb-3 space-y-1.5 max-h-[180px] overflow-y-auto">
              {planGoals.map((g) => (
                <div
                  key={g.id}
                  className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="shrink-0 mt-0.5">
                    {g.is_achieved
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      : <Circle className="h-3 w-3 text-white/30" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[10px] leading-snug ${g.is_achieved ? "text-white/30 line-through" : "text-white/70"}`}>
                      {g.description}
                    </p>
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 inline-block"
                      style={{
                        background: g.category === "core" ? "rgba(59,130,246,0.2)" : g.category === "capacity_building" ? "rgba(139,92,246,0.2)" : "rgba(245,158,11,0.2)",
                        color: g.category === "core" ? "#93C5FD" : g.category === "capacity_building" ? "#C4B5FD" : "#FCD34D",
                      }}
                    >
                      {g.category === "capacity_building" ? "Capacity" : g.category === "core" ? "Core" : g.category === "capital" ? "Capital" : g.category}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Body map (collapsible) ── */}
      {bodyMapOpen && (
        <div className="shrink-0 border-b border-white/10 px-4 py-4 max-h-[260px] overflow-y-auto" style={{ background: DEEP }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-2">
              <HeartPulse className="h-3.5 w-3.5" style={{ color: CORAL }} /> Physical Examination
            </h3>
            <button onClick={() => setBodyMapOpen(false)} className="text-white/35 hover:text-white/60">
              <X className="h-4 w-4" />
            </button>
          </div>
          <BodyExaminationPanel markers={bodyMarkers} onChange={setBodyMarkers} bodyType={participant?.biological_sex ?? "unspecified"} />
        </div>
      )}

      {/* ── Chat feed ── */}
      <div className="flex-1 overflow-y-auto px-2 py-3" onClick={() => { setBubbleMenu(null); setShowFab(false); }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <MessageSquare className="h-12 w-12 text-white/8 mb-3" />
            <p className="text-white/25 text-sm font-medium">No messages yet</p>
            <p className="text-white/15 text-xs mt-1">Start the session and document below</p>
          </div>
        )}
        <div className="space-y-0.5">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              translationView={translationView}
              onLongPress={handleBubbleLongPress}
              onOpenIncident={(triggerText) => {
                setIncidentDraft({ step: 0, what: triggerText, actions: [], wellbeing: "" });
                setShowIncidentSheet(true);
              }}
            />
          ))}
        </div>
        <div ref={chatBottomRef} className="h-2" />
      </div>

      {/* ── RP warning strip ── */}
      {rpFlags.length > 0 && !showSummary && (
        <div className="shrink-0 bg-red-950/50 border-t border-red-800/30 px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          <p className="text-red-300 text-xs flex-1">
            <span className="font-semibold">Possible RP language detected</span>
            <span className="text-red-400/70 ml-1">({rpFlags.length} flag{rpFlags.length > 1 ? "s" : ""})</span>
          </p>
          <button onClick={() => setShowRpBottomSheet(true)} className="text-red-400 hover:text-red-300 text-[10px] underline shrink-0">
            Review
          </button>
        </div>
      )}

      {/* ── Bottom composer ── */}
      <div className="shrink-0 border-t border-white/10 px-3 py-2" style={{ background: NAVY }}>
        <div className="flex items-center gap-1.5">

          {/* Expandable FAB */}
          <div className="relative shrink-0">
            {showFab && (
              <div className="absolute bottom-11 left-0 flex flex-col gap-2 items-start animate-in slide-in-from-bottom-2 duration-150">
                <button
                  onClick={() => { setShowActivitySheet(true); setShowFab(false); }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold text-white bg-[#1a1a6e] border border-white/15 whitespace-nowrap hover:bg-[#2a2a8e] transition-all"
                >
                  <Activity className="h-3.5 w-3.5" style={{ color: LIME }} /> Log Activity
                </button>
                <button
                  onClick={() => { fileInputRef.current?.click(); setShowFab(false); }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold text-white bg-[#1a1a6e] border border-white/15 whitespace-nowrap hover:bg-[#2a2a8e] transition-all"
                >
                  <Camera className="h-3.5 w-3.5" style={{ color: "#60A5FA" }} /> Take Photo
                </button>
                <button
                  onClick={() => { startRecording(); setShowFab(false); }}
                  disabled={!isActive}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold text-white bg-[#1a1a6e] border border-white/15 whitespace-nowrap hover:bg-[#2a2a8e] transition-all disabled:opacity-40"
                >
                  <Mic className="h-3.5 w-3.5" style={{ color: CORAL }} /> Voice Note
                </button>
                {goals.length > 0 && (
                  <button
                    onClick={() => {
                      const nextGoal = goals.find((g) => g.status === "not_started") ?? goals[0];
                      if (nextGoal) cycleGoalStatus(nextGoal.id);
                      setShowFab(false);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold text-white bg-[#1a1a6e] border border-white/15 whitespace-nowrap hover:bg-[#2a2a8e] transition-all"
                  >
                    <Target className="h-3.5 w-3.5" style={{ color: LIME }} /> Update Goal
                  </button>
                )}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowFab((o) => !o); }}
              className={cn(
                "h-9 w-9 rounded-full flex items-center justify-center transition-all",
                showFab
                  ? "text-white rotate-45"
                  : "bg-white/8 text-white/50 hover:bg-white/15 hover:text-white/80"
              )}
              style={showFab ? { background: PURPLE } : {}}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Text input */}
          <div className="flex-1 bg-white/8 border border-white/10 rounded-2xl px-4 py-2 min-h-[36px] flex items-center">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
              placeholder={isActive ? COMPOSER_PLACEHOLDERS[placeholderIdx] : "Start session to add notes"}
              disabled={!isActive}
              className="w-full bg-transparent text-white text-sm placeholder-white/20 outline-none disabled:opacity-30"
            />
          </div>

          {/* Mic */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!isActive}
            title={isRecording ? "Stop recording" : "Start voice note"}
            className={cn(
              "h-9 w-9 rounded-full flex items-center justify-center transition-all shrink-0 disabled:opacity-25",
              isRecording ? "bg-red-500 text-white animate-pulse" : "bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/70",
            )}
          >
            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          {/* Send */}
          <button
            onClick={sendTextMessage}
            disabled={!inputText.trim() || !isActive}
            className="h-9 w-9 rounded-full flex items-center justify-center disabled:opacity-20 hover:opacity-90 transition-all shrink-0"
            style={{ background: LIME }}
          >
            <Send className="h-4 w-4" style={{ color: DEEP }} />
          </button>
        </div>
      </div>

      {/* ── Hidden file inputs ── */}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
      <input ref={fileAttachRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileAttach} />

      {/* ── Voice recording overlay ── */}
      {isRecording && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(5,5,32,0.92)" }}>
          <div className="w-full rounded-t-3xl px-6 pt-6 pb-10 animate-in slide-in-from-bottom-4 duration-200" style={{ background: NAVY, borderTop: `1px solid rgba(255,255,255,0.1)` }}>

            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 mb-3">
                <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Listening</span>
              </div>
              <p className="text-white font-bold text-lg">CareScribe is organizing</p>
              <p className="text-white font-bold text-lg">your documentation…</p>
            </div>

            {/* Live transcript */}
            <div className="min-h-[60px] bg-white/5 rounded-2xl px-4 py-3 mb-4">
              <p className="text-white/70 text-sm italic leading-relaxed">
                {recordingText || "Speak clearly — describe the support you're providing…"}
              </p>
            </div>

            {/* Live keyword badges */}
            <div className="flex flex-wrap gap-2 justify-center mb-6">
              <span className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold border transition-all",
                hasOutcomeLang
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                  : "bg-white/5 text-white/25 border-white/10",
              )}>
                {hasOutcomeLang ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                Outcome language
              </span>
              <span className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold border transition-all",
                hasGoalLang
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                  : "bg-white/5 text-white/25 border-white/10",
              )}>
                {hasGoalLang ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                Goal reference
              </span>
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold border bg-white/5 text-white/25 border-white/10">
                <Clock className="h-3 w-3" />
                Timestamp captured
              </span>
            </div>

            <button
              onClick={stopRecording}
              className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-colors"
              style={{ background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              Stop Recording
            </button>
          </div>
        </div>
      )}

      {/* ── Activity sheet ── */}
      {showActivitySheet && (
        <div className="fixed inset-0 z-40 flex items-end" onClick={() => setShowActivitySheet(false)}>
          <div
            className="w-full rounded-t-3xl shadow-2xl px-4 pt-4 pb-10 animate-in slide-in-from-bottom-4 duration-200"
            style={{ background: NAVY, borderTop: "1px solid rgba(255,255,255,0.1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-sm">Log Activity</h3>
              <button onClick={() => setShowActivitySheet(false)} className="text-white/40 hover:text-white/70">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {ACTIVITY_CATEGORIES.map((cat) => {
                const CatIcon = cat.icon;
                return (
                  <div key={cat.label}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <CatIcon className="h-3 w-3 text-white/30" />
                      <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">{cat.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {cat.items.map((a) => {
                        const AIcon = a.icon;
                        return (
                          <button
                            key={a.type}
                            onClick={() => logActivity(a.type)}
                            className={cn("flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition-all active:scale-95", a.color)}
                          >
                            <AIcon className="h-4 w-4 shrink-0" />
                            {a.type}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Bubble long-press menu ── */}
      {bubbleMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setBubbleMenu(null)} />
          <div
            className="fixed z-50 bg-[#1a1a6e] border border-white/15 rounded-2xl shadow-2xl py-2 min-w-[180px] animate-in zoom-in-95 duration-150"
            style={{ bottom: "80px", right: "16px" }}
          >
            <button
              onClick={() => void handleImproveWithAI(bubbleMenu.msgId)}
              disabled={improvingMsgId === bubbleMenu.msgId}
              className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white hover:bg-white/10 transition-colors text-left"
            >
              {improvingMsgId === bubbleMenu.msgId
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: PURPLE }} />
                : <Sparkles className="h-3.5 w-3.5" style={{ color: PURPLE }} />}
              Improve with AI
            </button>
            <button
              onClick={() => void handleTranslateBubble(bubbleMenu.msgId)}
              className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white hover:bg-white/10 transition-colors text-left"
            >
              <Globe className="h-3.5 w-3.5 text-blue-400" />
              Translate note
            </button>
            {goals.length > 0 && (
              <button
                onClick={() => {
                  setGoalPickerMsgId(bubbleMenu.msgId);
                  setBubbleMenu(null);
                  setShowGoalPicker(true);
                }}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-white hover:bg-white/10 transition-colors text-left"
              >
                <Target className="h-3.5 w-3.5" style={{ color: LIME }} />
                Link to goal
              </button>
            )}
            <div className="border-t border-white/10 mt-1 pt-1">
              <button
                onClick={() => handleConvertToIncident(bubbleMenu.msgId)}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-amber-300 hover:bg-white/10 transition-colors text-left"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Convert to incident
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Goal picker bottom sheet ── */}
      {showGoalPicker && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowGoalPicker(false)} />
          <div
            className="relative w-full rounded-t-3xl shadow-2xl px-5 pt-5 pb-10 animate-in slide-in-from-bottom-4 duration-200"
            style={{ background: NAVY, border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />
            <p className="text-white font-semibold text-sm mb-3">Link note to a goal</p>
            <div className="space-y-2">
              {goals.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    const targetMsgId = goalPickerMsgId;
                    setGoals((prev) =>
                      prev.map((gl) =>
                        gl.id === g.id && gl.status === "not_started"
                          ? { ...gl, status: "in_progress" as const }
                          : gl
                      )
                    );
                    addMessage({
                      type: "goal_update",
                      content: g.name,
                      timestamp: new Date(),
                      goalId: g.id,
                      goalStatus: g.status === "not_started" ? "in_progress" : g.status,
                      linkedNoteId: targetMsgId ?? undefined,
                    });
                    setShowGoalPicker(false);
                    setGoalPickerMsgId(null);
                    toast({ title: "Note linked", description: g.name });
                  }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left text-white text-sm active:scale-[0.98] transition-transform"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <span className="truncate pr-2">{g.name}</span>
                  <span
                    className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background:
                        g.status === "achieved"
                          ? "rgba(217,241,3,0.2)"
                          : g.status === "in_progress"
                          ? "rgba(85,51,204,0.3)"
                          : "rgba(255,255,255,0.1)",
                      color:
                        g.status === "achieved"
                          ? LIME
                          : g.status === "in_progress"
                          ? "#A78BFA"
                          : "rgba(255,255,255,0.5)",
                    }}
                  >
                    {g.status === "not_started" ? "Not started" : g.status === "in_progress" ? "In progress" : "Achieved"}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowGoalPicker(false)}
              className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold text-white/60 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Incident guided sheet ── */}
      {showIncidentSheet && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowIncidentSheet(false)} />
          <div
            className="relative w-full rounded-t-3xl shadow-2xl px-5 pt-5 pb-10 animate-in slide-in-from-bottom-4 duration-200 max-h-[85vh] overflow-y-auto"
            style={{ background: "#ffffff" }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-bold text-slate-900">Guided Incident Record</h3>
              <button onClick={() => setShowIncidentSheet(false)} className="ml-auto text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">This is a safe space — document calmly and continue the session.</p>

            {/* Step indicator */}
            <div className="flex gap-1 mb-5">
              {[0, 1, 2].map((s) => (
                <div
                  key={s}
                  className="flex-1 h-1 rounded-full transition-all"
                  style={{ background: s <= incidentDraft.step ? PURPLE : "#E5E7EB" }}
                />
              ))}
            </div>

            {incidentDraft.step === 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-800">Step 1 — What happened?</p>
                <textarea
                  value={incidentDraft.what}
                  onChange={(e) => setIncidentDraft((d) => ({ ...d, what: e.target.value }))}
                  rows={4}
                  placeholder="Describe what occurred in plain language…"
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-400 resize-none"
                  style={{ color: "#1E1640" }}
                />
                <Button
                  disabled={!incidentDraft.what.trim()}
                  className="w-full text-white font-semibold"
                  style={{ background: PURPLE }}
                  onClick={() => setIncidentDraft((d) => ({ ...d, step: 1 }))}
                >
                  Next
                </Button>
              </div>
            )}

            {incidentDraft.step === 1 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-800">Step 2 — Immediate actions taken</p>
                {["Participant reassured", "Environment secured", "Supervisor informed", "First aid applied", "Emergency services contacted"].map((action) => (
                  <label key={action} className="flex items-center gap-3 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={incidentDraft.actions.includes(action)}
                      onChange={(e) => setIncidentDraft((d) => ({
                        ...d,
                        actions: e.target.checked ? [...d.actions, action] : d.actions.filter((a) => a !== action),
                      }))}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-sm text-slate-700">{action}</span>
                  </label>
                ))}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setIncidentDraft((d) => ({ ...d, step: 0 }))}>Back</Button>
                  <Button className="flex-1 text-white font-semibold" style={{ background: PURPLE }} onClick={() => setIncidentDraft((d) => ({ ...d, step: 2 }))}>Next</Button>
                </div>
              </div>
            )}

            {incidentDraft.step === 2 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-800">Step 3 — Participant wellbeing now</p>
                {(["stable", "distressed", "follow_up"] as const).map((w) => (
                  <label key={w} className="flex items-center gap-3 cursor-pointer py-1">
                    <input
                      type="radio"
                      name="wellbeing"
                      checked={incidentDraft.wellbeing === w}
                      onChange={() => setIncidentDraft((d) => ({ ...d, wellbeing: w }))}
                      className="h-4 w-4"
                    />
                    <span className="text-sm text-slate-700">
                      {w === "stable" ? "Stable" : w === "distressed" ? "Distressed — monitoring" : "Requires follow-up"}
                    </span>
                  </label>
                ))}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setIncidentDraft((d) => ({ ...d, step: 1 }))}>Back</Button>
                  <Button
                    className="flex-1 text-white font-semibold"
                    style={{ background: PURPLE }}
                    disabled={!incidentDraft.wellbeing}
                    onClick={() => {
                      const incidentText = [
                        `INCIDENT RECORD`,
                        `What happened: ${incidentDraft.what}`,
                        incidentDraft.actions.length > 0 ? `Actions taken: ${incidentDraft.actions.join(", ")}` : "",
                        `Participant wellbeing: ${incidentDraft.wellbeing}`,
                      ].filter(Boolean).join("\n");
                      addMessage({ type: "text", content: incidentText, timestamp: new Date() });
                      addMessage({ type: "system", content: "Incident draft saved — you can continue the session", timestamp: new Date() });
                      setShowIncidentSheet(false);
                      toast({ title: "Incident draft saved", description: "You can continue the session." });
                    }}
                  >
                    Save Incident Draft
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-700">
              Draft saved automatically · Supervisor can review later · You can continue the session
            </div>
          </div>
        </div>
      )}

      {/* ── Completion / approval screen ── */}
      {showSummary && (
        <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "#F5F3FC" }}>

          {/* Header */}
          <div className="shrink-0 px-5 pt-5 pb-4 border-b border-white" style={{ background: "white" }}>
            <div className="flex items-center gap-2 mb-0.5">
              <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: PURPLE }} />
              <h2 className="text-base font-bold" style={{ color: "#1E1640" }}>
                {postSaveResult ? "Session Saved" : "Review & Approve"}
              </h2>
            </div>
            {!postSaveResult && (
              <p className="text-[11px]" style={{ color: "#7A6A9E" }}>
                Review notes below. Only saved on your explicit approval.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {postSaveResult ? (
              /* ── Post-save result view ── */
              <div className="space-y-5">
                {/* Score ring + achievement checklist */}
                <div className="bg-white rounded-2xl px-5 py-6 shadow-sm">
                  <p className="text-center text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: "#7A6A9E" }}>
                    Session Complete
                  </p>
                  <ScoreRing score={postSaveResult.score} />
                  <p className="text-center font-bold mt-3" style={{ color: "#1E1640" }}>
                    {postSaveResult.status}
                  </p>
                </div>

                {/* Checklist */}
                {postSaveResult.rules && (
                  <div className="bg-white rounded-2xl px-5 py-4 shadow-sm space-y-2">
                    {postSaveResult.rules.map((rule, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-sm">
                        {rule.pass
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          : <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />}
                        <span style={{ color: rule.pass ? "#065F46" : "#92400E" }}>{rule.label}</span>
                        {rule.note && <span className="text-[10px] text-slate-400 ml-auto">{rule.note}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {postSaveResult.rpFlags && postSaveResult.rpFlags.length > 0 && (
                  <ComplianceResultPanel
                    score={postSaveResult.score}
                    status={postSaveResult.status}
                    rpFlags={postSaveResult.rpFlags}
                  />
                )}

                <Button
                  onClick={() => navigate(`/sessions/${id}`)}
                  className="w-full text-white font-semibold gap-2 min-h-[48px] rounded-2xl"
                  style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PURPLE} 100%)` }}
                >
                  <FileText className="h-4 w-4" /> View Session Record
                </Button>
              </div>
            ) : summaryLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: PURPLE }} />
              </div>
            ) : summary ? (
              /* ── Pre-save review view ── */
              <div className="space-y-5">

                {/* Score ring + stat row */}
                <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
                  <ScoreRing score={liveCompliance.score} />
                  <p className="text-center text-sm font-bold mt-2" style={{ color: "#1E1640" }}>
                    {complianceActionLabel}
                  </p>
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div className="rounded-xl p-3 text-center" style={{ background: "#F5F3FC" }}>
                      <p className="text-lg font-bold font-mono" style={{ color: "#1E1640" }}>{summary.duration}</p>
                      <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: "#7A6A9E" }}>Duration</p>
                    </div>
                    <div className="rounded-xl p-3 text-center" style={{ background: "#F5F3FC" }}>
                      <p className="text-lg font-bold" style={{ color: "#1E1640" }}>{summary.activities.length}</p>
                      <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: "#7A6A9E" }}>Activities</p>
                    </div>
                    <div className="rounded-xl p-3 text-center" style={{ background: "#F5F3FC" }}>
                      <p className="text-lg font-bold" style={{ color: "#1E1640" }}>{summary.voiceNoteCount + messages.filter((m) => m.type === "text").length}</p>
                      <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: "#7A6A9E" }}>Notes</p>
                    </div>
                  </div>
                </div>

                {/* Compliance checklist */}
                <div className="bg-white rounded-2xl px-5 py-4 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: "#7A6A9E" }}>
                    <Shield className="h-3.5 w-3.5" /> Compliance Check
                  </p>
                  <div className="space-y-2">
                    {liveCompliance.checks.map((c, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-sm">
                        {c.pass
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          : liveCompliance.blocking
                            ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                            : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />}
                        <span style={{ color: c.pass ? "#065F46" : liveCompliance.blocking ? "#991B1B" : "#92400E" }}>{c.label}</span>
                        {c.note && <span className="text-[10px] ml-auto" style={{ color: "#7A6A9E" }}>{c.note}</span>}
                      </div>
                    ))}
                  </div>
                  {liveCompliance.blocking && (
                    <p className="text-xs text-red-700 font-medium flex items-center gap-1.5 pt-3 mt-2 border-t border-red-100">
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                      Resolve the issues above before this session can be approved
                    </p>
                  )}
                </div>

                {/* RP warning */}
                {rpFlags.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                    <div>
                      <p className="text-sm font-semibold text-red-700">Restrictive practice language detected</p>
                      <ul className="mt-1 space-y-0.5">
                        {rpFlags.map((f, i) => (
                          <li key={i} className="text-xs text-red-600">
                            <span className="font-medium">{RP_CATEGORY_LABELS[f.category] ?? f.category}:</span>{" "}
                            <span className="italic">"{f.phrase}"</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* ── Assess-note compliance score panel ── */}
                {(assessScore || assessLoading) && (
                  <div className="rounded-2xl px-4 py-3.5 shadow-sm" style={{ background: "#F5F3FC", border: "1px solid rgba(213,204,238,0.6)" }}>
                    <div className="flex items-center justify-between mb-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: "#7A6A9E" }}>
                        <BarChart2 className="h-3.5 w-3.5" /> AI Compliance Score
                      </p>
                      {assessLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "#7A6A9E" }} />
                      ) : assessScore && (
                        <div className="flex items-center gap-2">
                          <span
                            className="text-sm font-black"
                            style={{ color: assessScore.score >= 75 ? "#10B981" : assessScore.score >= 50 ? "#F59E0B" : CORAL }}
                          >
                            {assessScore.score}/100
                          </span>
                          {assessScore.is_ready_for_billing && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                              ✓ Billing Ready
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {assessScore && (
                      <>
                        {/* Criteria bars */}
                        <div className="space-y-2">
                          {Object.entries(assessScore.breakdown).map(([key, crit]) => {
                            const pct = Math.round((crit.score / crit.max) * 100);
                            const barColor = pct >= 75 ? "#10B981" : pct >= 40 ? "#F59E0B" : "#F03060";
                            return (
                              <div key={key}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[10px] text-slate-600">{crit.label}</span>
                                  <span className="text-[10px] font-semibold" style={{ color: barColor }}>{crit.score}/{crit.max}</span>
                                </div>
                                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%`, background: barColor }}
                                  />
                                </div>
                                {crit.feedback && pct < 75 && (
                                  <p className="text-[9px] text-slate-400 mt-0.5 leading-snug">{crit.feedback}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {assessScore.feedback && (
                          <p className="text-[10px] mt-2.5 leading-relaxed" style={{ color: assessScore.is_ready_for_billing ? "#059669" : "#7A6A9E" }}>
                            {assessScore.feedback}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Structured case notes */}
                <div className="bg-white rounded-2xl px-5 py-4 shadow-sm space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: "#7A6A9E" }}>
                    <FileText className="h-3.5 w-3.5" /> Structured Case Notes
                    <span className="font-normal normal-case tracking-normal ml-1" style={{ color: CORAL }}>— required</span>
                  </p>
                  {(
                    [
                      { key: "activitiesPerformed" as keyof StructuredNotes, label: "Activities Performed", placeholder: "Describe the specific support activities provided…", required: true },
                      { key: "outcomes" as keyof StructuredNotes, label: "Outcomes", placeholder: "Measurable outcomes achieved…", required: true },
                      { key: "participantResponse" as keyof StructuredNotes, label: "Participant Response", placeholder: "How did the participant engage and respond?", required: true },
                      { key: "progressTowardGoals" as keyof StructuredNotes, label: "Progress Toward NDIS Goals", placeholder: "Link outcomes to specific NDIS goals…", required: false },
                    ] as const
                  ).map(({ key, label, placeholder, required }) => (
                    <div key={key}>
                      <label className="text-[10px] font-semibold uppercase tracking-widest mb-1 flex items-center gap-1" style={{ color: "#4A3D5A" }}>
                        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
                      </label>
                      <SmartTextarea
                        value={structuredNotes[key]}
                        onChange={(val) => setStructuredNotes((prev) => ({ ...prev, [key]: val }))}
                        rows={4}
                        placeholder={placeholder}
                        className="text-[12px] p-3 rounded-xl leading-relaxed min-h-[100px]"
                        style={{ background: "#F5F3FC", borderColor: "rgba(213,204,238,0.6)", color: "#1E1640" }}
                      />
                    </div>
                  ))}
                </div>

                {/* Clinical record */}
                <div className="bg-white rounded-2xl px-5 py-4 shadow-sm">
                  <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2" style={{ color: "#7A6A9E" }}>
                    <FileText className="h-3.5 w-3.5" /> Clinical Record
                    <span className="font-normal normal-case tracking-normal ml-1" style={{ color: CORAL }}>— auto-generated · editable</span>
                  </label>
                  <SmartTextarea
                    value={editableNotes}
                    onChange={(v) => { hasManuallyEditedNotesRef.current = true; setEditableNotes(v); }}
                    rows={6}
                    placeholder="Combined clinical record…"
                    className="text-[12px] p-3 rounded-xl font-mono leading-relaxed min-h-[120px]"
                    style={{ background: "#F5F3FC", borderColor: "rgba(213,204,238,0.6)", color: "#1E1640" }}
                  />
                </div>

                {/* Activities logged */}
                {summary.activities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {summary.activities.map((a, i) => (
                      <span key={i} className="text-[10px] px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(85,51,204,0.08)", color: PURPLE }}>
                        {a}
                      </span>
                    ))}
                  </div>
                )}

                {/* Evidence */}
                <div className="flex gap-3">
                  <div className="flex-1 rounded-xl p-3 text-[12px] flex items-center gap-2" style={{ background: "#F5F3FC", border: "1px solid rgba(213,204,238,0.6)", color: "#1E1640" }}>
                    <ImageIcon className="h-4 w-4 shrink-0" style={{ color: "#7A6A9E" }} />
                    {summary.evidenceSummary}
                  </div>
                  {summary.voiceNoteCount > 0 && (
                    <div className="flex-1 rounded-xl p-3 text-[12px] flex items-center gap-2" style={{ background: "#F5F3FC", border: "1px solid rgba(213,204,238,0.6)", color: "#1E1640" }}>
                      <Mic className="h-4 w-4 shrink-0" style={{ color: "#7A6A9E" }} />
                      {summary.voiceNoteCount} voice note{summary.voiceNoteCount > 1 ? "s" : ""} captured
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3 pb-4">
                  <Button
                    variant="outline"
                    onClick={() => { setShowSummary(false); setElapsed(0); setIsActive(false); }}
                    disabled={isSaving}
                    className="flex-1 min-h-[48px] border-red-200 text-red-600 hover:bg-red-50 rounded-2xl"
                  >
                    Discard Session
                  </Button>
                  <Button
                    onClick={handleInitiateApprove}
                    disabled={isSaving || liveCompliance.blocking}
                    className="flex-1 min-h-[48px] text-white font-semibold gap-2 disabled:opacity-50 rounded-2xl"
                    style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PURPLE} 100%)` }}
                  >
                    {isSaving
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                      : liveCompliance.blocking
                        ? <><XCircle className="h-4 w-4" /> Fix Issues to Approve</>
                        : <><Shield className="h-4 w-4" /> Approve &amp; Save</>}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── RP bottom sheet ── */}
      {showRpBottomSheet && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRpBottomSheet(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl shadow-2xl px-5 pt-5 pb-8 animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h3 className="text-base font-bold text-slate-900">Restrictive Practice Review Required</h3>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              The following restrictive practice language was detected. Please review carefully before saving.
            </p>
            <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
              {rpFlags.map((f, i) => (
                <div key={i} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">
                  <span className="font-semibold text-red-800">{RP_CATEGORY_LABELS[f.category] ?? f.category}</span>
                  <span className="text-red-700 ml-2 italic">"{f.phrase}"</span>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5">
              <Checkbox id="rp-ack" checked={rpAcknowledged} onCheckedChange={(v) => setRpAcknowledged(!!v)} className="mt-0.5 shrink-0" />
              <label htmlFor="rp-ack" className="text-sm text-amber-800 cursor-pointer leading-snug">
                I have reviewed this and confirm any restrictive practices are covered under an approved Behaviour Support Plan.
              </label>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowRpBottomSheet(false)}>Go Back</Button>
              <Button
                disabled={!rpAcknowledged || isSaving}
                onClick={() => void handleApproveAndSave()}
                className="flex-1 text-white font-semibold gap-2"
                style={{ background: PURPLE }}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                {isSaving ? "Saving…" : "Confirm & Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Restart confirm ── */}
      <Dialog open={showRestartConfirm} onOpenChange={setShowRestartConfirm}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" /> Restart Session?
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 leading-relaxed mt-2">
              This will clear all current messages, voice notes, and photos. The timer will reset to zero.
              <br /><br />
              <span className="font-medium text-slate-700">This action cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowRestartConfirm(false)}>Keep Going</Button>
            <Button onClick={handleConfirmRestart} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold">Yes, Restart</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
