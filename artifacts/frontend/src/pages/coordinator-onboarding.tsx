import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, ArrowRight, Users, UserPlus,
  ClipboardList, FileText, Building2, ChevronRight,
  Sparkles, ExternalLink,
} from "lucide-react";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

interface ChecklistStep {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  action?: { label: string; href: string };
  autoComplete?: boolean;
}

const STEPS: ChecklistStep[] = [
  {
    id: "org_created",
    icon: Building2,
    title: "Organisation account created",
    description: "Your organisation is set up and ready. You are the owner with full access to all features.",
    autoComplete: true,
  },
  {
    id: "invite_workers",
    icon: UserPlus,
    title: "Invite your support workers",
    description: "Send invitations to your team. Workers will receive an email to create their password and join your organisation.",
    action: { label: "Go to Team Settings", href: "/settings" },
  },
  {
    id: "add_participants",
    icon: Users,
    title: "Add your first participant",
    description: "Create participant profiles with NDIS numbers, plan details, and support goals.",
    action: { label: "Add Participant", href: "/patients" },
  },
  {
    id: "create_session",
    icon: ClipboardList,
    title: "Create your first session",
    description: "Schedule a support session, link it to a participant, and start capturing NDIS-compliant notes.",
    action: { label: "New Session", href: "/sessions/new" },
  },
  {
    id: "begin_documentation",
    icon: FileText,
    title: "Begin documentation",
    description: "Use AI-assisted note writing, live session capture, and automatic compliance checking to stay audit-ready.",
    action: { label: "View Sessions", href: "/sessions" },
  },
];

export default function CoordinatorOnboarding() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const STORAGE_KEY = `carescribe_onboarding_${user?.id ?? "anon"}`;

  const [completed, setCompleted] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set(["org_created"]);
    } catch {
      return new Set(["org_created"]);
    }
  });

  const [orgName, setOrgName] = useState<string>("");

  useEffect(() => {
    apiFetch("/api/settings/organisation")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.name) setOrgName(d.name); })
      .catch(() => {});
  }, []);

  const toggleStep = (id: string) => {
    if (id === "org_created") return;
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const completedCount = completed.size;
  const totalCount = STEPS.length;
  const progress = Math.round((completedCount / totalCount) * 100);
  const allDone = completedCount === totalCount;

  function handleGoToDashboard() {
    if (!allDone) {
      toast({
        title: "You can always come back",
        description: "Your progress is saved. Complete the checklist whenever you're ready.",
      });
    }
    navigate("/dashboard");
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start py-12 px-4"
      style={{ background: "var(--cc-bg)" }}
    >
      {/* Header */}
      <div className="w-full max-w-2xl mb-8 text-center">
        <div className="flex justify-center mb-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
            style={{ background: PLUM }}
          >
            <Sparkles className="text-white" size={26} />
          </div>
        </div>
        <h1 className="text-xl font-black mb-2" style={{ color: PLUM }}>
          Welcome to CareCliQ{orgName ? `, ${orgName}` : ""}!
        </h1>
        <p className="text-base leading-relaxed max-w-md mx-auto" style={{ color: MUTED }}>
          Follow the steps below to get your organisation set up. You can complete these now or come back anytime.
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-2xl mb-6">
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--cc-bg)", border: `1px solid ${BORDER}`, boxShadow: "0 4px 24px -8px rgba(55,48,163,0.1)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold" style={{ color: PLUM }}>
              Setup Progress
            </span>
            <span className="text-sm font-bold" style={{ color: allDone ? "#16A34A" : MUTED }}>
              {completedCount}/{totalCount} complete
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: BORDER }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: allDone
                  ? "#16A34A"
                  : PLUM,
              }}
            />
          </div>
          {allDone && (
            <p className="text-xs font-semibold mt-2 text-center" style={{ color: "#16A34A" }}>
              All done! Your organisation is fully set up.
            </p>
          )}
        </div>
      </div>

      {/* Checklist */}
      <div className="w-full max-w-2xl space-y-3 mb-8">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const done = completed.has(step.id);
          const isAuto = step.autoComplete;

          return (
            <div
              key={step.id}
              className="rounded-2xl transition-all"
              style={{
                background: done ? (isAuto ? `${PLUM}08` : `${CORAL}06`) : "var(--cc-bg)",
                border: `1.5px solid ${done ? (isAuto ? `${PLUM}30` : `${CORAL}25`) : BORDER}`,
                boxShadow: done ? "none" : "0 2px 12px -4px rgba(55,48,163,0.06)",
              }}
            >
              <div className="flex items-start gap-4 p-5">
                {/* Step number / check */}
                <button
                  type="button"
                  onClick={() => toggleStep(step.id)}
                  disabled={isAuto}
                  className="shrink-0 mt-0.5 transition-transform active:scale-90"
                  aria-label={done ? "Mark incomplete" : "Mark complete"}
                >
                  {done ? (
                    <CheckCircle2 size={24} style={{ color: isAuto ? PLUM : CORAL }} />
                  ) : (
                    <div
                      className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-black"
                      style={{ borderColor: BORDER, color: MUTED }}
                    >
                      {idx + 1}
                    </div>
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={15} style={{ color: done ? (isAuto ? PLUM : CORAL) : MUTED }} />
                    <p
                      className="text-[14px] font-bold"
                      style={{
                        color: done ? "#111827" : "#111827",
                        textDecoration: done && !isAuto ? "line-through" : "none",
                        opacity: done && !isAuto ? 0.6 : 1,
                      }}
                    >
                      {step.title}
                    </p>
                    {isAuto && done && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
                        style={{ background: `${PLUM}15`, color: PLUM }}
                      >
                        Done
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>
                    {step.description}
                  </p>
                  {step.action && !done && (
                    <button
                      type="button"
                      onClick={() => navigate(step.action!.href)}
                      className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg transition-all hover:opacity-90 active:scale-95"
                      style={{ background: `${PLUM}10`, color: PLUM }}
                    >
                      {step.action.label}
                      <ExternalLink size={11} />
                    </button>
                  )}
                </div>

                {/* Right chevron */}
                {step.action && (
                  <button
                    type="button"
                    onClick={() => navigate(step.action!.href)}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-slate-50"
                    style={{ color: MUTED }}
                    title={`Go to ${step.action.label}`}
                  >
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="w-full max-w-2xl flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleGoToDashboard}
          className="flex-1 h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95 text-white"
          style={{ background: PLUM }}
        >
          {allDone ? "Go to Dashboard" : "Continue to Dashboard"}
          <ArrowRight size={16} />
        </button>
      </div>

      <p className="mt-6 text-xs text-center" style={{ color: MUTED }}>
        Your progress is saved automatically.{" "}
        <button
          type="button"
          className="underline underline-offset-2 font-medium"
          onClick={() => navigate("/settings")}
          style={{ color: PLUM }}
        >
          View organisation settings
        </button>
      </p>
    </div>
  );
}
