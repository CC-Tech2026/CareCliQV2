import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useGetSession, useSaveSessionWithAI } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import {
  ArrowLeft, Play, Square, Mic, MicOff, Camera, CheckCircle2, Circle,
  AlertCircle, Activity, FileText, Target, Image as ImageIcon,
  Plus, Clock, Loader2, Zap, Globe, ChevronRight, Shield, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

type Tab = "activities" | "notes" | "goals" | "evidence";

// ---------------------------------------------------------------------------
// Quick-activity definitions
// ---------------------------------------------------------------------------

const QUICK_ACTIVITIES = [
  { type: "Community Access", emoji: "🏘️", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { type: "Mobility Support", emoji: "🚶", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { type: "Meal Preparation", emoji: "🍽️", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { type: "Behaviour Support", emoji: "🧠", color: "bg-green-100 text-green-700 border-green-200" },
  { type: "Communication", emoji: "💬", color: "bg-pink-100 text-pink-700 border-pink-200" },
  { type: "Life Skills", emoji: "⭐", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  { type: "Personal Care", emoji: "🧼", color: "bg-teal-100 text-teal-700 border-teal-200" },
  { type: "Social Skills", emoji: "🤝", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
];

const GOAL_STATUS_CONFIG = {
  not_started: { label: "Not Started", cls: "bg-slate-100 text-slate-600 border-slate-300", icon: Circle },
  in_progress: { label: "In Progress", cls: "bg-blue-100 text-blue-700 border-blue-300", icon: Activity },
  achieved: { label: "Achieved", cls: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: CheckCircle2 },
  needs_review: { label: "Needs Review", cls: "bg-amber-100 text-amber-700 border-amber-300", icon: AlertCircle },
};

// ---------------------------------------------------------------------------
// Timer helpers
// ---------------------------------------------------------------------------

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}

// ---------------------------------------------------------------------------
// Auto-summary generator (local heuristic)
// ---------------------------------------------------------------------------

function buildSummary(
  session: { session_type: string; duration_minutes: number; notes?: string | null },
  activities: ActivityLog[],
  voiceNotes: VoiceNote[],
  goals: GoalItem[],
  images: string[],
  elapsed: number,
  translationMode: boolean
): LiveSummary {
  const durationMins = Math.max(Math.round(elapsed / 60), 1);

  const activityTypes = [...new Set(activities.map(a => a.type))];
  const achievedGoals = goals.filter(g => g.status === "achieved");
  const inProgressGoals = goals.filter(g => g.status === "in_progress");

  const goalProgress = goals
    .filter(g => g.status !== "not_started")
    .map(g => `${g.name}: ${GOAL_STATUS_CONFIG[g.status].label}`);

  const voiceTexts = voiceNotes.map(v => v.text).filter(Boolean);
  const activitiesFormatted = activities.map(a =>
    `${a.type} (${format(a.timestamp, "HH:mm")})`
  );

  // Build clinical notes
  let clinicalNotes = `Session Type: ${session.session_type}\nDuration: ${durationMins} minutes\n\n`;

  if (activityTypes.length > 0) {
    clinicalNotes += `Activities performed: ${activityTypes.join(", ")}. `;
  }
  if (achievedGoals.length > 0) {
    clinicalNotes += `Participant achieved ${achievedGoals.length} goal(s): ${achievedGoals.map(g => g.name).join(", ")}. `;
  }
  if (inProgressGoals.length > 0) {
    clinicalNotes += `Goals in progress: ${inProgressGoals.map(g => g.name).join(", ")}. `;
  }
  if (voiceTexts.length > 0) {
    clinicalNotes += `\n\nVoice observations:\n${voiceTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
  }
  if (images.length > 0) {
    clinicalNotes += `\n\n${images.length} photo(s) captured as session evidence.`;
  }

  // Compliance scoring heuristic
  let score = 40;
  if (durationMins > 0) score += 10;
  if (voiceNotes.length > 0) score += 20;
  if (activities.length > 0) score += 15;
  if (achievedGoals.length > 0) score += 10;
  if (images.length > 0) score += 5;
  score = Math.min(score, 100);

  const evidenceSummary = images.length > 0
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

  // Session state
  const [isActive, setIsActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Content state
  const [activeTab, setActiveTab] = useState<Tab>("activities");
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

  // Summary modal
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Populate goals from session participant goals
  useEffect(() => {
    if (session && goals.length === 0) {
      const participantGoals = session.goals_addressed as string[] | null;
      if (participantGoals && participantGoals.length > 0) {
        setGoals(participantGoals.map((g, i) => ({
          id: String(i),
          name: g,
          status: "not_started" as const,
        })));
      } else {
        // Default placeholder goals
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
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive]);

  const handleStart = () => {
    startTimeRef.current = new Date();
    setIsActive(true);
    setElapsed(0);
    toast({ title: "Session started", description: "Timer is running. Start documenting." });
  };

  const handleStop = useCallback(async () => {
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setSummaryLoading(true);
    setShowSummary(true);

    // Build local summary immediately
    const localSummary = buildSummary(
      { session_type: session?.session_type ?? "Session", duration_minutes: session?.duration_minutes ?? 0, notes: session?.notes },
      activities, voiceNotes, goals, images, elapsed, translationMode
    );
    setSummary(localSummary);
    setSummaryLoading(false);

    // Also fire AI analysis in background
    if (id) {
      saveWithAI.mutate({ sessionId: id }, {
        onSuccess: () => toast({ title: "AI notes saved", description: "Session fully documented." }),
        onError: () => {},
      });
    }
  }, [session, activities, voiceNotes, goals, images, elapsed, translationMode, id, saveWithAI, toast]);

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
        translated: translationMode ? `[EN] ${recordingText.trim()}` : undefined,
      };
      setVoiceNotes(prev => [note, ...prev]);
      setRecordingText("");
      toast({ title: "Voice note saved" });
    }
  };

  const logActivity = (type: string) => {
    if (!isActive) {
      toast({ title: "Start the session first", variant: "destructive" });
      return;
    }
    setActivities(prev => [{
      id: Date.now().toString(),
      type,
      timestamp: new Date(),
      icon: QUICK_ACTIVITIES.find(a => a.type === type)?.emoji ?? "•",
    }, ...prev]);
  };

  const cycleGoalStatus = (goalId: string) => {
    const cycle: GoalItem["status"][] = ["not_started", "in_progress", "achieved", "needs_review"];
    setGoals(prev => prev.map(g => {
      if (g.id !== goalId) return g;
      const idx = cycle.indexOf(g.status);
      return { ...g, status: cycle[(idx + 1) % cycle.length] };
    }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImages(prev => [...prev, url]);
    setActiveTab("evidence");
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
        <Button onClick={() => navigate("/sessions")} variant="outline">Back to Sessions</Button>
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
      <div className={cn(
        "transition-colors duration-300 shrink-0",
        isActive ? "bg-indigo-700" : "bg-slate-800"
      )}>
        {/* Navigation row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <button
            onClick={() => navigate(`/sessions/${id}`)}
            className="flex items-center gap-1.5 text-white/80 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="text-center">
            <p className="text-white font-semibold text-sm">{participantName}</p>
            <p className="text-white/60 text-xs">{session.session_type}</p>
          </div>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-white/60" />
            <Switch
              checked={translationMode}
              onCheckedChange={setTranslationMode}
              className="data-[state=checked]:bg-emerald-400"
            />
          </div>
        </div>

        {/* Timer + control */}
        <div className="flex items-center justify-between px-4 pb-4 pt-2">
          <div>
            <div className="font-mono text-4xl font-bold text-white tracking-tight">
              {formatDuration(elapsed)}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={cn(
                "h-2 w-2 rounded-full",
                isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              )} />
              <span className="text-xs text-white/70">
                {isActive ? "Session in progress" : elapsed > 0 ? "Session paused" : "Ready to start"}
              </span>
            </div>
          </div>

          {!isActive ? (
            <Button
              onClick={handleStart}
              className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2.5 h-auto shadow-lg"
            >
              <Play className="h-4 w-4 fill-white" />
              {elapsed > 0 ? "Resume" : "Start Session"}
            </Button>
          ) : (
            <Button
              onClick={handleStop}
              className="gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-5 py-2.5 h-auto shadow-lg"
            >
              <Square className="h-4 w-4 fill-white" />
              End Session
            </Button>
          )}
        </div>

        {/* Session info chips */}
        <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
          <span className="text-xs bg-white/15 text-white/90 rounded-full px-2.5 py-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" /> {session.duration_minutes} min planned
          </span>
          {session.session_date && (
            <span className="text-xs bg-white/15 text-white/90 rounded-full px-2.5 py-0.5">
              {format(new Date(session.session_date), "MMM d, yyyy")}
            </span>
          )}
          {translationMode && (
            <span className="text-xs bg-emerald-400/30 text-emerald-200 rounded-full px-2.5 py-0.5 flex items-center gap-1">
              <Globe className="h-3 w-3" /> Translation On
            </span>
          )}
          {activities.length > 0 && (
            <span className="text-xs bg-white/15 text-white/90 rounded-full px-2.5 py-0.5">
              {activities.length} activit{activities.length === 1 ? "y" : "ies"} logged
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-t border-white/10">
          {(["activities", "notes", "goals", "evidence"] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                activeTab === tab
                  ? "text-white border-b-2 border-white"
                  : "text-white/50 hover:text-white/80"
              )}
            >
              {tab === "activities" && <Activity className="h-3.5 w-3.5 mx-auto mb-0.5" />}
              {tab === "notes" && <FileText className="h-3.5 w-3.5 mx-auto mb-0.5" />}
              {tab === "goals" && <Target className="h-3.5 w-3.5 mx-auto mb-0.5" />}
              {tab === "evidence" && <ImageIcon className="h-3.5 w-3.5 mx-auto mb-0.5" />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-y-auto pb-24">

        {/* ACTIVITIES tab */}
        {activeTab === "activities" && (
          <div className="p-4 space-y-5">
            {/* Quick Add grid */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Add</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIVITIES.map(a => (
                  <button
                    key={a.type}
                    onClick={() => logActivity(a.type)}
                    className={cn(
                      "flex items-center gap-2.5 p-3 rounded-xl border text-sm font-medium text-left transition-all active:scale-95",
                      a.color,
                      "hover:shadow-sm"
                    )}
                  >
                    <span className="text-xl">{a.emoji}</span>
                    <span className="leading-tight">{a.type}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Activity log */}
            {activities.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Today's Activities
                </p>
                <div className="space-y-2">
                  {activities.map(a => (
                    <div key={a.id} className="flex items-center justify-between bg-white rounded-xl border border-slate-100 px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{a.icon}</span>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{a.type}</p>
                          <p className="text-xs text-slate-400">{format(a.timestamp, "HH:mm")}</p>
                        </div>
                      </div>
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activities.length === 0 && (
              <div className="text-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-xl">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Tap an activity above to log it</p>
              </div>
            )}
          </div>
        )}

        {/* NOTES tab */}
        {activeTab === "notes" && (
          <div className="p-4 space-y-4">
            {/* Recording in progress */}
            {isRecording && recordingText && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">Recording…</span>
                </div>
                <p className="text-sm text-slate-700 italic">"{recordingText}"</p>
              </div>
            )}

            {/* Voice notes */}
            {voiceNotes.length > 0 && (
              <div className="space-y-3">
                {voiceNotes.map(note => (
                  <div key={note.id} className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-slate-400">{format(note.timestamp, "HH:mm:ss")}</span>
                      <Mic className="h-3.5 w-3.5 text-indigo-400" />
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{note.text}</p>
                    {translationMode && note.translated && (
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <p className="text-xs text-emerald-600 font-medium mb-0.5">Translation (EN)</p>
                        <p className="text-xs text-slate-500">{note.translated}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {voiceNotes.length === 0 && !isRecording && (
              <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-xl">
                <Mic className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Tap the mic button below to add a voice note</p>
                <p className="text-xs mt-1 text-slate-300">Notes are automatically timestamped</p>
              </div>
            )}
          </div>
        )}

        {/* GOALS tab */}
        {activeTab === "goals" && (
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-400">Tap a goal to cycle through status</p>
            {goals.map(goal => {
              const cfg = GOAL_STATUS_CONFIG[goal.status];
              const Icon = cfg.icon;
              return (
                <button
                  key={goal.id}
                  onClick={() => cycleGoalStatus(goal.id)}
                  className="w-full flex items-center gap-4 bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-left hover:shadow-md transition-all active:scale-[0.99]"
                >
                  <Icon className={cn(
                    "h-5 w-5 shrink-0",
                    goal.status === "achieved" ? "text-emerald-500" :
                    goal.status === "in_progress" ? "text-blue-500" :
                    goal.status === "needs_review" ? "text-amber-500" :
                    "text-slate-300"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 leading-snug">{goal.name}</p>
                    <span className={cn(
                      "inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
                      cfg.cls
                    )}>
                      {cfg.label}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                </button>
              );
            })}

            {goals.length === 0 && (
              <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-xl">
                <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No goals linked to this session</p>
              </div>
            )}
          </div>
        )}

        {/* EVIDENCE tab */}
        {activeTab === "evidence" && (
          <div className="p-4 space-y-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-indigo-200 rounded-xl py-8 flex flex-col items-center gap-2 text-indigo-400 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all"
            >
              <Camera className="h-8 w-8" />
              <p className="text-sm font-medium">Tap to capture photo</p>
              <p className="text-xs text-slate-400">Automatically timestamped</p>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoUpload}
            />

            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {images.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shadow-sm">
                    <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-2 py-1">
                      <p className="text-[10px] text-white font-mono">{format(new Date(), "HH:mm:ss")}</p>
                    </div>
                    <button
                      onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1.5 right-1.5 bg-black/50 rounded-full p-0.5 hover:bg-black/70"
                    >
                      <X className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {images.length === 0 && (
              <p className="text-center text-xs text-slate-400">No photos captured yet</p>
            )}
          </div>
        )}
      </div>

      {/* ── Fixed bottom quick-action bar ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg safe-area-pb z-20">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-around">
          {/* Activity shortcut */}
          <button
            onClick={() => setActiveTab("activities")}
            className="flex flex-col items-center gap-1 text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <div className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center",
              activeTab === "activities" ? "bg-indigo-100 text-indigo-600" : "bg-slate-100"
            )}>
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-medium">Activity</span>
          </button>

          {/* Voice note button */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className="flex flex-col items-center gap-1"
          >
            <div className={cn(
              "h-14 w-14 rounded-full flex items-center justify-center shadow-md transition-all",
              isRecording
                ? "bg-red-500 scale-110 shadow-red-200"
                : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"
            )}>
              {isRecording
                ? <MicOff className="h-6 w-6 text-white" />
                : <Mic className="h-6 w-6 text-white" />}
            </div>
            <span className="text-[10px] font-medium text-slate-500">
              {isRecording ? "Stop" : "Voice Note"}
            </span>
          </button>

          {/* Photo button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-1 text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <div className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center",
              activeTab === "evidence" ? "bg-indigo-100 text-indigo-600" : "bg-slate-100"
            )}>
              <Camera className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-medium">Photo</span>
          </button>

          {/* Goals button */}
          <button
            onClick={() => setActiveTab("goals")}
            className="flex flex-col items-center gap-1 text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <div className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center",
              activeTab === "goals" ? "bg-indigo-100 text-indigo-600" : "bg-slate-100"
            )}>
              <Target className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-medium">Goal</span>
          </button>
        </div>
      </div>

      {/* ── Session Summary Modal ── */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-indigo-500" />
              Session Summary
            </DialogTitle>
            <DialogDescription>
              Auto-generated documentation for {participantName}
            </DialogDescription>
          </DialogHeader>

          {summaryLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
          ) : summary ? (
            <div className="space-y-5 mt-2">

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center bg-slate-50 rounded-xl p-3">
                  <p className="text-2xl font-bold text-slate-800">{summary.duration}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Duration</p>
                </div>
                <div className="text-center bg-slate-50 rounded-xl p-3">
                  <p className="text-2xl font-bold text-slate-800">{activities.length}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Activities</p>
                </div>
                <div className="text-center bg-slate-50 rounded-xl p-3">
                  <p className={cn(
                    "text-2xl font-bold",
                    summary.complianceScore >= 80 ? "text-emerald-600" :
                    summary.complianceScore >= 60 ? "text-amber-600" : "text-red-600"
                  )}>{summary.complianceScore}%</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">Compliance</p>
                </div>
              </div>

              {/* Compliance bar */}
              <div>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Compliance Score</span>
                  <span className={
                    summary.complianceScore >= 80 ? "text-emerald-600 font-semibold" :
                    summary.complianceScore >= 60 ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"
                  }>{summary.complianceScore}%</span>
                </div>
                <Progress
                  value={summary.complianceScore}
                  className={cn("h-2", summary.complianceScore >= 80 ? "[&>div]:bg-emerald-500" : summary.complianceScore >= 60 ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500")}
                />
              </div>

              {/* Clinical notes */}
              <div className="bg-indigo-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Clinical Notes
                </p>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{summary.clinicalNotes}</p>
              </div>

              {/* Activities */}
              {summary.activities.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Activities Logged</p>
                  <div className="space-y-1">
                    {summary.activities.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Goal progress */}
              {summary.goalProgress.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Goal Progress</p>
                  <div className="space-y-1">
                    {summary.goalProgress.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                        <Target className="h-4 w-4 text-indigo-400 shrink-0" /> {g}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence */}
              <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3 text-sm text-slate-600">
                <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />
                {summary.evidenceSummary}
              </div>

              {/* Voice notes count */}
              {summary.voiceNoteCount > 0 && (
                <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3 text-sm text-slate-600">
                  <Mic className="h-4 w-4 text-slate-400 shrink-0" />
                  {summary.voiceNoteCount} voice note{summary.voiceNoteCount > 1 ? "s" : ""} captured
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                  onClick={() => { setShowSummary(false); navigate(`/sessions/${id}`); }}
                >
                  <FileText className="h-4 w-4 mr-2" /> View Full Session
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowSummary(false); navigate("/sessions"); }}
                >
                  Done
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
