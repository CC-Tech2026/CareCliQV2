import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSession, useGetParticipant } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useSettings } from "@/lib/use-settings";
import { apiFetch } from "@/lib/api-fetch";
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
  Radio,
  Paperclip,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { translateToEnglish } from "@/services/translationService";
import type { StructuredNotes } from "@/services/complianceService";
import { BodyExaminationPanel } from "@/components/BodyExaminationPanel";
import type { BodyMarker } from "@/components/BodyMap";
import {
  detectRestrictivePracticesAll,
  type RPFlag,
  RP_CATEGORY_LABELS,
} from "@/lib/rp-detector";
import { ComplianceResultPanel } from "@/components/ComplianceResultPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TranslationView = "original" | "translated" | "both";

const SUPPORTED_DOCUMENTATION_LANGUAGES = [
  { code: "en", label: "English", speechTag: "en-AU" },
  { code: "es", label: "Spanish", speechTag: "es-ES" },
  { code: "fr", label: "French", speechTag: "fr-FR" },
  { code: "ar", label: "Arabic", speechTag: "ar-SA" },
  { code: "sw", label: "Swahili", speechTag: "sw-KE" },
  { code: "zh", label: "Chinese", speechTag: "zh-CN" },
  { code: "hi", label: "Hindi", speechTag: "hi-IN" },
  { code: "pt", label: "Portuguese", speechTag: "pt-PT" },
  { code: "de", label: "German", speechTag: "de-DE" },
  { code: "it", label: "Italian", speechTag: "it-IT" },
  { code: "ja", label: "Japanese", speechTag: "ja-JP" },
  { code: "ko", label: "Korean", speechTag: "ko-KR" },
  { code: "vi", label: "Vietnamese", speechTag: "vi-VN" },
  { code: "tl", label: "Tagalog", speechTag: "tl-PH" },
  { code: "ur", label: "Urdu", speechTag: "ur-PK" },
  { code: "fa", label: "Persian", speechTag: "fa-IR" },
  { code: "ru", label: "Russian", speechTag: "ru-RU" },
  { code: "uk", label: "Ukrainian", speechTag: "uk-UA" },
  { code: "nl", label: "Dutch", speechTag: "nl-NL" },
  { code: "tr", label: "Turkish", speechTag: "tr-TR" },
  { code: "id", label: "Indonesian", speechTag: "id-ID" },
  { code: "ms", label: "Malay", speechTag: "ms-MY" },
  { code: "th", label: "Thai", speechTag: "th-TH" },
  { code: "pl", label: "Polish", speechTag: "pl-PL" },
  { code: "ro", label: "Romanian", speechTag: "ro-RO" },
  { code: "el", label: "Greek", speechTag: "el-GR" },
] as const;

function normalizeLanguageCode(value?: string | null): string | null {
  const code = value?.trim().toLowerCase().replace("_", "-").split("-")[0];
  return code || null;
}

function supportedLanguageCode(value?: string | null): string | null {
  const code = normalizeLanguageCode(value);
  return SUPPORTED_DOCUMENTATION_LANGUAGES.some((language) => language.code === code)
    ? code
    : null;
}

