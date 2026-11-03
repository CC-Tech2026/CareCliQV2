import { useEffect, useRef } from "react";
import { ArrowRight, Check, ClipboardCheck, FilePlus2, Landmark, Send, type LucideIcon } from "lucide-react";

/** The NDIS revenue cycle, in the order a provider works it: approve the
 * timesheets, raise invoices from them, issue each to whoever pays, then
 * record payments and NDIA remittances. Each step's work is what's waiting
 * there now; the page opens on the first step with work and offers the next
 * one when a step empties. */
export const FLOW_STEPS = ["check", "create", "approve", "paid"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export const FLOW_STEP_COPY: Record<FlowStep, { title: string; icon: LucideIcon; done: string; emptyHint: string }> = {
  check: {
    title: "Approve timesheets",
    icon: ClipboardCheck,
    done: "All timesheets approved",
    emptyHint: "Completed shifts land here to confirm the hours and the NDIS support item.",
  },
  create: {
    title: "Raise invoices",
    icon: FilePlus2,
    done: "Nothing unbilled",
    emptyHint: "Approved timesheets are grouped here by participant and month, ready to bill.",
  },
  approve: {
    title: "Issue to payers",
    icon: Send,
    done: "Everything issued",
    emptyHint: "Invoices come here to be checked, then emailed to the plan manager or participant.",
  },
  paid: {
    title: "Payments & claims",
    icon: Landmark,
    done: "All paid up",
    emptyHint: "Issued invoices wait here for payment, and NDIA-managed supports are claimed in bulk.",
  },
};

/** The step to open on: the first with work waiting, else the last. */
export function firstStepWithWork(counts: Record<FlowStep, number | undefined>): FlowStep {
  return FLOW_STEPS.find((step) => (counts[step] ?? 0) > 0) ?? "paid";
}

export function InvoiceFlowSteps({
  value,
  counts,
  details,
  onChange,
}: {
  value: FlowStep | null;
  counts: Record<FlowStep, number | undefined>;
  /** What's waiting at each step, in a few words ("3 participants · $1,240"). */
  details: Record<FlowStep, string>;
  onChange: (step: FlowStep) => void;
}) {
  const current = useRef<HTMLLIElement | null>(null);
  // Phones scroll the steps sideways; keep the open one in view.
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <nav aria-label="Invoicing steps" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-[860px] items-stretch gap-2">
        {FLOW_STEPS.map((step, index) => {
          const on = step === value;
          const count = counts[step];
          const loading = count === undefined;
          const clear = !loading && count === 0;
          const copy = FLOW_STEP_COPY[step];
          const Icon = copy.icon;
          return (
            <li key={step} ref={on ? current : undefined} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                aria-current={on ? "step" : undefined}
                onClick={() => onChange(step)}
                className={`group flex min-h-[76px] w-full min-w-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cc-plum)] ${on ? "bg-white" : ""}`}
                style={{
                  borderColor: on ? "var(--cc-text)" : "var(--cc-border)",
                  boxShadow: on ? "inset 0 0 0 1px var(--cc-text)" : undefined,
                }}
              >
                <span
                  aria-hidden="true"
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={
                    on
                      ? { background: "var(--cc-text)", color: "var(--cc-bg)" }
                      : clear
                        ? { background: "var(--cc-soft)", color: "var(--cc-muted)" }
                        : { boxShadow: "inset 0 0 0 1px var(--cc-border)", color: "var(--cc-text)" }
                  }
                >
                  <Icon size={16} />
                  {clear && !on && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white" style={{ boxShadow: "inset 0 0 0 1px var(--cc-border)" }}>
                      <Check size={10} />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-cc-muted">
                    Step {index + 1}
                  </span>
                  <span className="block truncate text-sm font-semibold text-cc-text">{copy.title}</span>
                  <span className="block truncate text-xs text-cc-muted">
                    {loading ? "Checking…" : clear ? copy.done : details[step]}
                  </span>
                </span>
              </button>
              {index < FLOW_STEPS.length - 1 && (
                <ArrowRight aria-hidden="true" size={14} className="shrink-0 text-cc-muted" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Shown when a step has nothing left: says so and offers the next step. */
export function StepDone({
  step,
  next,
  nextCount,
  onNext,
}: {
  step: FlowStep;
  next?: FlowStep;
  nextCount?: number;
  onNext?: () => void;
}) {
  const Icon = FLOW_STEP_COPY[step].icon;
  return (
    <div className="rounded-2xl border border-cc-border bg-white px-6 py-10 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--cc-soft)" }}>
        <Icon size={17} className="text-cc-muted" />
      </span>
      <p className="mt-3 text-sm font-semibold text-cc-text">{FLOW_STEP_COPY[step].done}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-cc-muted">{FLOW_STEP_COPY[step].emptyHint}</p>
      {next && onNext && (nextCount ?? 0) > 0 && (
        <button
          type="button"
          onClick={onNext}
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full border border-cc-border px-4 text-sm font-medium text-cc-text transition hover:bg-cc-soft"
        >
          Next: {FLOW_STEP_COPY[next].title.toLowerCase()} ({nextCount})
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
