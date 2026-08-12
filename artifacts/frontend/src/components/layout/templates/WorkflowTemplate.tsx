/**
 * Archetype 4 — Workflow (focused create / edit flows)
 *
 * Used by: session-new, session-live, session-review, incident-new,
 *          participant-new/edit, onboarding pages, voice-to-note flow.
 *
 * Anatomy:
 *   - Sidebar collapses to icon rail or hides entirely (handled by AppLayout,
 *     not this template — pass `focusMode` prop to suppress chrome).
 *   - Single centred column (max 720px by default).
 *   - Optional step indicator.
 *   - Sticky footer bar: Back / Save draft / primary Continue action.
 *
 * This template does NOT manage sidebar visibility directly — it provides
 * the content column structure. The AppLayout `focusMode` prop controls chrome.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ── Step indicator ────────────────────────────────────────────────────────────

interface WorkflowStep {
  id: string;
  label: string;
}

interface WorkflowStepIndicatorProps {
  steps: WorkflowStep[];
  currentStep: string;
  className?: string;
}

export function WorkflowStepIndicator({
  steps,
  currentStep,
  className,
}: WorkflowStepIndicatorProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);
  return (
    <div className={cn("flex items-center gap-0", className)}>
      {steps.map((step, i) => {
        const done    = i < currentIndex;
        const active  = step.id === currentStep;
        return (
          <React.Fragment key={step.id}>
            {i > 0 && (
              <div
                className="flex-1 h-px mx-2"
                style={{ background: done ? "var(--cc-plum)" : "var(--cc-border)" }}
              />
            )}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black"
                style={{
                  background: active || done ? "var(--cc-plum)" : "var(--cc-soft)",
                  color: active || done ? "#fff" : "var(--cc-muted)",
                  border: active ? "2px solid var(--cc-plum)" : "none",
                }}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                className="text-[10px] font-semibold whitespace-nowrap hidden sm:block"
                style={{ color: active ? "var(--cc-plum)" : "var(--cc-muted)" }}
              >
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Sticky footer bar ─────────────────────────────────────────────────────────

interface WorkflowFooterProps {
  /** Back button (left side). */
  back?: React.ReactNode;
  /** Save draft link (centre-left, optional). */
  saveDraft?: React.ReactNode;
  /** Primary continue / submit action (right side). */
  primaryAction: React.ReactNode;
  className?: string;
}

export function WorkflowFooter({
  back,
  saveDraft,
  primaryAction,
  className,
}: WorkflowFooterProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 flex items-center justify-between gap-3 px-4 py-3 border-t",
        className,
      )}
      style={{
        background: "var(--cc-bg)",
        borderColor: "var(--cc-border)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-center gap-2">
        {back}
        {saveDraft}
      </div>
      {primaryAction}
    </div>
  );
}

// ── Main template ─────────────────────────────────────────────────────────────

interface WorkflowTemplateProps {
  /** Step indicator (use WorkflowStepIndicator). */
  stepIndicator?: React.ReactNode;
  /** Optional live compliance / feedback panel (desktop: side panel, mobile: sheet). */
  feedbackPanel?: React.ReactNode;
  children: React.ReactNode;
  /** Sticky footer (use WorkflowFooter). */
  footer?: React.ReactNode;
  /** Max content width (default 720px). */
  maxWidth?: number | string;
  className?: string;
}

export function WorkflowTemplate({
  stepIndicator,
  feedbackPanel,
  children,
  footer,
  maxWidth = 720,
  className,
}: WorkflowTemplateProps) {
  return (
    <div className={cn("min-h-screen flex flex-col", className)}>
      <div className="flex-1 flex gap-6 px-4 py-6 mx-auto w-full" style={{ maxWidth }}>
        {/* Main content column */}
        <div className="flex-1 min-w-0 space-y-6">
          {stepIndicator && <div>{stepIndicator}</div>}
          {children}
        </div>

        {/* Compliance / feedback panel — desktop only */}
        {feedbackPanel && (
          <aside
            className="hidden xl:block w-72 shrink-0 sticky top-6 self-start"
            style={{ maxHeight: "calc(100dvh - 100px)", overflowY: "auto" }}
          >
            {feedbackPanel}
          </aside>
        )}
      </div>

      {footer}
    </div>
  );
}
