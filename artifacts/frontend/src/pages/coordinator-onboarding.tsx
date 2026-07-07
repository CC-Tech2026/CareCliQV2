import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { apiFetch } from "@/lib/api-fetch";
import { ccqOnboardingKey } from "@/lib/storage-keys";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, ArrowRight, Users, UserPlus,
  ClipboardList, Link2, FileText, Building2, ChevronRight,
  Sparkles, ExternalLink,
} from "lucide-react";

const PLUM  = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

interface ChecklistStep {
  id: string;
  icon: React.ElementType;
  actionHref?: string;
  autoComplete?: boolean;
}

const STEP_DEFS: ChecklistStep[] = [
  {
    id: "org_created",
    icon: Building2,
    autoComplete: true,
  },
  {
    id: "invite_workers",
    icon: UserPlus,
    actionHref: "/settings",
  },
  {
    id: "add_participants",
    icon: Users,
    actionHref: "/patients",
  },
  {
    id: "assign_participants",
    icon: Link2,
    actionHref: "/patients",
  },
  {
    id: "create_session",
    icon: ClipboardList,
    actionHref: "/sessions/new",
  },
  {
    id: "begin_documentation",
    icon: FileText,
    actionHref: "/sessions",
  },
];

export default function CoordinatorOnboarding() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();

  const STORAGE_KEY = ccqOnboardingKey(user?.id ?? "anon");

  const [completed, setCompleted] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set(["org_created"]);
    } catch {
      return new Set(["org_created"]);
    }
  });

  const [orgName, setOrgName] = useState<string>("");

  const steps = useMemo(
    () =>
      STEP_DEFS.map((step) => ({
        ...step,
        title: translate(`coordinator.onboarding.step.${step.id}.title`),
        description: translate(`coordinator.onboarding.step.${step.id}.description`),
        actionLabel: step.actionHref
          ? translate(`coordinator.onboarding.step.${step.id}.action`)
          : undefined,
      })),
    [translate],
  );

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
  const totalCount = steps.length;
  const progress = Math.round((completedCount / totalCount) * 100);
  const allDone = completedCount === totalCount;

  function handleGoToDashboard() {
    if (!allDone) {
      toast({
        title: translate("coordinator.onboarding.toast.comeBackTitle"),
        description: translate("coordinator.onboarding.toast.comeBackDesc"),
      });
    }
    navigate("/dashboard");
  }

  const welcomeTitle = orgName
    ? translateParams("coordinator.onboarding.welcomeWithOrg", { orgName })
    : translate("coordinator.onboarding.welcome");

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
            style={{ background: "var(--cc-text)" }}
          >
            <Sparkles className="text-white" size={26} />
          </div>
        </div>
        <h1 className="text-xl font-black mb-2" style={{ color: "var(--cc-text)" }}>
          {welcomeTitle}
        </h1>
        <p className="text-base leading-relaxed max-w-md mx-auto" style={{ color: MUTED }}>
          {translate("coordinator.onboarding.subtitle")}
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
              {translate("coordinator.onboarding.setupProgress")}
            </span>
            <span className="text-sm font-bold" style={{ color: allDone ? "#16A34A" : MUTED }}>
              {translateParams("coordinator.onboarding.progressCount", {
                completed: String(completedCount),
                total: String(totalCount),
              })}
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
              {translate("coordinator.onboarding.allDone")}
            </p>
          )}
        </div>
      </div>

      {/* Checklist */}
      <div className="w-full max-w-2xl space-y-3 mb-8">
        {steps.map((step, idx) => {
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
                  aria-label={done ? translate("coordinator.onboarding.markIncomplete") : translate("coordinator.onboarding.markComplete")}
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
                        color: done ? "#1A1A2E" : "#1A1A2E",
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
                        {translate("coordinator.onboarding.done")}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>
                    {step.description}
                  </p>
                  {step.actionHref && step.actionLabel && !done && (
                    <button
                      type="button"
                      onClick={() => navigate(step.actionHref!)}
                      className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg transition-all hover:opacity-90 active:scale-95"
                      style={{ background: `${PLUM}10`, color: PLUM }}
                    >
                      {step.actionLabel}
                      <ExternalLink size={11} />
                    </button>
                  )}
                </div>

                {/* Right chevron */}
                {step.actionHref && step.actionLabel && (
                  <button
                    type="button"
                    onClick={() => navigate(step.actionHref!)}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-slate-50"
                    style={{ color: MUTED }}
                    title={translateParams("coordinator.onboarding.goToAction", { label: step.actionLabel })}
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
          style={{ background: "var(--cc-cta)" }}
        >
          {allDone ? translate("coordinator.onboarding.goToDashboard") : translate("coordinator.onboarding.continueToDashboard")}
          <ArrowRight size={16} />
        </button>
      </div>

      <p className="mt-6 text-xs text-center" style={{ color: MUTED }}>
        {translate("coordinator.onboarding.progressSaved")}{" "}
        <button
          type="button"
          className="underline underline-offset-2 font-medium"
          onClick={() => navigate("/settings")}
          style={{ color: PLUM }}
        >
          {translate("coordinator.onboarding.viewSettings")}
        </button>
      </p>
    </div>
  );
}
