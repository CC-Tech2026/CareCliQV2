import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useGetSession } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Plus,
  Clock,
  Loader2,
  Globe,
  Shield,
  X,
  XCircle,
  Sparkles,
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { translateToEnglish } from "@/services/translationService";
import {
  checkStructuredCompliance,
  combineStructuredNotes,
  type StructuredNotes,
} from "@/services/ComplianceService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TranslationView = "original" | "translated" | "both";

interface ActivityLog {
  id: string;
  type: string;
  label?: string;
  timestamp: Date;
}

interface VoiceNote {
  id: string;
  text: string;
  timestamp: Date;
  translated?: string;
  detectedLanguage?: string;
  isTranslating?: boolean;
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
// Activity category definitions (no emojis — Lucide icons only)
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
    items: [
      {
        type: "Personal Care",
        icon: User,
        color: "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100",
      },
    ],
  },
  {
    label: "Community Access",
    icon: MapPin,
    items: [
      {
        type: "Community Access",
        icon: MapPin,
        color:
          "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
      },
    ],
  },
  {
    label: "Therapy Support",
    icon: HeartPulse,
    items: [
      {
        type: "Mobility Support",
        icon: Activity,
        color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
      },
      {
        type: "Behaviour Support",
        icon: ShieldCheck,
        color:
          "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
      },
    ],
  },
  {
    label: "Communication",
    icon: MessageSquare,
    items: [
      {
        type: "Communication",
        icon: MessageSquare,
        color: "bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100",
      },
      {
        type: "Social Skills",
        icon: Users,
        color:
          "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
      },
    ],
  },
  {
    label: "Daily Living",
    icon: Home,
    items: [
      {
        type: "Meal Preparation",
        icon: Utensils,
        color:
          "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100",
      },
      {
        type: "Life Skills",
        icon: BookOpen,
        color:
          "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100",
      },
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
  not_started: {
    label: "Not Started",
    cls: "bg-slate-100 text-slate-600 border-slate-300",
    icon: Circle,
  },
  in_progress: {
    label: "In Progress",
    cls: "bg-blue-50 text-blue-700 border-blue-300",
    icon: Activity,
  },
  achieved: {
    label: "Achieved",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-300",
    icon: CheckCircle2,
  },
  needs_review: {
    label: "Needs Review",
    cls: "bg-amber-50 text-amber-700 border-amber-300",
    icon: AlertCircle,
  },
};

// ---------------------------------------------------------------------------
// Timer helpers
// ---------------------------------------------------------------------------

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

// ---------------------------------------------------------------------------
// Clinical summary builder
// ---------------------------------------------------------------------------

function buildSummary(
  session: {
    session_type: string;
    duration_minutes: number;
    notes?: string | null;
  },
  activities: ActivityLog[],
  voiceNotes: VoiceNote[],
  goals: GoalItem[],
  images: string[],
  elapsed: number,
  translationView: TranslationView,
): LiveSummary {
  const durationMins = Math.max(Math.round(elapsed / 60), 1);
  const activityTypes = [...new Set(activities.map((a) => a.type))];
  const achievedGoals = goals.filter((g) => g.status === "achieved");
  const inProgressGoals = goals.filter((g) => g.status === "in_progress");

  const goalProgress = goals
    .filter((g) => g.status !== "not_started")
    .map((g) => `${g.name}: ${GOAL_STATUS_CONFIG[g.status].label}`);

  const voiceTexts = voiceNotes
    .map((v) =>
      translationView !== "original" && v.translated ? v.translated : v.text,
    )
    .filter(Boolean);

  const activitiesFormatted = activities.map(
    (a) => `${a.type} (${format(a.timestamp, "HH:mm")})`,
  );

  const lines: string[] = [];
  lines.push(`SESSION RECORD`);
  lines.push(`Type: ${session.session_type} | Duration: ${durationMins} minutes`);
  lines.push("");

  if (activityTypes.length > 0) {
    lines.push(`Support provided: ${activityTypes.join(", ")}.`);
  } else {
    lines.push("Support provided: General assistance and supervision.");
  }

  if (achievedGoals.length > 0) {
    lines.push(
      `Goals achieved during this session: ${achievedGoals.map((g) => g.name).join(", ")}.`,
    );
  }
  if (inProgressGoals.length > 0) {
    lines.push(
      `Goals actively worked on: ${inProgressGoals.map((g) => g.name).join(", ")}.`,
    );
  }

  if (voiceTexts.length > 0) {
    lines.push("");
    lines.push("Practitioner observations:");
    voiceTexts.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
  }

  if (images.length > 0) {
    lines.push("");
    lines.push(
      `Evidence: ${images.length} photo${images.length > 1 ? "s" : ""} captured as session evidence.`,
    );
  }

  if (session.notes) {
    lines.push("");
    lines.push(`Pre-session notes: ${session.notes}`);
  }

  if (translationView !== "original") {
    lines.unshift("[Observations translated to English]\n");
  }

  let clinicalNotes = lines.join("\n");

  let score = 0;
  if (clinicalNotes.length > 30) score += 30;
  if (activities.length > 0) score += 30;
  if (durationMins > 0) score += 20;
  if (session.session_type) score += 20;
  score = Math.min(score, 100);

  const evidenceSummary =
    images.length > 0
      ? `${images.length} photo${images.length > 1 ? "s" : ""} captured during session`
      : "No photos captured";

  return {
    clinicalNotes,
    activities: activitiesFormatted,
    goalProgress,
    complianceScore: score,
    duration: formatDuration(elapsed),
    voiceNoteCount: voiceNotes.length,
    imageCount: images.length,
    evidenceSummary,
  };
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

  // Session state
  const [isActive, setIsActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Content state
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [translationView, setTranslationView] =
    useState<TranslationView>("original");

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingText, setRecordingText] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const stopIntentRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Summary / approval modal
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

  // Keep editable combined preview in sync with structured fields.
  // Stop syncing once the user manually edits the final clinical record.
  useEffect(() => {
    if (hasManuallyEditedNotesRef.current) return;
    const combined = combineStructuredNotes(structuredNotes);
    if (combined) setEditableNotes(combined);
  }, [structuredNotes]);

  // Restart confirmation modal
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  // Session start reminder
  const reminderTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // Populate goals from session participant goals
  useEffect(() => {
    if (session && goals.length === 0) {
      const participantGoals = session.goals_addressed as string[] | null;
      if (participantGoals && participantGoals.length > 0) {
        setGoals(
          participantGoals.map((g, i) => ({
            id: String(i),
            name: g,
            status: "not_started" as const,
          })),
        );
      } else {
        setGoals([
          { id: "1", name: "Improve independent mobility", status: "not_started" },
          { id: "2", name: "Community participation skills", status: "not_started" },
          { id: "3", name: "Daily living tasks", status: "not_started" },
        ]);
      }
    }
  }, [session, goals.length]);

  // Timer
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

  // Session start reminder — fires 5s after page load if not yet started
  useEffect(() => {
    if (!session || isActive || reminderDismissed) return;
    reminderTimerRef.current = setTimeout(() => {
      toast({
        title: "Session scheduled",
        description: `Ready to begin: ${session.session_type}. Click "Start" to begin recording.`,
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

  const handleStart = () => {
    startTimeRef.current = new Date();
    setIsActive(true);
    setElapsed(0);
    setReminderDismissed(true);
    if (reminderTimerRef.current) clearTimeout(reminderTimerRef.current);
    toast({ title: "Session started", description: "Timer is running. Start documenting." });
  };

  const handleStop = useCallback(async () => {
    // Pre-modal blocking: timer must have been started
    if (elapsed === 0) {
      toast({
        title: "Session not started",
        description: "Click \"Start\" to begin the timer before ending the session.",
        variant: "destructive",
      });
      return;
    }
    // Pre-modal gate: only block when the session hasn't been timed at all.
    // The compliance gate on "Approve & Save" enforces the content requirements
    // (duration > 0 AND activities OR structured notes) — practitioners need the
    // modal open to fill in structured note fields before that gate is evaluated.

    // Reset manual-edit flag so the auto-generated notes are shown fresh each time
    hasManuallyEditedNotesRef.current = false;

    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    // Stop any active recording cleanly
    if (isRecording) {
      stopIntentRef.current = true;
      recognitionRef.current?.stop();
      setIsRecording(false);
    }
    setSummaryLoading(true);
    setShowSummary(true);

    const localSummary = buildSummary(
      {
        session_type: session?.session_type ?? "Session",
        duration_minutes: session?.duration_minutes ?? 0,
        notes: session?.notes,
      },
      activities,
      voiceNotes,
      goals,
      images,
      elapsed,
      translationView,
    );
    setSummary(localSummary);

    // Pre-fill structured note fields from session data
    const activityTypes = [...new Set(activities.map((a) => a.type))];
    const achievedGoals = goals.filter((g) => g.status === "achieved");
    const inProgressGoals = goals.filter((g) => g.status === "in_progress");
    const voiceTexts = voiceNotes
      .map((v) => (translationView !== "original" && v.translated ? v.translated : v.text))
      .filter(Boolean);
    setStructuredNotes({
      activitiesPerformed: activityTypes.length > 0
        ? activityTypes.join(", ")
        : activities.map((a) => `${a.type} (${format(a.timestamp, "HH:mm")})`).join("\n"),
      outcomes: [
        achievedGoals.length > 0
          ? `Goals achieved: ${achievedGoals.map((g) => g.name).join(", ")}.`
          : "",
        voiceTexts.length > 0
          ? `Observations: ${voiceTexts.slice(0, 2).join(" ")}`
          : "",
      ].filter(Boolean).join("\n"),
      participantResponse: "",
      progressTowardGoals: inProgressGoals.length > 0
        ? inProgressGoals.map((g) => `${g.name}: In Progress`).join("\n")
        : goals.filter((g) => g.status !== "not_started").map((g) => `${g.name}: ${GOAL_STATUS_CONFIG[g.status].label}`).join("\n"),
    });

    setSummaryLoading(false);
  }, [session, activities, voiceNotes, goals, images, elapsed, translationView, isRecording]);

  // Approve & save — two-step pipeline
  const handleApproveAndSave = useCallback(async () => {
    if (!id) { navigate("/sessions"); return; }
    setIsSaving(true);

    const transcription = voiceNotes
      .map((n) => `[${format(n.timestamp, "HH:mm")}] ${n.text}${n.translated && n.translated !== n.text ? ` [EN: ${n.translated}]` : ""}`)
      .join("\n");

    const durationMinutes = Math.max(1, Math.round(elapsed / 60));

    // Build the timestamped activity log for audit persistence
    const activityLog = activities.map((a) => ({
      timestamp: format(a.timestamp, "HH:mm"),
      type: a.type,
      label: a.label ?? a.type,
    }));

    try {
      // Step 1: Save all audit-critical data in one PATCH call (not dependent on AI)
      const patchBody: Record<string, unknown> = {
        duration_minutes: durationMinutes,
        notes: editableNotes.trim() || undefined,
        transcription: transcription || undefined,
        status: "completed",
        photo_urls: images,
        structured_notes: structuredNotes,
        activity_log: activityLog,
      };
      // Remove undefined values
      Object.keys(patchBody).forEach((k) => patchBody[k] === undefined && delete patchBody[k]);

      const patchRes = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!patchRes.ok) throw new Error(`Save failed: HTTP ${patchRes.status}`);

      // Step 2: Fire AI analysis as best-effort (non-critical for audit completeness)
      fetch(`/api/sessions/${id}/save-with-ai`, { method: "POST" }).catch((err) => {
        console.error("AI analysis failed (non-critical):", err);
      });

      setIsSaving(false);
      setShowSummary(false);
      toast({ title: "Session saved", description: "Notes approved and clinical record updated." });
      navigate(`/sessions/${id}`);
    } catch (err) {
      setIsSaving(false);
      console.error("session save failed", err);
      toast({ title: "Save failed", description: "Could not save session data. Please try again.", variant: "destructive" });
    }
  }, [id, elapsed, editableNotes, voiceNotes, structuredNotes, activities, toast, navigate]);

  // Restart — clears all state and restarts timer
  const handleConfirmRestart = () => {
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    setActivities([]);
    setVoiceNotes([]);
    setImages([]);
    setGoals((prev) => prev.map((g) => ({ ...g, status: "not_started" as const })));
    setShowRestartConfirm(false);
    setShowSummary(false);
    setSummary(null);
    hasManuallyEditedNotesRef.current = false;
    setEditableNotes("");
    setStructuredNotes({ activitiesPerformed: "", outcomes: "", participantResponse: "", progressTowardGoals: "" });
    stopIntentRef.current = true;
    recognitionRef.current?.stop();
    setIsRecording(false);
    toast({ title: "Session restarted", description: "All logs cleared. Ready to begin." });
  };

  // Voice recording
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

    const noteId = Date.now().toString();
    const needsTranslation = translationView !== "original";

    const note: VoiceNote = {
      id: noteId,
      text,
      timestamp: new Date(),
      isTranslating: needsTranslation,
    };
    setVoiceNotes((prev) => [note, ...prev]);
    setRecordingText("");
    toast({ title: "Voice note saved" });

    if (needsTranslation) {
      try {
        const result = await translateToEnglish(text);
        setVoiceNotes((prev) =>
          prev.map((n) =>
            n.id === noteId
              ? {
                  ...n,
                  isTranslating: false,
                  translated: result.translated,
                  detectedLanguage: result.detectedLanguage,
                }
              : n,
          ),
        );
      } catch {
        setVoiceNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, isTranslating: false } : n)),
        );
        toast({ title: "Translation unavailable", description: "Original text preserved.", variant: "destructive" });
      }
    }
  };

  const logActivity = (type: string) => {
    if (!isActive) {
      toast({ title: "Start the session first", variant: "destructive" });
      return;
    }
    setActivities((prev) => [
      { id: Date.now().toString(), type, timestamp: new Date() },
      ...prev,
    ]);
  };

  const cycleGoalStatus = (goalId: string) => {
    const cycle: GoalItem["status"][] = [
      "not_started",
      "in_progress",
      "achieved",
      "needs_review",
    ];
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id !== goalId) return g;
        const idx = cycle.indexOf(g.status);
        return { ...g, status: cycle[(idx + 1) % cycle.length] };
      }),
    );
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImages((prev) => [...prev, url]);
    toast({ title: "Photo captured", description: format(new Date(), "HH:mm:ss") });
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-slate-500">Session not found</p>
        <Button onClick={() => navigate("/sessions")} variant="outline">
          Back to Sessions
        </Button>
      </div>
    );
  }

  const participantName = session.participants?.full_name ?? "Session";

  // Live compliance for review modal (cheap pure fn — recomputes on every render)
  const liveCompliance = checkStructuredCompliance(
    structuredNotes,
    !!(session?.participant_id),
    elapsed > 0 ? Math.max(1, Math.round(elapsed / 60)) : 0,
    activities.length,
    images.length,
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">

      {/* ── Top control bar ── */}
      <div
        className={cn(
          "transition-colors duration-300 shrink-0 border-b border-white/10",
          isActive ? "bg-indigo-900" : "bg-slate-900",
        )}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
          <button
            onClick={() => navigate(`/sessions/${id}`)}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm transition-colors font-medium"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="text-center">
            <h1 className="text-white font-bold text-sm tracking-tight leading-tight">
              {participantName}
            </h1>
            <p className="text-white/60 text-xs">{session.session_type}</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Translation 3-way toggle */}
            <div className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-white/50 shrink-0" />
              <div className="flex rounded-md border border-white/20 overflow-hidden">
                {(["original", "translated", "both"] as TranslationView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setTranslationView(v)}
                    className={cn(
                      "px-2 py-1 text-[10px] font-medium transition-colors leading-none",
                      translationView === v
                        ? "bg-white/20 text-white"
                        : "text-white/40 hover:text-white/70",
                    )}
                  >
                    {v === "original" ? "Orig" : v === "translated" ? "EN" : "Both"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {elapsed > 0 && (
                <Button
                  onClick={() => setShowRestartConfirm(true)}
                  variant="ghost"
                  className="gap-1.5 text-white/60 hover:text-white hover:bg-white/10 font-medium px-3 py-1.5 h-auto text-xs"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Restart
                </Button>
              )}
              {!isActive ? (
                <Button
                  onClick={handleStart}
                  className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2 h-auto shadow-sm text-xs"
                >
                  <Play className="h-3.5 w-3.5 fill-white" />
                  {elapsed > 0 ? "Resume" : "Start"}
                </Button>
              ) : (
                <Button
                  onClick={handleStop}
                  className="gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 h-auto shadow-sm text-xs"
                >
                  <Square className="h-3.5 w-3.5 fill-white" />
                  End Session
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Timer + status bar */}
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 pb-3 text-xs text-white/70 flex-wrap gap-2 border-t border-white/10 pt-2.5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-bold text-white tracking-tight leading-none">
              {formatDuration(elapsed)}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border",
                isActive
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                  : "bg-slate-700 text-slate-300 border-slate-600",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-400",
                )}
              />
              {isActive ? "In Progress" : elapsed > 0 ? "Paused" : "Ready to Start"}
            </span>

            {/* Recording active pill */}
            {isRecording && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                <Radio className="h-2.5 w-2.5 animate-pulse" />
                Recording Active
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-white/40" />
              <span>{session.duration_minutes} min planned</span>
            </div>
            {session.session_date && (
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-white/40" />
                <span>{format(new Date(session.session_date), "MMM d, yyyy")}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="flex-1 overflow-y-auto max-w-7xl w-full mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Left column: Activity Log + Goals + Insights */}
        <div className="space-y-6 md:col-span-1">

          {/* Activity Log (was: Quick Actions) */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-indigo-500" /> Activity Log
            </h2>
            <div className="space-y-3">
              {ACTIVITY_CATEGORIES.map((cat) => {
                const CatIcon = cat.icon;
                return (
                  <div key={cat.label}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <CatIcon className="h-3 w-3 text-slate-400" />
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        {cat.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {cat.items.map((a) => {
                        const AIcon = a.icon;
                        return (
                          <button
                            key={a.type}
                            onClick={() => logActivity(a.type)}
                            className={cn(
                              "flex items-center gap-2 p-2.5 rounded-xl border text-xs font-medium text-left transition-all active:scale-95 shadow-sm",
                              a.color,
                            )}
                          >
                            <AIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate leading-none">{a.type}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Goals Addressed */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2 justify-between">
              <span className="flex items-center gap-2">
                <Target className="h-4 w-4 text-indigo-500" /> Goals Addressed
              </span>
              <Badge variant="secondary" className="text-[10px] bg-slate-50">
                {goals.length}
              </Badge>
            </h2>
            <div className="space-y-2">
              {goals.map((goal) => {
                const cfg = GOAL_STATUS_CONFIG[goal.status];
                const Icon = cfg.icon;
                return (
                  <button
                    key={goal.id}
                    onClick={() => cycleGoalStatus(goal.id)}
                    className="w-full flex items-center gap-3 bg-slate-50/50 hover:bg-slate-50 rounded-xl border border-slate-100/70 p-3 text-left transition-all"
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        goal.status === "achieved"
                          ? "text-emerald-500"
                          : goal.status === "in_progress"
                            ? "text-blue-500"
                            : goal.status === "needs_review"
                              ? "text-amber-500"
                              : "text-slate-400",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate leading-snug">
                        {goal.name}
                      </p>
                      <span
                        className={cn(
                          "inline-block mt-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border",
                          cfg.cls,
                        )}
                      >
                        {cfg.label}
                      </span>
                    </div>
                  </button>
                );
              })}
              {goals.length === 0 && (
                <div className="text-center py-6 text-slate-400 border border-dashed border-slate-100 rounded-xl">
                  <Target className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No goals linked</p>
                </div>
              )}
            </div>
          </div>

          {/* Summary Insights */}
          <div className="bg-indigo-950/10 border border-indigo-500/10 rounded-2xl p-5 shadow-sm">
            <h2 className="text-xs font-bold text-indigo-950 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" /> Summary Insights
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              {activities.length} activities logged. {voiceNotes.length} voice note{voiceNotes.length !== 1 ? "s" : ""} captured.
            </p>
            <Button
              onClick={handleStop}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs py-2 rounded-xl h-auto"
            >
              View Clinical Notes
            </Button>
          </div>
        </div>

        {/* Right column: Dictation + Audit log + Evidence */}
        <div className="md:col-span-2 space-y-6">

          {/* Clinical Dictation */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Mic className="h-4 w-4 text-indigo-500" /> Clinical Dictation &amp; Observations
              </h2>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm transition-all",
                  isRecording
                    ? "bg-red-500 text-white animate-pulse"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white",
                )}
              >
                {isRecording ? (
                  <><MicOff className="h-3.5 w-3.5" /> Stop Recording</>
                ) : (
                  <><Mic className="h-3.5 w-3.5" /> Start Dictation</>
                )}
              </button>
            </div>

            {isRecording && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider">
                    Listening
                  </span>
                  {translationView !== "original" && (
                    <span className="text-[10px] text-emerald-600 font-medium ml-auto">
                      Auto-translate on save
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-700 italic">
                  {recordingText ? `"${recordingText}"` : "Dictation initialized. Speak clearly…"}
                </p>
              </div>
            )}

            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {voiceNotes.map((note) => (
                <div
                  key={note.id}
                  className="bg-slate-50 rounded-xl border border-slate-100 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] text-slate-400">
                      {format(note.timestamp, "HH:mm:ss")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {note.detectedLanguage && note.detectedLanguage !== "en" && (
                        <Badge
                          variant="outline"
                          className="text-[9px] text-slate-500 border-slate-200 bg-slate-50"
                        >
                          {note.detectedLanguage.toUpperCase()}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[9px] text-indigo-500 border-indigo-200 bg-indigo-50/50"
                      >
                        Dictated
                      </Badge>
                    </div>
                  </div>

                  {/* Original text */}
                  {(translationView === "original" || translationView === "both") && (
                    <p className="text-sm text-slate-700 leading-relaxed">{note.text}</p>
                  )}

                  {/* Translation */}
                  {translationView !== "original" && (
                    <div className={cn(translationView === "both" && "mt-2 pt-2 border-t border-slate-200/50")}>
                      {note.isTranslating ? (
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 py-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Translating…
                        </div>
                      ) : note.translated ? (
                        <>
                          {translationView === "both" && (
                            <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 mb-0.5">
                              EN
                            </p>
                          )}
                          <p className="text-sm text-slate-700 leading-relaxed">
                            {note.translated}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 italic">Translation unavailable</p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {voiceNotes.length === 0 && !isRecording && (
                <div className="text-center py-10 text-slate-300 border border-dashed border-slate-200 rounded-xl">
                  <FileText className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs text-slate-400 font-medium">No dictations added yet</p>
                  <p className="text-[10px] text-slate-400">Record observations during the session.</p>
                </div>
              )}
            </div>
          </div>

          {/* Audit log + Evidence */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Activities — audit-style log */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-indigo-500" /> Activities Logged
              </h2>
              <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                {activities.map((a) => {
                  const def = findActivityDef(a.type);
                  const AIcon = def?.icon ?? Activity;
                  return (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 bg-slate-50/70 border border-slate-100 rounded-lg px-3 py-2"
                    >
                      <span className="font-mono text-[10px] text-slate-400 shrink-0 w-10">
                        [{format(a.timestamp, "HH:mm")}]
                      </span>
                      <AIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="text-xs font-medium text-slate-800 flex-1 truncate">
                        {a.type}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">Logged</span>
                    </div>
                  );
                })}
                {activities.length === 0 && (
                  <div className="text-center py-10 text-slate-400">
                    <p className="text-xs">No activities logged yet.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Session Evidence */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-indigo-500" /> Session Evidence
                  </h2>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-indigo-600 hover:text-indigo-700 font-bold text-[10px] flex items-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />

                {images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 max-h-[220px] overflow-y-auto pr-1">
                    {images.map((url, i) => (
                      <div
                        key={i}
                        className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shadow-sm"
                      >
                        <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-0.5">
                          <p className="text-[9px] text-white font-mono">{format(new Date(), "HH:mm:ss")}</p>
                        </div>
                        <button
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1.5 right-1.5 bg-black/60 rounded-full p-1 hover:bg-black/80"
                        >
                          <X className="h-3 w-3 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center gap-2 text-slate-400 hover:border-indigo-400 hover:bg-indigo-50/20 cursor-pointer transition-all h-[150px] justify-center"
                  >
                    <Camera className="h-6 w-6 text-slate-300" />
                    <p className="text-[10px] font-semibold">Capture Evidence</p>
                    <p className="text-[9px] text-slate-400">Timestamped photos</p>
                  </div>
                )}
              </div>
              {images.length > 0 && (
                <div className="text-[10px] text-slate-400 mt-3 pt-3 border-t border-slate-100 text-center">
                  {images.length} photo{images.length !== 1 ? "s" : ""} captured.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Practitioner Approval & Save Modal ── */}
      <Dialog
        open={showSummary}
        onOpenChange={(open) => { if (!isSaving) setShowSummary(open); }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-100 shadow-2xl p-0 bg-white">
          <div className="px-6 pt-6 pb-4 border-b border-slate-100">
            <DialogTitle className="text-slate-900 font-bold text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-500" />
              Review &amp; Approve Session Notes
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 mt-1">
              Review the auto-generated notes below. Edit anything before approving — data is only saved on your explicit approval.
            </DialogDescription>
          </div>

          {summaryLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
          ) : summary ? (
            <div className="p-6 space-y-5">

              {/* Stat row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                  <p className="text-xl font-bold text-slate-800 font-mono">{summary.duration}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Duration</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                  <p className="text-xl font-bold text-slate-800">{summary.activities.length}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Activities</p>
                </div>
                <div className={cn(
                  "rounded-xl p-3 text-center border",
                  liveCompliance.score >= 80 ? "bg-emerald-50 border-emerald-200" :
                  liveCompliance.score >= 60 ? "bg-amber-50 border-amber-200" :
                  "bg-red-50 border-red-200",
                )}>
                  <p className={cn(
                    "text-xl font-bold",
                    liveCompliance.score >= 80 ? "text-emerald-600" :
                    liveCompliance.score >= 60 ? "text-amber-600" : "text-red-600",
                  )}>
                    {liveCompliance.score}%
                  </p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Compliance</p>
                </div>
              </div>

              {/* Structured Case Notes */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Structured Case Notes
                  <span className="text-indigo-500 font-normal normal-case tracking-normal ml-1">
                    — mic available · required for NDIS compliance
                  </span>
                </p>
                {(
                  [
                    {
                      key: "activitiesPerformed" as keyof StructuredNotes,
                      label: "Activities Performed",
                      placeholder: "Describe the specific support activities provided during this session...",
                      required: true,
                    },
                    {
                      key: "outcomes" as keyof StructuredNotes,
                      label: "Outcomes",
                      placeholder: "Measurable outcomes achieved (e.g. participant demonstrated, achieved, progressed toward...)",
                      required: true,
                    },
                    {
                      key: "participantResponse" as keyof StructuredNotes,
                      label: "Participant Response",
                      placeholder: "How did the participant engage and respond during the session?",
                      required: true,
                    },
                    {
                      key: "progressTowardGoals" as keyof StructuredNotes,
                      label: "Progress Toward NDIS Goals",
                      placeholder: "Link outcomes to specific NDIS goals addressed in this session...",
                      required: false,
                    },
                  ] as const
                ).map(({ key, label, placeholder, required }) => (
                  <div key={key}>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                      {label}
                      {required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>
                    <SmartTextarea
                      value={structuredNotes[key]}
                      onChange={(val) =>
                        setStructuredNotes((prev) => ({ ...prev, [key]: val }))
                      }
                      rows={2}
                      placeholder={placeholder}
                      className="text-xs p-3 bg-slate-50 rounded-xl border border-slate-200 text-slate-700 leading-relaxed"
                    />
                  </div>
                ))}
              </div>

              {/* Compliance Gate — all 5 checks with pass/fail from ComplianceService */}
              <div className={cn(
                "rounded-xl border p-3 space-y-2",
                liveCompliance.blocking
                  ? "bg-red-50 border-red-200"
                  : liveCompliance.score >= 80
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-amber-50 border-amber-200",
              )}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-slate-400" />
                    Compliance Check
                  </span>
                  <span className={cn(
                    "text-sm font-bold",
                    liveCompliance.score >= 80 ? "text-emerald-700" :
                    liveCompliance.score >= 60 ? "text-amber-700" : "text-red-700",
                  )}>
                    {liveCompliance.score}/100
                  </span>
                </div>
                <ul className="space-y-1">
                  {liveCompliance.checks.map((c, i) => (
                    <li key={i} className={cn("text-xs flex items-center gap-1.5", c.pass ? "text-emerald-700" : liveCompliance.blocking ? "text-red-700" : "text-amber-700")}>
                      {c.pass
                        ? <CheckCircle2 className="h-3 w-3 shrink-0" />
                        : liveCompliance.blocking
                          ? <XCircle className="h-3 w-3 shrink-0" />
                          : <AlertTriangle className="h-3 w-3 shrink-0" />
                      }
                      <span>{c.label}{c.note ? <span className="text-slate-500 font-normal ml-1">({c.note})</span> : null}</span>
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


              {/* Combined Clinical Record — editable final version */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <FileText className="h-3.5 w-3.5" /> Clinical Record
                  <span className="text-indigo-500 font-normal normal-case tracking-normal ml-1">
                    — auto-generated from fields above · editable before saving
                  </span>
                </label>
                <SmartTextarea
                  value={editableNotes}
                  onChange={(v) => { hasManuallyEditedNotesRef.current = true; setEditableNotes(v); }}
                  rows={6}
                  placeholder="Combined clinical record will appear here as you fill the fields above..."
                  className="text-xs p-3 bg-white rounded-xl border border-slate-200 font-mono text-slate-700 leading-relaxed"
                />
              </div>

              {/* Activities */}
              {summary.activities.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Activities Logged
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.activities.map((a, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full font-medium"
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
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Goal Progress
                  </label>
                  <div className="space-y-1">
                    {summary.goalProgress.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        {g}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence + voice count */}
              <div className="flex gap-3">
                <div className="flex-1 bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs text-slate-600 flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />
                  {summary.evidenceSummary}
                </div>
                {summary.voiceNoteCount > 0 && (
                  <div className="flex-1 bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs text-slate-600 flex items-center gap-2">
                    <Mic className="h-4 w-4 text-slate-400 shrink-0" />
                    {summary.voiceNoteCount} voice note{summary.voiceNoteCount > 1 ? "s" : ""} captured
                  </div>
                )}
              </div>

              {/* Approval actions — sticky feel */}
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <Button
                  variant="outline"
                  onClick={() => { setShowSummary(false); setElapsed(0); setIsActive(false); }}
                  disabled={isSaving}
                  className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
                >
                  Discard Session
                </Button>
                <Button
                  onClick={handleApproveAndSave}
                  disabled={isSaving || liveCompliance.blocking}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-2 disabled:opacity-50"
                  title={liveCompliance.blocking ? "Resolve compliance issues before approving" : undefined}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Shield className="h-4 w-4" />
                  )}
                  {isSaving ? "Saving…" : liveCompliance.blocking ? "Fix Issues to Approve" : "Approve & Save"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Restart Confirmation Modal ── */}
      <Dialog open={showRestartConfirm} onOpenChange={setShowRestartConfirm}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Restart Session?
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 leading-relaxed mt-2">
              This will clear all current logs — activities, voice notes, and photos captured so far will be lost. The timer will reset to zero.
              <br /><br />
              <span className="font-medium text-slate-700">This action cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button variant="outline" onClick={() => setShowRestartConfirm(false)} className="flex-1">
              Keep Going
            </Button>
            <Button
              onClick={handleConfirmRestart}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold"
            >
              Yes, Restart
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