interface ChatMessage {
  id: string;
  type: "text" | "voice" | "image" | "file" | "activity" | "goal_update" | "system";
  content: string;
  timestamp: Date;
  mediaUrl?: string;
  translated?: string;
  detectedLanguage?: string;
  translationStatus?: "not_required" | "pending" | "translated" | "failed" | "unsupported" | "manually_confirmed";
  translationMetadata?: Record<string, unknown>;
  attachmentId?: string;
  isTranslating?: boolean;
  activityType?: string;
  goalId?: string;
  goalStatus?: string;
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

// ---------------------------------------------------------------------------
// Activity category definitions
// ---------------------------------------------------------------------------

type LucideIcon = React.ComponentType<{ className?: string }>;

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
  not_started: { label: "Not Started", cls: "bg-[#ECECEC] text-[#6A6A77] border-[#E8E8EA]", icon: Circle },
  in_progress: { label: "In Progress", cls: "bg-[#FDF0F4] text-[#7C3AED] border-[#F8C0CE]", icon: Activity },
  achieved: { label: "Achieved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  needs_review: { label: "Needs Review", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertCircle },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
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
  const voiceMsgs = messages.filter((m) => m.type === "voice");
  const imageMsgs = messages.filter((m) => m.type === "image");
  const textMsgs = messages.filter((m) => m.type === "text");

  const activityTypes = [...new Set(activityMsgs.map((m) => m.activityType || m.content))];
  const achievedGoals = goals.filter((g) => g.status === "achieved");
  const inProgressGoals = goals.filter((g) => g.status === "in_progress");
  const goalProgress = goals
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
  if (achievedGoals.length > 0) {
    lines.push(`Goals achieved: ${achievedGoals.map((g) => g.name).join(", ")}.`);
  }
  if (inProgressGoals.length > 0) {
    lines.push(`Goals worked on: ${inProgressGoals.map((g) => g.name).join(", ")}.`);
  }
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
  if (translationView !== "original") {
    lines.unshift("[Observations translated to English]\n");
  }

  const clinicalNotes = lines.join("\n");
  let score = 0;
  if (clinicalNotes.length > 30) score += 30;
  if (activityMsgs.length > 0) score += 30;
  if (durationMins > 0) score += 20;
  if (session.session_type) score += 20;
  score = Math.min(score, 100);

  return {
    clinicalNotes,
    activities: activityMsgs.map((a) => `${a.activityType || a.content} (${format(a.timestamp, "HH:mm")})`),
    goalProgress,
    complianceScore: score,
    duration: formatDuration(elapsed),
    voiceNoteCount: voiceMsgs.length,
    imageCount: imageMsgs.length,
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
}: {
  msg: ChatMessage;
  translationView: TranslationView;
}) {
  if (msg.type === "system") {
    return (
      <div className="flex justify-center my-2 px-4">
        <span className="rounded-full bg-white/80 px-3 py-1 text-[10px] font-medium text-[#6A6A77] shadow-sm">{msg.content}</span>
      </div>
    );
  }

  if (msg.type === "activity") {
    const def = findActivityDef(msg.activityType || msg.content);
    const AIcon = def?.icon ?? Activity;
    return (
      <div className="flex justify-center my-1.5">
        <div className="flex items-center gap-1.5 bg-white border border-[#E8E8EA] rounded-full px-3 py-1 shadow-sm">
          <AIcon className="h-2.5 w-2.5 text-[#E8457A] shrink-0" />
          <span className="text-[10px] text-[#1A1A2E] font-semibold">{msg.activityType || msg.content}</span>
          <span className="text-[9px] text-[#6A6A77]">� {format(msg.timestamp, "HH:mm")}</span>
        </div>
      </div>
    );
  }

  if (msg.type === "goal_update") {
    return (
      <div className="flex justify-center my-1.5">
        <div className="flex items-center gap-1.5 bg-[#FDF0F4] border border-[#F8C0CE] rounded-full px-3 py-1 shadow-sm">
          <Target className="h-2.5 w-2.5 text-[#7C3AED] shrink-0" />
          <span className="text-[10px] text-[#1A1A2E] font-semibold">{msg.content}</span>
          <span className="text-[9px] text-[#6A6A77]">� {format(msg.timestamp, "HH:mm")}</span>
        </div>
      </div>
    );
  }

  // Worker messages: text, voice, image, file � right aligned
  return (
    <div className="flex justify-end px-1 my-0.5">
      <div className="max-w-[82%] min-w-[60px]">
        <div className="bg-white border border-[#E8E8EA] rounded-2xl rounded-tr-sm overflow-hidden shadow-sm">
          {msg.type === "image" && msg.mediaUrl && (
            <div className="relative">
              <img src={msg.mediaUrl} className="w-full max-h-52 object-cover" alt="Evidence" />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                <div className="flex items-center gap-1 text-white/60 text-[9px]">
                  <Camera className="h-2.5 w-2.5" />
                  <span>Photo evidence � {format(msg.timestamp, "HH:mm")}</span>
                </div>
              </div>
            </div>
          )}
          {msg.type === "file" && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-9 w-9 bg-[#ECECEC] rounded-lg flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-[#E8457A]" />
              </div>
              <div className="min-w-0">
                <p className="text-[#1A1A2E] text-sm font-semibold leading-tight truncate">{msg.content}</p>
                <p className="text-[#6A6A77] text-[10px]">Document attached</p>
              </div>
            </div>
          )}
          {(msg.type === "text" || msg.type === "voice") && (
            <div className="px-4 py-3">
              {msg.type === "voice" && (
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <div className="flex items-center gap-1 text-[#E8457A]">
                    <Mic className="h-3 w-3" />
                    <span className="text-[9px] font-bold uppercase tracking-wider">Voice Note</span>
                  </div>
                  {msg.detectedLanguage && msg.detectedLanguage !== "en" && (
                    <span className="text-[9px] bg-[#ECECEC] text-[#6A6A77] px-1.5 py-0.5 rounded-full">
                      {msg.detectedLanguage.toUpperCase()}
                    </span>
                  )}
                  {msg.isTranslating && (
                    <div className="flex items-center gap-1 text-[#6A6A77]">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      <span className="text-[9px]">Translating�</span>
                    </div>
                  )}
                </div>
              )}
              {(msg.type === "text" || msg.type === "voice") && (
                <p className="text-[#1A1A2E] text-sm leading-relaxed">{msg.content}</p>
              )}
              {msg.type === "voice" && (
                <div className="mt-2 pt-2 border-t border-[#E8D5E8]">
                  <div className="mb-1">
                    {msg.isTranslating ? (
                      <span className="text-[9px] text-[#6A6A77]">Translating...</span>
                    ) : msg.translationStatus === "translated" ? (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#E8457A]">Translated to English</span>
                    ) : msg.translationStatus === "failed" || msg.translationStatus === "unsupported" ? (
                      <span className="text-[9px] font-semibold text-red-600">Translation failed - retry</span>
                    ) : msg.translationStatus === "not_required" ? (
                      <span className="text-[9px] text-[#6A6A77]">English legal output</span>
                    ) : null}
                  </div>
                  {msg.translated ? (
                    <>
                      <p className="text-[#374151] text-sm leading-relaxed">{msg.translated}</p>
                    </>
                  ) : !msg.isTranslating ? (
                    <p className="text-[#6A6A77] text-xs italic">English translation unavailable</p>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="text-[#9A8BC4] text-[9px] text-right mt-0.5 pr-1">{format(msg.timestamp, "HH:mm")}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SessionLive() {
  const { translate, translateParams } = useAccessibility();
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

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
    return addressed.map((gid: string) => goalMap[gid] ?? gid);
  })();

  const { settings } = useSettings();

  // -- Primary state --
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // -- Timer --
  const [isActive, setIsActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const autoStartAppliedRef = useRef(false);

  // -- Voice --
  const [isRecording, setIsRecording] = useState(false);
  const [recordingText, setRecordingText] = useState("");
  const [selectedDocumentationLanguage, setSelectedDocumentationLanguage] = useState(
    () => supportedLanguageCode(typeof navigator !== "undefined" ? navigator.language : null) || "en",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const stopIntentRef = useRef(false);
  const languageManuallySelectedRef = useRef(false);

  // -- Body markers --
  const [bodyMarkers, setBodyMarkers] = useState<BodyMarker[]>([]);
  const bodyMarkersInitRef = useRef(false);
  const bodyMarkersDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Translation --
  const [translationView, setTranslationView] = useState<TranslationView>("original");

  // -- UI panels --
  const [showActivitySheet, setShowActivitySheet] = useState(false);
  const [bodyMapOpen, setBodyMapOpen] = useState(false);

  // -- Approval modal --
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

  // -- Modals --
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  // -- RP detection --
  const [rpFlags, setRpFlags] = useState<RPFlag[]>([]);
  const [showRpBottomSheet, setShowRpBottomSheet] = useState(false);
  const [rpAcknowledged, setRpAcknowledged] = useState(false);
  const rpDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Post-save result --
  interface PostSaveResult {
    score: number;
    status: string;
    rules?: Array<{ label: string; pass: boolean; note?: string }>;
    rpFlags?: RPFlag[];
    deltaSummaries?: string[];
  }
  const [postSaveResult, setPostSaveResult] = useState<PostSaveResult | null>(null);
  const [previewDeltaSummaries, setPreviewDeltaSummaries] = useState<string[]>([]);
  const [previewProgressLoading, setPreviewProgressLoading] = useState(false);
  const [previewProgressNotice, setPreviewProgressNotice] = useState<string | null>(null);

  // -- Reminder --
  const reminderTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // -- Refs --
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAttachRef = useRef<HTMLInputElement>(null);
  const messagesInitRef = useRef(false);

  // -- Derived --
  const activityMessages = messages.filter((m) => m.type === "activity");
  const voiceMessages = messages.filter((m) => m.type === "voice");
  const imageMessages = messages.filter((m) => m.type === "image");
  const imageUrls = imageMessages.map((m) => m.mediaUrl!).filter(Boolean);
  const selectedLanguage =
    SUPPORTED_DOCUMENTATION_LANGUAGES.find((language) => language.code === selectedDocumentationLanguage) ||
    SUPPORTED_DOCUMENTATION_LANGUAGES[0];
  const documentationLanguage = selectedLanguage.code;
  const speechRecognitionLanguage =
    selectedLanguage.speechTag || (typeof navigator !== "undefined" ? navigator.language : "") || "en-AU";

  useEffect(() => {
    if (languageManuallySelectedRef.current) return;
    const sessionLanguage = supportedLanguageCode(
      (session as unknown as { input_language?: string; detected_language?: string })?.input_language ||
        (session as unknown as { detected_language?: string })?.detected_language,
    );
    if (sessionLanguage) setSelectedDocumentationLanguage(sessionLanguage);
  }, [session]);

  // -- addMessage helper --
  const addMessage = useCallback(
    (msg: Omit<ChatMessage, "id">): ChatMessage => {
      const newMsg: ChatMessage = { ...msg, id: crypto.randomUUID() };
      setMessages((prev) => [...prev, newMsg]);
      if (id) {
        apiFetch(`/api/sessions/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_type: msg.type,
            content: msg.content,
            media_url: (msg as ChatMessage).mediaUrl ?? null,
            sender_role: ["activity", "goal_update", "system"].includes(msg.type) ? "system" : "worker",
            created_at: msg.timestamp.toISOString(),
            translated_content: (msg as ChatMessage).translated ?? null,
            detected_language: (msg as ChatMessage).detectedLanguage ?? null,
            translation_status: (msg as ChatMessage).translationStatus ?? null,
            translation_metadata: (msg as ChatMessage).translationMetadata ?? null,
            attachment_id: (msg as ChatMessage).attachmentId ?? null,
          }),
        }).catch((error) => {
          console.error("message persistence failed", error);
          toast({ title: translate("sessions.live.toast.messageNotSaved"), variant: "destructive" });
        });
      }
      return newMsg;
    },
    [id, toast],
  );

  const updateMessage = useCallback((msgId: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ...updates } : m)));
    if (!id || msgId.startsWith("attachment-")) return;
    const payload: Record<string, unknown> = {};
    if ("translated" in updates) payload.translated_content = updates.translated ?? null;
    if ("detectedLanguage" in updates) payload.detected_language = updates.detectedLanguage ?? null;
    if ("translationStatus" in updates) payload.translation_status = updates.translationStatus ?? null;
    if ("translationMetadata" in updates) payload.translation_metadata = updates.translationMetadata ?? {};
    if ("attachmentId" in updates) payload.attachment_id = updates.attachmentId ?? null;
    if (Object.keys(payload).length === 0) return;
    apiFetch(`/api/sessions/${id}/messages/${msgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.error("message update failed", error);
    });
  }, [id]);

  // -- Auto-scroll --
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isRecording]);

  // -- Keep combined notes in sync --
  useEffect(() => {
    if (hasManuallyEditedNotesRef.current) return;
    // Combine structured notes into editable text
    const combinedNotes = structuredNotes 
      ? Object.entries(structuredNotes)
          .map(([key, value]) => value ? `${key}: ${value}` : null)
          .filter(Boolean)
          .join('\n')
      : '';
    setEditableNotes(combinedNotes);
  }, [structuredNotes]);

  // -- Load existing messages --
  useEffect(() => {
    if (!session?.id || messagesInitRef.current) return;
    messagesInitRef.current = true;
    apiFetch(`/api/sessions/${session.id}/messages`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages(
            (
              data as Array<{
                id: string;
                message_type: string;
                content: string;
                created_at: string;
                media_url?: string;
                translated_content?: string;
                detected_language?: string;
                translation_status?: ChatMessage["translationStatus"];
                translation_metadata?: Record<string, unknown>;
                attachment_id?: string;
              }>
            ).map((m) => ({
              id: m.id,
              type: m.message_type as ChatMessage["type"],
              content: m.content || "",
              timestamp: new Date(m.created_at),
              mediaUrl: m.media_url || undefined,
              translated: m.translated_content || undefined,
              detectedLanguage: m.detected_language || undefined,
              translationStatus: m.translation_status,
              translationMetadata: m.translation_metadata,
              attachmentId: m.attachment_id,
            })),
          );
        } else {
          setMessages([
            {
              id: crypto.randomUUID(),
              type: "system",
              content: `${session.session_type} session`,
              timestamp: new Date(),
            },
          ]);
        }
      })
      .catch(() => {
        setMessages([
          {
            id: crypto.randomUUID(),
            type: "system",
            content: `${session.session_type} session`,
            timestamp: new Date(),
          },
        ]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    apiFetch(`/api/sessions/${session.id}/attachments`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`attachments ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (!Array.isArray(data) || data.length === 0) return;
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.attachmentId).filter(Boolean));
          const attachmentMessages = (data as Array<Record<string, unknown>>)
            .filter((a) => a.id && !existingIds.has(String(a.id)))
            .map((a) => {
              const mime = String(a.mime_type || "");
              const isImage = mime.startsWith("image/");
              return {
                id: `attachment-${String(a.id)}`,
                type: isImage ? "image" : "file",
                content: String(a.file_name || "Attachment"),
                timestamp: a.created_at ? new Date(String(a.created_at)) : new Date(),
                mediaUrl: String(a.public_url || a.file_path || ""),
                attachmentId: String(a.id),
              } as ChatMessage;
            });
          return attachmentMessages.length ? [...prev, ...attachmentMessages] : prev;
        });
      })
      .catch((error) => {
        console.error("attachment load failed", error);
      });
  }, [session?.id]);

  useEffect(() => {
    if (!showSummary || !id || postSaveResult || summaryLoading) {
      if (!showSummary || postSaveResult) {
        setPreviewDeltaSummaries([]);
        setPreviewProgressNotice(null);
      }
      return;
    }

    const payload = {
      notes: editableNotes.trim() || undefined,
      activities_performed: structuredNotes.activitiesPerformed.trim() || undefined,
      outcomes: structuredNotes.outcomes.trim() || undefined,
      participant_response: structuredNotes.participantResponse.trim() || undefined,
      progress_toward_goals: structuredNotes.progressTowardGoals.trim() || undefined,
      goals_addressed:
        (session?.goals_addressed?.length ?? 0) > 0
          ? session?.goals_addressed
          : goals.filter((g) => g.status !== "not_started").map((g) => g.id),
    };
    const hasNoteContent = Boolean(
      payload.notes ||
        payload.activities_performed ||
        payload.outcomes ||
        payload.participant_response ||
        payload.progress_toward_goals,
    );
    if (!hasNoteContent) {
      setPreviewProgressLoading(false);
      setPreviewDeltaSummaries([]);
      setPreviewProgressNotice("Add session notes before a progress summary can be generated.");
      return;
    }

    let cancelled = false;
    setPreviewProgressLoading(true);
    setPreviewProgressNotice(null);
    apiFetch(`/api/sessions/${id}/preview-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(
            typeof data?.detail === "string" ? data.detail : `Preview failed (${r.status})`,
          );
        }
        return data as { delta_summaries?: string[] };
      })
      .then((data) => {
        if (cancelled) return;
        const summaries = Array.isArray(data.delta_summaries)
          ? data.delta_summaries.filter((s) => typeof s === "string" && s.trim())
          : [];
        setPreviewDeltaSummaries(summaries);
        if (summaries.length === 0) {
          setPreviewProgressNotice(
            "No measurable progress detected yet. You can still approve. Progress will be extracted on save.",
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewDeltaSummaries([]);
        setPreviewProgressNotice(
          err instanceof Error
            ? err.message
            : "Could not generate progress summary. You can still approve and save.",
        );
      })
      .finally(() => {
        if (!cancelled) setPreviewProgressLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    showSummary,
    id,
    postSaveResult,
    summaryLoading,
    structuredNotes,
    editableNotes,
    session?.goals_addressed,
    goals,
  ]);

  // -- Init body markers --
  useEffect(() => {
    if (!session || bodyMarkersInitRef.current) return;
    bodyMarkersInitRef.current = true;
    const raw = (session as unknown as { body_markers?: unknown }).body_markers;
    if (Array.isArray(raw) && raw.length > 0) {
      setBodyMarkers(raw as BodyMarker[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // -- Body markers debounced save --
  const bodyMarkersAutoSaveSkipRef = useRef(true);
  useEffect(() => {
    if (bodyMarkersAutoSaveSkipRef.current) {
      bodyMarkersAutoSaveSkipRef.current = false;
      return;
    }
    if (!id) return;
    if (bodyMarkersDebounceRef.current) clearTimeout(bodyMarkersDebounceRef.current);
    bodyMarkersDebounceRef.current = setTimeout(async () => {
      try {
        await apiFetch(`/api/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body_markers: bodyMarkers }),
        });
      } catch (error) {
        console.error("body marker save failed", error);
      }
    }, 1500);
    return () => {
      if (bodyMarkersDebounceRef.current) clearTimeout(bodyMarkersDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyMarkers]);

  // -- Init goals --
  useEffect(() => {
    if (session && goals.length === 0) {
      const addressed = session.goals_addressed ?? [];
      if (addressed.length > 0 && resolvedGoalTitles.length > 0) {
        setGoals(
          addressed.map((gid: string, i: number) => ({
            id: gid,
            name: resolvedGoalTitles[i] ?? gid,
            status: "not_started" as const,
          })),
        );
      } else if (addressed.length > 0) {
        setGoals(
          addressed.map((gid: string) => ({ id: gid, name: gid, status: "not_started" as const })),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, resolvedGoalTitles.join(",")]);

  // -- Timer --
  useEffect(() => {
    if (isActive) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive]);

  // -- Auto-start from settings --
  useEffect(() => {
    if (!session || !settings || autoStartAppliedRef.current || isActive) return;
    if (settings.sessionDefaults?.autoStartTimer) {
      autoStartAppliedRef.current = true;
      startTimeRef.current = new Date();
      setIsActive(true);
      setElapsed(0);
      setReminderDismissed(true);
      toast({ title: translate("sessions.live.toast.started"), description: translate("sessions.live.toast.timerAuto") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, settings]);

  // -- Start reminder --
  useEffect(() => {
    if (!session || isActive || reminderDismissed) return;
    reminderTimerRef.current = setTimeout(() => {
      toast({
        title: translate("sessions.live.toast.scheduled"),
        description: `Ready: ${session.session_type}`,
        duration: 30000,
        action: (
          <ToastAction
            altText="Start Session"
            onClick={() => {
              handleStart();
              setReminderDismissed(true);
            }}
            className="bg-emerald-600 text-white hover:bg-emerald-700 border-0 text-xs font-semibold"
          >
            Start Session
          </ToastAction>
        ),
      });
      setReminderDismissed(true);
    }, 5000);
    return () => {
      if (reminderTimerRef.current) clearTimeout(reminderTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isActive]);

  // -- RP detection --
  useEffect(() => {
    if (rpDebounceRef.current) clearTimeout(rpDebounceRef.current);
    rpDebounceRef.current = setTimeout(() => {
      const flags = detectRestrictivePracticesAll([
        ...messages.filter((m) => ["text", "voice"].includes(m.type)).map((m) => m.content),
        recordingText,
        editableNotes,
        structuredNotes.activitiesPerformed,
        structuredNotes.outcomes,
        structuredNotes.participantResponse,
        structuredNotes.progressTowardGoals,
      ]);
      setRpFlags(flags);
    }, 600);
    return () => {
      if (rpDebounceRef.current) clearTimeout(rpDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    messages.length,
    recordingText,
    editableNotes,
    structuredNotes.activitiesPerformed,
    structuredNotes.outcomes,
    structuredNotes.participantResponse,
    structuredNotes.progressTowardGoals,
  ]);

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
    toast({ title: translate("sessions.live.toast.started"), description: translate("sessions.live.toast.startDocumenting") });
    if (settings?.sessionDefaults?.enableVoice) {
      setTimeout(() => startRecording(), 300);
    }
  };

  const sendTextMessage = () => {
    if (!inputText.trim()) return;
    if (!isActive) {
      toast({ title: translate("sessions.live.toast.startFirst"), variant: "destructive" });
      return;
    }
    addMessage({ type: "text", content: inputText.trim(), timestamp: new Date() });
    setInputText("");
  };

  const logActivity = (type: string) => {
    if (!isActive) {
      toast({ title: translate("sessions.live.toast.startFirst"), variant: "destructive" });
      setShowActivitySheet(false);
      return;
    }
    addMessage({ type: "activity", content: type, timestamp: new Date(), activityType: type });
    setShowActivitySheet(false);
    toast({ title: translateParams("sessions.live.toast.activityLogged", { type }) });
  };

  const cycleGoalStatus = (goalId: string) => {
    const cycle: GoalItem["status"][] = ["not_started", "in_progress", "achieved", "needs_review"];
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const idx = cycle.indexOf(goal.status);
    const newStatus = cycle[(idx + 1) % cycle.length];
    setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, status: newStatus } : g)));
    addMessage({
      type: "goal_update",
      content: `${goal.name} ? ${GOAL_STATUS_CONFIG[newStatus].label}`,
      timestamp: new Date(),
      goalId,
      goalStatus: newStatus,
    });
  };

  const uploadAttachment = async (file: File, type: "image" | "file") => {
    if (!id) throw new Error("Missing session id");
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiFetch(`/api/sessions/${id}/attachments`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Upload failed (${res.status})`);
    }
    const attachment = await res.json();
    addMessage({
      type,
      content: attachment.file_name || file.name,
      timestamp: new Date(attachment.created_at || Date.now()),
      mediaUrl: attachment.public_url || attachment.file_path,
      attachmentId: attachment.id,
    });
    return attachment;
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAttachment(true);
    try {
      await uploadAttachment(file, "image");
      toast({ title: translate("sessions.live.toast.photoUploaded"), description: format(new Date(), "HH:mm:ss") });
    } catch (error) {
      toast({
        title: translate("sessions.live.toast.photoFailed"),
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingAttachment(false);
      e.target.value = "";
    }
  };

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAttachment(true);
    try {
      await uploadAttachment(file, file.type.startsWith("image/") ? "image" : "file");
      toast({ title: translate("sessions.live.toast.fileUploaded"), description: file.name });
    } catch (error) {
      toast({
        title: translate("sessions.live.toast.uploadFailed"),
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingAttachment(false);
      e.target.value = "";
    }
  };

  const startRecording = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognitionClass = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      toast({
        title: translate("sessions.live.toast.voiceNotSupported"),
        description: "Use Chrome for voice notes.",
        variant: "destructive",
      });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = speechRecognitionLanguage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setRecordingText(transcript);
    };
    recognition.onerror = () => {
      setIsRecording(false);
      setRecordingText("");
    };
    recognition.onend = () => {
      if (!stopIntentRef.current) recognition.start();
    };
    stopIntentRef.current = false;
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = async () => {
    stopIntentRef.current = true;
    recognitionRef.current?.stop();
    setIsRecording(false);
    const text = recordingText.trim();
    if (!text) return;

    const newMsg = addMessage({
      type: "voice",
      content: text,
      timestamp: new Date(),
      isTranslating: true,
      translationStatus: "pending",
    });
    setRecordingText("");
    toast({ title: translate("sessions.live.toast.voiceSaved") });

    const result = await translateToEnglish(text, documentationLanguage);
    if (result.status === "failed" || result.status === "unsupported") {
      updateMessage(newMsg.id, {
        isTranslating: false,
        translationStatus: result.status,
        detectedLanguage: result.detectedLanguage,
        translationMetadata: result.metadata,
      });
      toast({
        title: translate("sessions.live.toast.translationFailed"),
        description: result.error || "Edit or retry before completing the session.",
        variant: "destructive",
      });
      return;
    }
    updateMessage(newMsg.id, {
      isTranslating: false,
      translated: result.translated,
      detectedLanguage: result.detectedLanguage,
      translationStatus: result.status,
      translationMetadata: result.metadata,
    });
  };

  const handleStop = useCallback(async () => {
    if (elapsed === 0) {
      toast({
        title: translate("sessions.live.toast.notStarted"),
        description: 'Click "Start" to begin the timer before ending.',
        variant: "destructive",
      });
      return;
    }

    const actMsgs = messages.filter((m) => m.type === "activity");
    const vMsgs = messages.filter((m) => m.type === "voice");
    const tMsgs = messages.filter((m) => m.type === "text");
    const activityTypes = [...new Set(actMsgs.map((m) => m.activityType || m.content))];
    const blockedTranslation = vMsgs.find(
      (m) => m.isTranslating || m.translationStatus === "pending" || m.translationStatus === "failed" || m.translationStatus === "unsupported",
    );
    if (blockedTranslation) {
      toast({
        title: translate("sessions.live.toast.translationRequired"),
        description: "Resolve failed or pending voice translation before completing the session.",
        variant: "destructive",
      });
      return;
    }
    const achievedGoals = goals.filter((g) => g.status === "achieved");
    const inProgressGoals = goals.filter((g) => g.status === "in_progress");
    const voiceTexts = vMsgs
      .map((v) => (translationView !== "original" && v.translated ? v.translated : v.content))
      .filter(Boolean);
    const textContent = tMsgs.map((m) => m.content);
    const allObs = [...voiceTexts, ...textContent];

    const prefilledHasContent =
      activityTypes.length > 0 || voiceTexts.length > 0 || textContent.length > 0;
    if (!prefilledHasContent && !session?.notes?.trim()) {
      toast({
        title: translate("sessions.live.toast.nothingToDocument"),
        description: "Log an activity or add a note before reviewing.",
        variant: "destructive",
      });
      return;
    }

    hasManuallyEditedNotesRef.current = false;
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) {
      stopIntentRef.current = true;
      recognitionRef.current?.stop();
      setIsRecording(false);
    }

    setSummaryLoading(true);
    setShowSummary(true);

    const prefilled: StructuredNotes = {
      activitiesPerformed: activityTypes.join(", "),
      outcomes: [
        achievedGoals.length > 0
          ? `Goals achieved: ${achievedGoals.map((g) => g.name).join(", ")}.`
          : "",
        allObs.length > 0 ? `Observations: ${allObs.slice(0, 2).join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      participantResponse: "",
      progressTowardGoals: goals
        .filter((g) => g.status !== "not_started")
        .map((g) => `${g.name}: ${GOAL_STATUS_CONFIG[g.status].label}`)
        .join("\n"),
    };

    const s = buildSummaryFromMessages(
      {
        session_type: session?.session_type ?? "Session",
        duration_minutes: session?.duration_minutes ?? 0,
        notes: session?.notes,
      },
      messages,
      goals,
      elapsed,
      translationView,
    );
    setSummary(s);
    setStructuredNotes(prefilled);
    setSummaryLoading(false);
  }, [session, messages, goals, elapsed, translationView, isRecording, toast]);

  const handleApproveAndSave = useCallback(async () => {
    setShowRpBottomSheet(false);
    if (!id) {
      navigate("/sessions");
      return;
    }

    const compSettings = settings?.compliance;
    const actMsgs = messages.filter((m) => m.type === "activity");
    const vMsgs = messages.filter((m) => m.type === "voice");
    const iMsgs = messages.filter((m) => m.type === "image");
    const iUrls = iMsgs.map((m) => m.mediaUrl!).filter(Boolean);
    const blockedTranslation = vMsgs.find(
      (m) => m.isTranslating || m.translationStatus === "pending" || m.translationStatus === "failed" || m.translationStatus === "unsupported",
    );
    if (blockedTranslation) {
      toast({
        title: translate("sessions.live.toast.approveTranslationFailed"),
        description: "Retry or edit the voice note before saving the legal record.",
        variant: "destructive",
      });
      return;
    }

    if (compSettings?.requireActivity && actMsgs.length === 0) {
      toast({ title: translate("sessions.live.toast.approveNoActivity"), variant: "destructive" });
      return;
    }
    if (compSettings?.requireNotes) {
      const hasNotes =
        [
          structuredNotes.activitiesPerformed,
          structuredNotes.outcomes,
          structuredNotes.participantResponse,
        ].some((f) => f.trim().length > 0) || editableNotes.trim().length > 0;
      if (!hasNotes) {
        toast({
          title: translate("sessions.live.toast.approveNotesRequired"),
          variant: "destructive",
        });
        return;
      }
    }
    if (compSettings?.requireDuration && elapsed === 0) {
      toast({
        title: translate("sessions.live.toast.approveNoDuration"),
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);

    const transcription = vMsgs
      .map(
        (n) =>
          `[${format(n.timestamp, "HH:mm")}] ${n.content}${n.translated && n.translated !== n.content ? ` [EN: ${n.translated}]` : ""}`,
      )
      .join("\n");

    const durationMinutes = Math.max(1, Math.round(elapsed / 60));
    const activityLog = actMsgs.map((a) => ({
      timestamp: format(a.timestamp, "HH:mm"),
      type: a.activityType || a.content,
      label: a.activityType || a.content,
    }));

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
        input_language: documentationLanguage,
      };
      Object.keys(patchBody).forEach((k) => patchBody[k] === undefined && delete patchBody[k]);

      const patchRes = await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!patchRes.ok) throw new Error(`Save failed: HTTP ${patchRes.status}`);

      const goalsAddressedCount = session?.goals_addressed?.length ?? 0;
      // TODO: Implement structured compliance checking
      const liveComplianceLocal: { score: number; checks: Array<{ label: string; pass: boolean; note: string }>; blocking: boolean } = { score: 0, checks: [], blocking: false };

      const localResult: PostSaveResult = {
        score: liveComplianceLocal.score,
        status:
          liveComplianceLocal.score >= 85
            ? "Compliant"
            : liveComplianceLocal.score >= 60
              ? "At Risk"
              : "Non-Compliant",
        rules: liveComplianceLocal.checks.map((c) => ({ label: c.label, pass: c.pass, note: c.note })),
        rpFlags: rpFlags.length > 0 ? rpFlags : undefined,
      };

      const aiRes = await apiFetch(`/api/sessions/${id}/save-with-ai`, { method: "POST" });
      const aiData = await aiRes.json().catch(() => ({}));
      if (!aiRes.ok) {
        throw new Error(aiData.detail || "AI/compliance analysis failed");
      }
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
              suggested_rewrite:
                (f.suggested_rewrite as string | undefined) ??
                (f.suggestion as string | undefined),
            }));
          }
          const progressDelta = aiData?.progress_delta;
          if (Array.isArray(progressDelta)) {
            localResult.deltaSummaries = progressDelta
              .map((e: Record<string, unknown>) => String(e.delta_summary ?? ""))
              .filter((s: string) => s.trim());
          } else if (Array.isArray(aiData?.delta_summaries)) {
            localResult.deltaSummaries = aiData.delta_summaries;
          }

      setIsSaving(false);
      setPostSaveResult(localResult);
      queryClient.invalidateQueries({ queryKey: [orgId, "dashboard", "worker"] });
      queryClient.invalidateQueries({ queryKey: [orgId, "worker", "my-compliance"] });
      queryClient.invalidateQueries({ queryKey: [orgId, "worker", "compliance-detail"] });
      toast({ title: translate("sessions.live.toast.saved"), description: translate("sessions.live.toast.savedDesc") });
    } catch (err) {
      setIsSaving(false);
      console.error("session save failed", err);
      toast({
        title: translate("sessions.live.toast.saveFailed"),
        description: err instanceof Error ? err.message : "Could not save. Please try again.",
        variant: "destructive",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    elapsed,
    editableNotes,
    messages,
    structuredNotes,
    settings,
    rpFlags,
    bodyMarkers,
    session,
    toast,
    navigate,
  ]);

  const handleInitiateApprove = useCallback(() => {
    const freshFlags = detectRestrictivePracticesAll([
      editableNotes,
      structuredNotes.activitiesPerformed,
      structuredNotes.outcomes,
      structuredNotes.participantResponse,
      structuredNotes.progressTowardGoals,
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
    setMessages([
      {
        id: crypto.randomUUID(),
        type: "system",
        content: `${session?.session_type ?? "Session"} restarted`,
        timestamp: new Date(),
      },
    ]);
    setGoals((prev) => prev.map((g) => ({ ...g, status: "not_started" as const })));
    setBodyMarkers([]);
    setShowRestartConfirm(false);
    setShowSummary(false);
    setSummary(null);
    hasManuallyEditedNotesRef.current = false;
    setEditableNotes("");
    setStructuredNotes({
      activitiesPerformed: "",
      outcomes: "",
      participantResponse: "",
      progressTowardGoals: "",
    });
    stopIntentRef.current = true;
    recognitionRef.current?.stop();
    setIsRecording(false);
    toast({ title: translate("sessions.live.toast.restarted"), description: translate("sessions.live.toast.restartedDesc") });
  };

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-9rem)] min-h-[520px] flex items-center justify-center rounded-[2rem] bg-white border border-[#E8E8EA]">
        <Loader2 className="h-8 w-8 animate-spin text-[#E8457A]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-[calc(100vh-9rem)] min-h-[520px] flex flex-col items-center justify-center gap-4 rounded-[2rem] bg-white border border-[#E8E8EA]">
        <p className="text-[#6A6A77]">Session not found</p>
        <Button onClick={() => navigate("/sessions")} variant="outline">
          Back to Sessions
        </Button>
      </div>
    );
  }

  const participantName = session.participants?.full_name ?? "Session";
  const goalsAddressedCount = session?.goals_addressed?.length ?? 0;
  // TODO: Implement structured compliance checking
  const liveCompliance: { score: number; checks: Array<{ label: string; pass: boolean; note: string }>; blocking: boolean } = { score: 0, checks: [], blocking: false };

  const compSettings = settings?.compliance;
  const bannerItems: { label: string; met: boolean }[] = [];
  if (compSettings?.requireActivity) {
    bannerItems.push({ label: "Activity required", met: activityMessages.length > 0 });
  }
  if (compSettings?.requireNotes) {
    const hasNotes =
      activityMessages.length > 0 ||
      voiceMessages.length > 0 ||
      messages.filter((m) => m.type === "text").length > 0;
    bannerItems.push({ label: "Clinical notes required", met: hasNotes });
  }
  if (compSettings?.requireDuration) {
    bannerItems.push({ label: "Timer required", met: elapsed > 0 });
  }
  const bannerVisible = bannerItems.length > 0;
  const bannerAllMet = bannerItems.every((i) => i.met);
  const bannerAnyMet = bannerItems.some((i) => i.met);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="relative mx-auto flex h-[calc(100vh-9rem)] min-h-[620px] max-h-[780px] max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-[#E8E8EA] bg-white shadow-[0_14px_40px_rgba(55,48,163,0.08)]">

      {/* -- Top control bar -- */}
      <div
        className="shrink-0 border-b border-[#E8D5E8] bg-white"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <button
            onClick={() => navigate(`/sessions/${id}`)}
            className="flex items-center gap-1.5 text-[#6A6A77] hover:text-[#E8457A] text-sm transition-colors font-semibold"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="min-w-0 flex-1 px-1">
            <h1 className="text-cc-text font-black text-base tracking-tight leading-tight truncate">
              {participantName}
            </h1>
            <p className="text-[#6A6A77] text-[11px] capitalize">{session.session_type?.replace(/_/g, " ")}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Dictation language"
              title="Dictation language"
              value={selectedDocumentationLanguage}
              disabled={isRecording}
              onChange={(event) => {
                languageManuallySelectedRef.current = true;
                setSelectedDocumentationLanguage(event.target.value);
              }}
              className="h-9 max-w-[118px] sm:max-w-[160px] rounded-full border border-[#E8E8EA] bg-[#ECECEC] px-3 text-[12px] font-bold text-[#1A1A2E] outline-none hover:bg-white disabled:opacity-50"
            >
              {SUPPORTED_DOCUMENTATION_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>

            <div className="hidden sm:flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-[#6A6A77] shrink-0" />
              <div className="flex rounded-full border border-[#E8E8EA] bg-[#ECECEC] p-0.5 overflow-hidden">
                {(["original", "translated", "both"] as TranslationView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTranslationView(v)}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-bold rounded-full transition-colors",
                      translationView === v
                        ? "bg-white text-[#E8457A] shadow-sm"
                        : "text-[#6A6A77] hover:text-[#E8457A]",
                    )}
                  >
                    {v === "original" ? "Orig" : v === "translated" ? "EN" : "Both"}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isActive || isUploadingAttachment}
              aria-label="Add photo evidence"
              title="Add photo evidence"
              className="h-9 w-9 rounded-full border border-[#E8E8EA] bg-white text-[#E8457A] hover:bg-[#ECECEC] disabled:opacity-40 flex items-center justify-center transition-colors"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>

            {elapsed > 0 && (
              <button
                onClick={() => setShowRestartConfirm(true)}
                className="hidden sm:inline-flex text-[#6A6A77] hover:text-[#E8457A] text-[11px] font-semibold px-2 py-1 rounded-lg hover:bg-[#ECECEC] transition-colors"
              >
                Restart
              </button>
            )}

            {!isActive ? (
              <Button
                onClick={handleStart}
                className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-3 py-2 h-9 text-xs rounded-full"
              >
                <Play className="h-3 w-3 fill-white" />
                {elapsed > 0 ? "Resume" : "Start"}
              </Button>
            ) : (
              <Button
                onClick={handleStop}
                className="gap-1 text-white font-bold px-3 py-2 h-9 text-xs rounded-full"
                style={{ background: "var(--cc-cta)" }}
              >
                <Square className="h-3 w-3 fill-white" />
                End
              </Button>
            )}
          </div>
        </div>

        {/* Timer bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-[#F0ECFA] bg-[#F8F6FF]">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-lg font-black text-[#1A1A2E] tracking-tight">
              {formatDuration(elapsed)}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border",
                isActive
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-white text-[#6A6A77] border-[#E8E8EA]",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-400",
                )}
              />
              {isActive ? "In Progress" : elapsed > 0 ? "Paused" : "Ready"}
            </span>
            {isRecording && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                <Radio className="h-2.5 w-2.5 animate-pulse" /> Listening
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] font-medium text-[#6A6A77]">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {session.duration_minutes}m planned
            </span>
            {session.session_date && (
              <span>{format(new Date(session.session_date), "MMM d")}</span>
            )}
          </div>
        </div>
      </div>

      {/* -- Goals strip (tap chips to cycle status) -- */}
      {goals.length > 0 ? (
        <div className="shrink-0 border-b border-[#E8D5E8] bg-white px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#6A6A77] shrink-0">
              <Target className="h-3 w-3" /> Goals:
            </span>
            {goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => cycleGoalStatus(goal.id)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-semibold border transition-all active:scale-95",
                  GOAL_STATUS_CONFIG[goal.status].cls,
                )}
              >
                {goal.name.length > 22 ? goal.name.slice(0, 22) + "�" : goal.name}
              </button>
            ))}
            <button
              onClick={() => setBodyMapOpen((o) => !o)}
              className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-[#6A6A77] hover:text-[#E8457A] transition-colors"
            >
              <HeartPulse className="h-3 w-3" />
              {bodyMapOpen ? "Hide" : "Body Map"}
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 bg-amber-50 border-b border-amber-100 px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <p className="text-amber-800 text-[11px] font-medium">
            No goals linked, non-compliant. Add goals in session setup.
          </p>
        </div>
      )}

      {/* -- Compliance banner -- */}
      {bannerVisible && (
        <div
          className={cn(
            "shrink-0 border-b px-3 py-1.5 transition-colors",
            bannerAllMet
              ? "bg-emerald-50 border-emerald-100"
              : bannerAnyMet
                ? "bg-amber-50 border-amber-100"
                : "bg-red-50 border-red-100",
          )}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck
              className={cn(
                "h-3 w-3 shrink-0",
                bannerAllMet ? "text-emerald-600" : "text-amber-600",
              )}
            />
            {bannerAllMet ? (
              <span className="text-[10px] text-emerald-700 font-semibold">
                {translate("sessions.live.banner.allMet")}
              </span>
            ) : (
              bannerItems.map((item) => (
                <span
                  key={item.label}
                  className={cn(
                    "text-[10px] font-medium flex items-center gap-1",
                    item.met ? "text-emerald-700" : "text-red-700",
                  )}
                >
                  {item.met ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <AlertCircle className="h-3 w-3" />
                  )}
                  {item.label}
                </span>
              ))
            )}
          </div>
        </div>
      )}

      {/* -- Body map (collapsible) -- */}
      {bodyMapOpen && (
        <div className="shrink-0 bg-[#F8F6FF] border-b border-[#E8D5E8] px-4 py-4 max-h-[260px] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-bold text-[#6A6A77] uppercase tracking-wider flex items-center gap-2">
              <HeartPulse className="h-3.5 w-3.5" style={{ color: "#F1738A" }} /> Physical Examination
            </h3>
            <button
              onClick={() => setBodyMapOpen(false)}
              className="text-[#6A6A77] hover:text-[#E8457A]"
              title={translate("sessions.live.bodyMap.close")}
              aria-label={translate("sessions.live.bodyMap.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <BodyExaminationPanel
            markers={bodyMarkers}
            onChange={setBodyMarkers}
            bodyType={participant?.biological_sex ?? "unspecified"}
          />
        </div>
      )}

      {/* -- Chat feed -- */}
      <div className="flex-1 overflow-y-auto bg-[#F6F4FB] px-3 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <MessageSquare className="h-10 w-10 text-[#FADAE4] mb-3" />
            <p className="text-[#1A1A2E] text-sm font-bold">{translate("sessions.live.chat.started")}</p>
            <p className="text-[#6A6A77] text-xs mt-1">{translate("sessions.live.chat.startedHint")}</p>
          </div>
        )}

        <div className="space-y-0.5">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} translationView={translationView} />
          ))}
        </div>

        {/* Live recording bubble */}
        {isRecording && (
          <div className="flex justify-end px-1 mt-1">
            <div className="max-w-[82%] bg-white border border-[#F8C0CE] rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5 text-[#7C3AED]">
                <Radio className="h-3 w-3 animate-pulse" />
                <span className="text-[9px] font-bold uppercase tracking-wider">{translate("sessions.live.chat.listening")}</span>
              </div>
              <p className="text-[#6A6A77] text-sm italic">
                {recordingText || translate("sessions.live.chat.speakClearly")}
              </p>
            </div>
          </div>
        )}

        <div ref={chatBottomRef} className="h-2" />
      </div>

      {/* -- RP warning (above input) -- */}
      {rpFlags.length > 0 && !showSummary && (
        <div className="shrink-0 bg-red-50 border-t border-red-100 px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
          <p className="text-red-700 text-xs flex-1">
            <span className="font-semibold">{translate("sessions.live.rp.detected")}</span>
            <span className="text-red-500 ml-1">
              ({rpFlags.length} flag{rpFlags.length > 1 ? "s" : ""})
            </span>
          </p>
          <button
            onClick={() => setShowRpBottomSheet(true)}
            className="text-red-700 hover:text-red-900 text-[10px] font-bold underline shrink-0"
          >
            Review
          </button>
        </div>
      )}

      {/* -- Bottom input bar -- */}
      <div className="shrink-0 bg-white px-3 sm:px-4 py-3 border-t border-[#E8E8EA] shadow-[0_-8px_24px_rgba(55,48,163,0.06)]">
        <div className="client-translation-composer flex items-center gap-2 sm:gap-3">
          <div className="message-pill min-w-0 flex-1 h-12 sm:h-[52px] rounded-full bg-white border border-[#FADAE4] shadow-sm flex items-center pl-4 sm:pl-5 pr-1.5">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendTextMessage();
                }
              }}
              placeholder={translate("sessions.live.input.message")}
              disabled={!isActive}
              className="min-w-0 flex-1 bg-transparent text-[#1A1A2E] text-[15px] placeholder:text-[#9A8BC4] outline-none disabled:opacity-50"
            />
            <button
              type="button"
              aria-label={translate("sessions.live.input.attach")}
              onClick={() => fileAttachRef.current?.click()}
              disabled={!isActive || isUploadingAttachment}
              className="h-10 w-10 rounded-full flex items-center justify-center text-[#E8457A] hover:bg-[#ECECEC] transition-colors disabled:opacity-40 shrink-0"
            >
              {isUploadingAttachment ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
            </button>
          </div>

          {/* Mic */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!isActive}
            title={isRecording ? translate("sessions.live.input.stopRecording") : translate("sessions.live.input.startVoice")}
            className={cn(
              "voice-circle h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center text-white shadow-[0_8px_20px_rgba(55,48,163,0.24)] ring-4 ring-white border border-[#E8E8EA] transition-all shrink-0 disabled:opacity-45",
              isRecording
                ? "bg-[#FF2D6F] animate-pulse"
                : "bg-gradient-to-br from-[#6D35D8] to-[#FF2D6F] hover:scale-[1.02]",
            )}
          >
            {isRecording ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoUpload}
        title="Upload photo from camera"
        aria-label="Upload photo from camera"
      />
      <input
        ref={fileAttachRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,image/*"
        className="hidden"
        onChange={handleFileAttach}
        title="Attach file"
        aria-label={translate("sessions.live.input.attach")}
      />

      {/* -- Activity sheet -- */}
      {showActivitySheet && (
        <div
          className="absolute inset-0 z-40 flex items-end bg-black/20"
          onClick={() => setShowActivitySheet(false)}
        >
          <div
            className="w-full bg-white border-t border-[#E8E8EA] rounded-t-3xl shadow-2xl px-4 pt-4 pb-8 animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[#1A1A2E] font-bold text-sm">Log Activity</h3>
              <button
                onClick={() => setShowActivitySheet(false)}
                className="text-[#6A6A77] hover:text-[#E8457A]"
                title="Close activity sheet"
                aria-label="Close activity sheet"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {ACTIVITY_CATEGORIES.map((cat) => {
                const CatIcon = cat.icon;
                return (
                  <div key={cat.label}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <CatIcon className="h-3 w-3 text-[#6A6A77]" />
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#6A6A77]">
                        {cat.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {cat.items.map((a) => {
                        const AIcon = a.icon;
                        return (
                          <button
                            key={a.type}
                            onClick={() => logActivity(a.type)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition-all active:scale-95",
                              a.color,
                            )}
                          >
                            <AIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{a.type}</span>
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

      {/* -- Practitioner Approval Modal -- */}
      <Dialog
        open={showSummary}
        onOpenChange={(open) => {
          if (!isSaving) setShowSummary(open);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl p-0 bg-white" style={{ border: "1px solid rgba(232,213,232,0.5)" }}>
          <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: "rgba(232,213,232,0.5)" }}>
            <DialogTitle className="font-bold text-[18px] flex items-center gap-2" style={{ color: "#1C1626" }}>
              <Shield className="h-5 w-5" style={{ color: "#E8457A" }} />
              Review &amp; Approve Session Notes
            </DialogTitle>
            <DialogDescription className="text-[12px] mt-1" style={{ color: "#7A6A8A" }}>
              Review the auto-generated notes below. Edit anything before approving. Data is only
              saved on your explicit approval.
            </DialogDescription>
          </div>

          {postSaveResult ? (
            <div className="p-6 space-y-5">
              <ComplianceResultPanel
                score={postSaveResult.score}
                status={postSaveResult.status}
                rules={postSaveResult.rules}
                rpFlags={postSaveResult.rpFlags}
              />
              {postSaveResult.deltaSummaries && postSaveResult.deltaSummaries.length > 0 && (
                <div className="rounded-xl p-4 border space-y-2 bg-emerald-50 border-emerald-200">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-800">
                    Progress Recorded
                  </p>
                  {postSaveResult.deltaSummaries.map((line, idx) => (
                    <p key={idx} className="text-[13px] text-emerald-900">
                      {line}
                    </p>
                  ))}
                </div>
              )}
              <Button
                onClick={() => navigate(`/sessions/${id}`)}
                className="w-full text-white font-semibold gap-2 min-h-[44px] rounded-xl"
                style={{ background: "var(--cc-cta)" }}
              >
                <FileText className="h-4 w-4" />
                View Session Record
              </Button>
            </div>
          ) : summaryLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#E8457A" }} />
            </div>
          ) : summary ? (
            <div className="p-6 space-y-5">
              {/* Stat row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl p-3 text-center border" style={{ background: "var(--cc-soft)", borderColor: "rgba(232,213,232,0.5)" }}>
                  <p className="text-xl font-bold font-mono" style={{ color: "#1C1626" }}>{summary.duration}</p>
                  <p className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: "#7A6A8A" }}>
                    Duration
                  </p>
                </div>
                <div className="rounded-xl p-3 text-center border" style={{ background: "var(--cc-soft)", borderColor: "rgba(232,213,232,0.5)" }}>
                  <p className="text-xl font-bold" style={{ color: "#1C1626" }}>{summary.activities.length}</p>
                  <p className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: "#7A6A8A" }}>
                    Activities
                  </p>
                </div>
                <div
                  className={cn(
                    "rounded-xl p-3 text-center border",
                    liveCompliance.score >= 80
                      ? "bg-emerald-50 border-emerald-200"
                      : liveCompliance.score >= 60
                        ? "bg-amber-50 border-amber-200"
                        : "bg-red-50 border-red-200",
                  )}
                >
                  <p
                    className={cn(
                      "text-xl font-bold",
                      liveCompliance.score >= 80
                        ? "text-emerald-600"
                        : liveCompliance.score >= 60
                          ? "text-amber-600"
                          : "text-red-600",
                    )}
                  >
                    {liveCompliance.score}%
                  </p>
                  <p className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: "#7A6A8A" }}>
                    Compliance
                  </p>
                </div>
              </div>

              {/* RP Warning */}
              {rpFlags.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                  <div>
                    <p className="text-sm font-semibold text-red-700">
                      Possible restrictive practice language detected
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {rpFlags.map((f, i) => (
                        <li key={i} className="text-xs text-red-600">
                          <span className="font-medium">
                            {RP_CATEGORY_LABELS[f.category] ?? f.category}:
                          </span>{" "}
                          <span className="italic">"{f.phrase}"</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-red-600 mt-1.5">
                      You will be asked to review and acknowledge this before saving.
                    </p>
                  </div>
                </div>
              )}

              {/* Structured Case Notes */}
              <div className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: "#7A6A8A" }}>
                  <FileText className="h-3.5 w-3.5" /> Structured Case Notes
                  <span className="font-normal normal-case tracking-normal ml-1" style={{ color: "#F1738A" }}>
                    : required for NDIS compliance
                  </span>
                </p>
                {(
                  [
                    {
                      key: "activitiesPerformed" as keyof StructuredNotes,
                      label: "Activities Performed",
                      placeholder: translate("sessions.live.structured.activities"),
                      required: true,
                    },
                    {
                      key: "outcomes" as keyof StructuredNotes,
                      label: "Outcomes",
                      placeholder: translate("sessions.live.structured.outcomes"),
                      required: true,
                    },
                    {
                      key: "participantResponse" as keyof StructuredNotes,
                      label: "Participant Response",
                      placeholder: translate("sessions.live.structured.response"),
                      required: true,
                    },
                    {
                      key: "progressTowardGoals" as keyof StructuredNotes,
                      label: "Progress Toward NDIS Goals",
                      placeholder: translate("sessions.live.structured.goals"),
                      required: false,
                    },
                  ] as const
                ).map(({ key, label, placeholder, required }) => (
                  <div key={String(key)}>
                    <label className="text-[10px] font-semibold uppercase tracking-widest mb-1 flex items-center gap-1" style={{ color: "var(--cc-text)" }}>
                      {label}
                      {required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>
                    <SmartTextarea
                      value={structuredNotes[key]}
                      onChange={(val) =>
                        setStructuredNotes((prev) => ({ ...prev, [key]: val }))
                      }
                      rows={4}
                      placeholder={placeholder}
                      className="text-[12px] p-3 rounded-xl leading-relaxed min-h-[120px]"
                      style={{ background: "var(--cc-soft)", borderColor: "rgba(232,213,232,0.5)", color: "var(--cc-text)" }}
                    />
                  </div>
                ))}
              </div>

              {/* Compliance gate */}
              <div
                className={cn(
                  "rounded-xl border p-3 space-y-2",
                  liveCompliance.blocking
                    ? "bg-red-50 border-red-200"
                    : liveCompliance.score >= 80
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-amber-50 border-amber-200",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "#1C1626" }}>
                    <Shield className="h-3.5 w-3.5" style={{ color: "#7A6A8A" }} /> Compliance Check
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold",
                      liveCompliance.score >= 80
                        ? "text-emerald-700"
                        : liveCompliance.score >= 60
                          ? "text-amber-700"
                          : "text-red-700",
                    )}
                  >
                    {liveCompliance.score}/100
                  </span>
                </div>
                <ul className="space-y-1">
                  {liveCompliance.checks.map((c, i) => (
                    <li
                      key={i}
                      className={cn(
                        "text-xs flex items-center gap-1.5",
                        c.pass
                          ? "text-emerald-700"
                          : liveCompliance.blocking
                            ? "text-red-700"
                            : "text-amber-700",
                      )}
                    >
                      {c.pass ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                      ) : liveCompliance.blocking ? (
                        <XCircle className="h-3 w-3 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                      )}
                      <span>
                        {c.label}
                        {c.note ? (
                          <span className="font-normal ml-1" style={{ color: "#7A6A8A" }}>({c.note})</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                {liveCompliance.blocking && (
                  <p className="text-xs text-red-700 font-medium flex items-center gap-1.5 pt-1 border-t border-red-200">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    Resolve the items above before this session can be approved
                  </p>
                )}
              </div>

              {/* Clinical record */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-1.5" style={{ color: "#7A6A8A" }}>
                  <FileText className="h-3.5 w-3.5" /> Clinical Record
                  <span className="font-normal normal-case tracking-normal ml-1" style={{ color: "#F1738A" }}>
                    : auto-generated � editable
                  </span>
                </label>
                <SmartTextarea
                  value={editableNotes}
                  onChange={(v) => {
                    hasManuallyEditedNotesRef.current = true;
                    setEditableNotes(v);
                  }}
                  rows={6}
                  placeholder="Combined clinical record�"
                  className="text-[12px] p-3 rounded-xl font-mono leading-relaxed min-h-[120px]"
                  style={{ background: "var(--cc-bg)", borderColor: "rgba(232,213,232,0.5)", color: "var(--cc-text)" }}
                />
              </div>

              {/* Activities */}
              {summary.activities.length > 0 && (
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: "#7A6A8A" }}>
                    Activities Logged
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.activities.map((a, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-2.5 py-1 rounded-full font-medium"
                        style={{ background: "rgba(55,48,163,0.07)", color: "#E8457A" }}
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Goal progress */}
              {summary.goalProgress.length > 0 && (
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: "#7A6A8A" }}>
                    Goal Progress
                  </label>
                  <div className="space-y-1">
                    {summary.goalProgress.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--cc-text)" }}>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        {g}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence */}
              <div className="flex gap-3">
                <div className="flex-1 rounded-xl p-3 text-[12px] flex items-center gap-2" style={{ background: "var(--cc-soft)", border: "1px solid rgba(232,213,232,0.5)", color: "var(--cc-text)" }}>
                  <ImageIcon className="h-4 w-4 shrink-0" style={{ color: "#7A6A8A" }} />
                  {summary.evidenceSummary}
                </div>
                {summary.voiceNoteCount > 0 && (
                  <div className="flex-1 rounded-xl p-3 text-[12px] flex items-center gap-2" style={{ background: "var(--cc-soft)", border: "1px solid rgba(232,213,232,0.5)", color: "var(--cc-text)" }}>
                    <Mic className="h-4 w-4 shrink-0" style={{ color: "#7A6A8A" }} />
                    {summary.voiceNoteCount} voice note{summary.voiceNoteCount > 1 ? "s" : ""}{" "}
                    captured
                  </div>
                )}
              </div>

              {/* Progress delta preview (read-only, CARECLIQV2-78) */}
              {(previewProgressLoading ||
                previewDeltaSummaries.length > 0 ||
                previewProgressNotice) && (
                <div
                  className="rounded-xl p-4 border space-y-2"
                  style={{
                    background: previewDeltaSummaries.length > 0 ? "#F0FDF4" : "#FFFBEB",
                    borderColor: previewDeltaSummaries.length > 0 ? "#BBF7D0" : "#FDE68A",
                  }}
                >
                  <p
                    className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5"
                    style={{ color: previewDeltaSummaries.length > 0 ? "#065F46" : "#92400E" }}
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    Progress Summary
                    {previewDeltaSummaries.length > 0 && (
                      <span className="font-normal normal-case tracking-normal">
                        : confirm before approving
                      </span>
                    )}
                  </p>
                  {previewProgressLoading ? (
                    <div
                      className="flex items-center gap-2 text-[12px]"
                      style={{ color: previewDeltaSummaries.length > 0 ? "#047857" : "#B45309" }}
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Generating progress summary�
                    </div>
                  ) : previewDeltaSummaries.length > 0 ? (
                    <ul className="space-y-2">
                      {previewDeltaSummaries.map((summaryLine, idx) => (
                        <li
                          key={idx}
                          className="text-[13px] leading-relaxed text-emerald-900 bg-white/60 rounded-lg px-3 py-2"
                        >
                          {summaryLine}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    previewProgressNotice && (
                      <p className="text-[12px] leading-relaxed text-amber-900">{previewProgressNotice}</p>
                    )
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t" style={{ borderColor: "rgba(232,213,232,0.5)" }}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowSummary(false);
                    setElapsed(0);
                    setIsActive(false);
                  }}
                  disabled={isSaving}
                  className="flex-1 min-h-[44px] border-red-200 text-red-600 hover:bg-red-50 order-2 sm:order-1 rounded-xl"
                >
                  Discard Session
                </Button>
                <Button
                  onClick={handleInitiateApprove}
                  disabled={isSaving || liveCompliance.blocking}
                  className="flex-1 min-h-[44px] text-white font-semibold gap-2 disabled:opacity-50 order-1 sm:order-2 rounded-xl"
                  style={{ background: "var(--cc-cta)" }}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Shield className="h-4 w-4" />
                  )}
                  {isSaving
                    ? "Saving�"
                    : liveCompliance.blocking
                      ? "Fix Issues to Approve"
                      : "Approve & Save"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* -- RP Bottom Sheet -- */}
      {showRpBottomSheet && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowRpBottomSheet(false)}
          />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl shadow-2xl px-5 pt-5 pb-8 animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h3 className="text-base font-bold text-slate-900">
                Restrictive Practice Review Required
              </h3>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              The following restrictive practice language was detected in your notes. Please review
              carefully before saving.
            </p>
            <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
              {rpFlags.map((f, i) => (
                <div key={i} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">
                  <span className="font-semibold text-red-800">
                    {RP_CATEGORY_LABELS[f.category] ?? f.category}
                  </span>
                  <span className="text-red-700 ml-2 italic">"{f.phrase}"</span>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5">
              <Checkbox
                id="rp-ack"
                checked={rpAcknowledged}
                onCheckedChange={(v) => setRpAcknowledged(!!v)}
                className="mt-0.5 shrink-0"
              />
              <label
                htmlFor="rp-ack"
                className="text-sm text-amber-800 cursor-pointer leading-snug"
              >
                I have reviewed the compliance warning and confirm that any restrictive practices
                are covered under an approved Behaviour Support Plan.
              </label>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowRpBottomSheet(false)}
              >
                Go Back
              </Button>
              <Button
                disabled={!rpAcknowledged || isSaving}
                onClick={() => void handleApproveAndSave()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-2"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4" />
                )}
                {isSaving ? "Saving�" : "Confirm & Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* -- Restart Confirm -- */}
      <Dialog open={showRestartConfirm} onOpenChange={setShowRestartConfirm}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" /> Restart Session?
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 leading-relaxed mt-2">
              This will clear all current messages, voice notes, and photos. The timer will reset
              to zero.
              <br />
              <br />
              <span className="font-medium text-slate-700">This action cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowRestartConfirm(false)}
            >
              Keep Going
            </Button>
            <Button
              onClick={handleConfirmRestart}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              Yes, Restart
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
