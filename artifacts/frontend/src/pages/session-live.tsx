import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetSession,
  useSaveSessionWithAI,
  useUpdateSession,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
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
  Activity,
  FileText,
  Target,
  Image as ImageIcon,
  Plus,
  Clock,
  Loader2,
  Zap,
  Globe,
  ChevronRight,
  Shield,
  X,
  ClockIcon,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityLog {
  id: string;
  type: string;
  timestamp: Date;
  icon: string;
}

interface VoiceNote {
  id: string;
  text: string;
  timestamp: Date;
  translated?: string;
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
// Quick-activity definitions
// ---------------------------------------------------------------------------

const QUICK_ACTIVITIES = [
  {
    type: "Community Access",
    emoji: "🏘️",
    color: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
  },
  {
    type: "Mobility Support",
    emoji: "🚶",
    color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  },
  {
    type: "Meal Preparation",
    emoji: "🍽️",
    color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100",
  },
  {
    type: "Behaviour Support",
    emoji: "🧠",
    color: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100",
  },
  {
    type: "Communication",
    emoji: "💬",
    color: "bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100",
  },
  {
    type: "Life Skills",
    emoji: "⭐",
    color: "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100",
  },
  {
    type: "Personal Care",
    emoji: "🧼",
    color: "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100",
  },
  {
    type: "Social Skills",
    emoji: "🤝",
    color: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
  },
];

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
// Auto-summary generator (local heuristic)
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
  translationMode: boolean,
): LiveSummary {
  const durationMins = Math.max(Math.round(elapsed / 60), 1);

  const activityTypes = [...new Set(activities.map((a) => a.type))];
  const achievedGoals = goals.filter((g) => g.status === "achieved");
  const inProgressGoals = goals.filter((g) => g.status === "in_progress");

  const goalProgress = goals
    .filter((g) => g.status !== "not_started")
    .map((g) => `${g.name}: ${GOAL_STATUS_CONFIG[g.status].label}`);

  const voiceTexts = voiceNotes.map((v) => v.text).filter(Boolean);
  const activitiesFormatted = activities.map(
    (a) => `${a.type} (${format(a.timestamp, "HH:mm")})`,
  );

  // Build clinical notes as a professional structured paragraph
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
    lines.push(`Goals achieved during this session: ${achievedGoals.map((g) => g.name).join(", ")}.`);
  }
  if (inProgressGoals.length > 0) {
    lines.push(`Goals actively worked on: ${inProgressGoals.map((g) => g.name).join(", ")}.`);
  }

  if (voiceTexts.length > 0) {
    lines.push("");
    lines.push("Practitioner observations:");
    voiceTexts.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
  }

  if (images.length > 0) {
    lines.push("");
    lines.push(`Evidence: ${images.length} photo${images.length > 1 ? "s" : ""} captured as session evidence.`);
  }

  if (session.notes) {
    lines.push("");
    lines.push(`Pre-session notes: ${session.notes}`);
  }

  let clinicalNotes = lines.join("\n");

  // Compliance score: rules-based heuristic (0–100)
  let score = 0;
  if (clinicalNotes.length > 30) score += 30;  // clinical notes exist
  if (activities.length > 0) score += 30;       // at least one activity logged
  if (durationMins > 0) score += 20;            // duration is valid
  if (session.session_type) score += 20;         // session type exists
  score = Math.min(score, 100);

  const evidenceSummary =
    images.length > 0
      ? `${images.length} photo${images.length > 1 ? "s" : ""} captured during session`
      : "No photos captured";

  if (translationMode) {
    clinicalNotes = `[Translation: English]\n\n${clinicalNotes}`;
  }

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
  const saveWithAI = useSaveSessionWithAI();
  const updateSession = useUpdateSession();

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
  const [translationMode, setTranslationMode] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingText, setRecordingText] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Summary / approval modal
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [editableNotes, setEditableNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
          {
            id: "1",
            name: "Improve independent mobility",
            status: "not_started",
          },
          {
            id: "2",
            name: "Community participation skills",
            status: "not_started",
          },
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
        title: "📋 Session scheduled",
        description: `Ready to begin: ${session.session_type}. Click "Start" to begin recording.`,
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

  const handleStart = () => {
    startTimeRef.current = new Date();
    setIsActive(true);
    setElapsed(0);
    setReminderDismissed(true);
    if (reminderTimerRef.current) clearTimeout(reminderTimerRef.current);
    toast({
      title: "Session started",
      description: "Timer is running. Start documenting.",
    });
  };

  const handleStop = useCallback(async () => {
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
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
      translationMode,
    );
    setSummary(localSummary);
    setEditableNotes(localSummary.clinicalNotes);
    setSummaryLoading(false);
    // NOTE: Data is NOT saved here — practitioner must approve in the summary modal.
  }, [session, activities, voiceNotes, goals, images, elapsed, translationMode]);

  // Approve & save — two-step pipeline:
  //   1. PATCH session with actual captured data (duration, notes, transcription)
  //   2. Then trigger save-with-ai to run compliance + AI narrative on the saved data
  const handleApproveAndSave = useCallback(async () => {
    if (!id) {
      navigate("/sessions");
      return;
    }
    setIsSaving(true);

    // Build transcription from all voice notes
    const transcription = voiceNotes
      .map((n) => `[${n.timestamp}] ${n.text}`)
      .join("\n");

    // Actual elapsed duration in whole minutes (minimum 1)
    const durationMinutes = Math.max(1, Math.round(elapsed / 60));

    // Step 1 — persist the captured session data
    updateSession.mutate(
      {
        sessionId: id,
        data: {
          duration_minutes: durationMinutes,
          notes: editableNotes.trim() || undefined,
          transcription: transcription || undefined,
          status: "in_progress",
        },
      },
      {
        onSuccess: () => {
          // Step 2 — run AI compliance + clinical notes generation
          saveWithAI.mutate(
            { sessionId: id },
            {
              onSuccess: () => {
                setIsSaving(false);
                setShowSummary(false);
                toast({
                  title: "Session saved",
                  description: "Notes approved and clinical record updated.",
                });
                navigate(`/sessions/${id}`);
              },
              onError: (err) => {
                setIsSaving(false);
                console.error("save-with-ai failed", err);
                toast({
                  title: "AI analysis failed",
                  description: "Session data was saved but AI notes could not be generated.",
                  variant: "destructive",
                });
                navigate(`/sessions/${id}`);
              },
            },
          );
        },
        onError: (err) => {
          setIsSaving(false);
          console.error("update-session failed", err);
          toast({
            title: "Save failed",
            description: "Could not save session data. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  }, [id, elapsed, editableNotes, voiceNotes, updateSession, saveWithAI, toast, navigate]);

  // Restart — clears all state and restarts timer
  const handleConfirmRestart = () => {
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    setActivities([]);
    setVoiceNotes([]);
    setImages([]);
    setGoals(prev => prev.map(g => ({ ...g, status: "not_started" as const })));
    setShowRestartConfirm(false);
    setShowSummary(false);
    setSummary(null);
    setEditableNotes("");
    recognitionRef.current?.stop();
    setIsRecording(false);
    toast({ title: "Session restarted", description: "All logs cleared. Ready to begin." });
  };

  // Voice recording
  const startRecording = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognitionClass =
      w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      toast({
        title: "Voice not supported",
        description: "Use Chrome for voice notes.",
        variant: "destructive",
      });
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
      if (isRecording) recognition.start();
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    if (recordingText.trim()) {
      const note: VoiceNote = {
        id: Date.now().toString(),
        text: recordingText.trim(),
        timestamp: new Date(),
        translated: translationMode
          ? `[EN] ${recordingText.trim()}`
          : undefined,
      };
      setVoiceNotes((prev) => [note, ...prev]);
      setRecordingText("");
      toast({ title: "Voice note saved" });
    }
  };

  const logActivity = (type: string) => {
    if (!isActive) {
      toast({ title: "Start the session first", variant: "destructive" });
      return;
    }
    setActivities((prev) => [
      {
        id: Date.now().toString(),
        type,
        timestamp: new Date(),
        icon: QUICK_ACTIVITIES.find((a) => a.type === type)?.emoji ?? "•",
      },
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
    toast({
      title: "Photo captured",
      description: format(new Date(), "HH:mm:ss"),
    });
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-white/50" />
              <Switch
                checked={translationMode}
                onCheckedChange={setTranslationMode}
                className="data-[state=checked]:bg-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2">
              {elapsed > 0 && (
                <Button
                  onClick={() => setShowRestartConfirm(true)}
                  variant="ghost"
                  className="gap-1.5 text-white/60 hover:text-white hover:bg-white/10 font-medium px-3 py-1.5 h-auto text-xs"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
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

        {/* Timer status bar */}
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
              {isActive
                ? "In Progress"
                : elapsed > 0
                  ? "Paused"
                  : "Ready to Start"}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-white/40" />
              <span>{session.duration_minutes} min planned</span>
            </div>
            {session.session_date && (
              <div className="flex items-center gap-1">
                <ClockIcon className="h-3.5 w-3.5 text-white/40" />
                <span>
                  {format(new Date(session.session_date), "MMM d, yyyy")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Dashboard Split Grid ── */}
      <div className="flex-1 overflow-y-auto max-w-7xl w-full mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Client Summary & Goals */}
        <div className="space-y-6 md:col-span-1">
          {/* Quick Actions */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-500" /> Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIVITIES.map((a) => (
                <button
                  key={a.type}
                  onClick={() => logActivity(a.type)}
                  className={cn(
                    "flex items-center gap-2 p-2.5 rounded-xl border text-xs font-medium text-left transition-all active:scale-95 shadow-sm",
                    a.color,
                  )}
                >
                  <span className="text-base">{a.emoji}</span>
                  <span className="truncate leading-none">{a.type}</span>
                </button>
              ))}
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

          {/* AI Clinical Note Helper */}
          <div className="bg-indigo-950/10 border border-indigo-500/10 rounded-2xl p-5 shadow-sm">
            <h2 className="text-xs font-bold text-indigo-950 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" /> Summary Insights
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Activities performed: {activities.length ? activities.length : 0}{" "}
              items logged.
            </p>
            <Button
              onClick={() => {
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
                  translationMode,
                );
                setSummary(localSummary);
                setShowSummary(true);
              }}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs py-2 rounded-xl h-auto"
            >
              View Clinical Notes
            </Button>
          </div>
        </div>

        {/* Right Column: Unified Timeline & Evidence Section */}
        <div className="md:col-span-2 space-y-6">
          {/* Clinical Dictation Section */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Mic className="h-4 w-4 text-indigo-500" /> Clinical Dictation &
                Observations
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
                  <>
                    <MicOff className="h-3.5 w-3.5" /> Stop Recording
                  </>
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5" /> Start Dictation
                  </>
                )}
              </button>
            </div>

            {isRecording && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider">
                    Listening…
                  </span>
                </div>
                <p className="text-sm text-slate-700 italic">
                  {recordingText
                    ? `"${recordingText}"`
                    : "Dictation initialized. Speak clearly..."}
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
                    <span className="text-[10px] font-mono text-slate-400">
                      {format(note.timestamp, "HH:mm:ss")}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[9px] text-indigo-500 border-indigo-200 bg-indigo-50/50"
                    >
                      Dictated
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {note.text}
                  </p>
                  {translationMode && note.translated && (
                    <div className="mt-2 pt-2 border-t border-slate-200/50">
                      <p className="text-[10px] text-emerald-600 font-bold mb-0.5">
                        Translation (EN)
                      </p>
                      <p className="text-xs text-slate-500">
                        {note.translated}
                      </p>
                    </div>
                  )}
                </div>
              ))}

              {voiceNotes.length === 0 && !isRecording && (
                <div className="text-center py-10 text-slate-300 border border-dashed border-slate-200 rounded-xl">
                  <FileText className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs text-slate-400 font-medium">
                    No dictations added yet
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Record observations during the session.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Timeline and Photo Log */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-indigo-500" /> Activities
                Logged
              </h2>
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {activities.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between bg-slate-50/70 border border-slate-100 rounded-xl p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{a.icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-slate-800">
                          {a.type}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {format(a.timestamp, "HH:mm")}
                        </p>
                      </div>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                ))}
                {activities.length === 0 && (
                  <div className="text-center py-10 text-slate-400">
                    <p className="text-xs">No activities logged yet.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Session Evidence Section */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-indigo-500" /> Session
                    Evidence
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
                        <img
                          src={url}
                          alt={`Evidence ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-0.5">
                          <p className="text-[9px] text-white font-mono">
                            {format(new Date(), "HH:mm:ss")}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            setImages((prev) =>
                              prev.filter((_, idx) => idx !== i),
                            )
                          }
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
                    <p className="text-[10px] font-semibold">
                      Capture Evidence
                    </p>
                    <p className="text-[9px] text-slate-400">
                      Timestamped photos
                    </p>
                  </div>
                )}
              </div>

              {images.length > 0 && (
                <div className="text-[10px] text-slate-400 mt-3 pt-3 border-t border-slate-100 text-center">
                  Total {images.length} photo(s) captured.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Practitioner Approval & Save Modal ── */}
      <Dialog open={showSummary} onOpenChange={open => { if (!isSaving) setShowSummary(open); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-100 shadow-2xl p-0 bg-white">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100">
            <DialogTitle className="text-slate-900 font-bold text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-500" />
              Review & Approve Session Notes
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
                <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                  <p className={cn("text-xl font-bold", summary.complianceScore >= 80 ? "text-emerald-600" : summary.complianceScore >= 60 ? "text-amber-600" : "text-red-600")}>
                    {summary.complianceScore}%
                  </p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Compliance</p>
                </div>
              </div>

              {/* Editable clinical notes */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <FileText className="h-3.5 w-3.5" /> Clinical Notes
                  <span className="text-indigo-500 font-normal normal-case tracking-normal">— editable</span>
                </label>
                <textarea
                  value={editableNotes}
                  onChange={e => setEditableNotes(e.target.value)}
                  rows={8}
                  className="w-full text-xs p-4 bg-slate-50 rounded-xl border border-slate-200 font-mono text-slate-700 whitespace-pre-wrap leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              {/* Activities */}
              {summary.activities.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Activities Logged</label>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.activities.map((a, i) => (
                      <span key={i} className="text-[10px] px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full font-medium">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Goal progress */}
              {summary.goalProgress.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Goal Progress</label>
                  <div className="space-y-1">
                    {summary.goalProgress.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-slate-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />{g}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence + voice note count */}
              <div className="flex gap-3">
                <div className="flex-1 bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs text-slate-600 flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />{summary.evidenceSummary}
                </div>
                {summary.voiceNoteCount > 0 && (
                  <div className="flex-1 bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs text-slate-600 flex items-center gap-2">
                    <Mic className="h-4 w-4 text-slate-400 shrink-0" />{summary.voiceNoteCount} voice note{summary.voiceNoteCount > 1 ? "s" : ""} captured
                  </div>
                )}
              </div>

              {/* Approval actions */}
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
                  disabled={isSaving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-2"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                  {isSaving ? "Saving…" : "Approve & Save"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Restart Session Confirmation Modal ── */}
      <Dialog open={showRestartConfirm} onOpenChange={setShowRestartConfirm}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg className="h-5 w-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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
            <Button onClick={handleConfirmRestart} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold">
              Yes, Restart
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
