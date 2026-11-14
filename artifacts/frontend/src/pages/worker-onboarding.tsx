import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { WorkerOnboardingChecklist } from "@/components/onboarding/WorkerOnboardingChecklist";
import { MyCredentialsCard } from "@/components/onboarding/MyCredentialsCard";
import { MyInterestsCard } from "@/components/onboarding/MyInterestsCard";
import { MyOnboardingProgress } from "@/components/onboarding/MyOnboardingProgress";
import { PageHeader, ctaClass, outlineClass } from "@/components/layout/PageKit";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  completeMyOnboarding,
  getMyOnboarding,
  getMyFinancialDetails,
  updateMyFinancialDetails,
  updateMyOnboarding,
  type ChecklistItem,
  type FinancialDetails,
} from "@/services/onboardingService";

// CareCliQ Purple marks the step you are on, as in the sidebar. Fixed hex
// because white text has to read on it in dark mode too.
const HERE = "#7C3AED";
const DONE = "var(--cc-status-success)";

type StepId = "about" | "pay" | "credentials" | "interests" | "training" | "finish";

type Step = {
  id: StepId;
  title: string;
  description: string;
  /** Checklist items ticked off on this step. Anything unlisted lands on "finish". */
  itemKeys: string[];
  optional?: boolean;
};

const STEPS: Step[] = [
  {
    id: "about",
    title: "About you",
    description: "Add a clear photo of your face so participants and your team know who is arriving.",
    itemKeys: ["verify_email", "complete_profile", "upload_profile_photo"],
  },
  {
    id: "pay",
    title: "Bank, super and tax",
    description: "Your provider uses these to pay you and make your super contributions.",
    itemKeys: [],
  },
  {
    id: "credentials",
    title: "Credentials",
    description: "Upload your NDIS Worker Screening Check, first aid, CPR, police check and any other documents your provider needs.",
    itemKeys: ["add_credential_wallet_items"],
  },
  {
    id: "interests",
    title: "Skills and interests",
    description: "Optional. Helps your coordinator match you with participants you are likely to get along with.",
    itemKeys: [],
    optional: true,
  },
  {
    id: "training",
    title: "Training and induction",
    description: "Finish your mandatory training and induction, learn how to write NDIS notes, and get to know your participants.",
    itemKeys: [
      "complete_mandatory_training",
      "complete_induction",
      "read_ndis_note_writing_guide",
      "acknowledge_note_writing_rules",
      "review_assigned_clients",
    ],
  },
  {
    id: "finish",
    title: "Review and finish",
    description: "Check everything is done, then confirm you are ready to start shifts.",
    itemKeys: ["confirm_readiness"],
  },
];

const MAPPED_KEYS = new Set(STEPS.filter((s) => s.id !== "finish").flatMap((s) => s.itemKeys));

function itemsForStep(step: Step, items: ChecklistItem[]): ChecklistItem[] {
  if (step.id === "finish") {
    // Readiness goes last so it sits right above the confirm button.
    const rest = items.filter((i) => !MAPPED_KEYS.has(i.key) && i.key !== "confirm_readiness");
    const ready = items.filter((i) => i.key === "confirm_readiness");
    return [...rest, ...ready];
  }
  return items.filter((i) => step.itemKeys.includes(i.key));
}

type StepState = { done: boolean; label: string };

function stepState(step: Step, items: ChecklistItem[], payFilled: boolean | null): StepState {
  if (step.optional) return { done: false, label: "Optional" };
  if (step.id === "pay") {
    if (payFilled === null) return { done: false, label: "" };
    return payFilled ? { done: true, label: "Saved" } : { done: false, label: "Not filled in" };
  }
  const stepItems = itemsForStep(step, items);
  const left = stepItems.filter((i) => !i.completed).length;
  if (stepItems.length === 0 || left === 0) return { done: true, label: "Done" };
  return { done: false, label: `${left} left` };
}

const FINANCIAL_FIELDS: { key: keyof FinancialDetails; label: string; inputMode?: "numeric" }[] = [
  { key: "bank_account_name", label: "Bank account name" },
  { key: "bank_bsb", label: "BSB", inputMode: "numeric" },
  { key: "bank_account_number", label: "Bank account number", inputMode: "numeric" },
  { key: "super_fund_name", label: "Superannuation fund" },
  { key: "super_member_number", label: "Super member number" },
  { key: "tax_file_number", label: "Tax File Number", inputMode: "numeric" },
];

function isFinancialFilled(details: FinancialDetails) {
  return FINANCIAL_FIELDS.every(({ key }) => String(details[key] ?? "").trim() !== "");
}

function FinancialDetailsForm({ onFilledChange }: { onFilledChange: (filled: boolean) => void }) {
  const { toast } = useToast();
  const [details, setDetails] = useState<FinancialDetails>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getMyFinancialDetails()
      .then((data) => {
        if (!active) return;
        setDetails(data);
        onFilledChange(isFinancialFilled(data));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onFilledChange]);

  async function save() {
    setSaving(true);
    try {
      const saved = await updateMyFinancialDetails(details);
      setDetails(saved);
      onFilledChange(isFinancialFilled(saved));
      toast({ title: "Bank, super and tax details saved" });
    } catch (error) {
      toast({
        title: "Could not save your details",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-6 text-sm text-cc-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading your details
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FINANCIAL_FIELDS.map(({ key, label, inputMode }) => (
          <div key={key}>
            <Label htmlFor={`fin-${key}`}>{label}</Label>
            <Input
              id={`fin-${key}`}
              inputMode={inputMode}
              autoComplete="off"
              value={details[key] ?? ""}
              onChange={(e) => setDetails((prev) => ({ ...prev, [key]: e.target.value }))}
              className="mt-1.5 rounded-xl"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-cc-muted">Your details are stored securely.</p>
        <Button onClick={save} disabled={saving} className="gap-2 rounded-full px-5">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save details
        </Button>
      </div>
    </div>
  );
}

function StepNav({
  current,
  states,
  onSelect,
}: {
  current: number;
  states: StepState[];
  onSelect: (index: number) => void;
}) {
  const currentRef = useRef<HTMLLIElement>(null);

  // On phones the list scrolls sideways; keep the current step in view.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  return (
    <nav aria-label="Onboarding steps" className="lg:sticky lg:top-4">
      <ol className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
        {STEPS.map((step, i) => {
          const isCurrent = i === current;
          const { done, label } = states[i];
          return (
            <li key={step.id} ref={isCurrent ? currentRef : undefined} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex min-h-11 w-[76px] flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum lg:w-full lg:flex-row lg:gap-3 lg:px-3 lg:text-left ${isCurrent ? "bg-cc-soft" : "hover:bg-cc-soft"}`}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={
                    isCurrent
                      ? { background: HERE, color: "#fff" }
                      : done
                        ? { background: DONE, color: "#fff" }
                        : { border: "1.5px solid var(--cc-border)", color: "var(--cc-muted)" }
                  }
                >
                  {done && !isCurrent ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[11px] leading-tight lg:text-sm ${isCurrent ? "font-semibold text-cc-text" : "text-cc-text"}`}>
                    {step.title}
                  </span>
                  {label && <span className="mt-0.5 hidden text-xs text-cc-muted lg:block">{label}</span>}
                  {done && <span className="sr-only">, done</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ResourceLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-cc-text">{title}</span>
        <span className="mt-0.5 block text-xs text-cc-muted">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-cc-muted" aria-hidden />
    </Link>
  );
}

export default function WorkerOnboarding() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const { translate } = useAccessibility();

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payFilled, setPayFilled] = useState<boolean | null>(null);
  const [current, setCurrent] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const movedByUser = useRef(false);
  const stepChosen = useRef(false);

  useEffect(() => {
    let active = true;
    getMyOnboarding()
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        if (stepChosen.current) return;
        stepChosen.current = true;
        // Open the step from the link (?step=credentials), else pick up where
        // the worker left off. Once onboarding is done this page is "My
        // Credentials" in the menu, so it opens there.
        const asked = new URLSearchParams(search).get("step");
        const askedIndex = STEPS.findIndex((s) => s.id === asked);
        const allDone = data.items.length > 0 && data.items.every((i) => i.completed);
        const firstOpen = STEPS.findIndex((s) => itemsForStep(s, data.items).some((i) => !i.completed));
        setCurrent(
          askedIndex >= 0
            ? askedIndex
            : allDone
              ? STEPS.findIndex((s) => s.id === "credentials")
              : Math.max(firstOpen, 0),
        );
      })
      .catch((error) => {
        toast({
          title: translate("onboarding.checklistUnavailable"),
          description: error instanceof Error ? error.message : translate("onboarding.checklistRefresh"),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // `search` is read once for the opening step; later changes come from goTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, translate]);

  const completeCount = useMemo(() => items.filter((item) => item.completed).length, [items]);
  const allComplete = items.length > 0 && completeCount === items.length;
  const states = useMemo(() => STEPS.map((s) => stepState(s, items, payFilled)), [items, payFilled]);

  function goTo(index: number) {
    if (index < 0 || index >= STEPS.length || index === current) return;
    movedByUser.current = true;
    setCurrent(index);
    navigate(`/worker-onboarding?step=${STEPS[index].id}`, { replace: true });
    // A photo upload or finished training ticks items on the server, so
    // refresh quietly between steps.
    getMyOnboarding()
      .then((data) => setItems(data.items))
      .catch(() => {});
  }

  // Each step starts at the top, with focus on its heading for screen readers.
  useEffect(() => {
    if (!movedByUser.current) return;
    headingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, [current]);

  async function toggleItem(key: string, completed: boolean) {
    const next = items.map((item) => (item.key === key ? { ...item, completed } : item));
    setItems(next);
    try {
      const saved = await updateMyOnboarding(next);
      setItems(saved.items);
    } catch (error) {
      toast({
        title: translate("onboarding.saveChecklistFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    }
  }

  async function complete() {
    setSaving(true);
    try {
      const saved = await completeMyOnboarding();
      setItems(saved.items);
      updateUser({ onboarding_completed: true, onboarding_complete: true });
      toast({ title: translate("onboarding.complete"), description: translate("onboarding.completeDesc") });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: translate("onboarding.incomplete"),
        description: error instanceof Error ? error.message : translate("onboarding.incompleteHint"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-cc-muted">
        <Loader2 className="h-7 w-7 animate-spin" />
        {translate("common.loading")}
      </div>
    );
  }

  const step = STEPS[current];
  const stepItems = itemsForStep(step, items);
  const next = STEPS[current + 1];
  const prev = STEPS[current - 1];
  const isLast = current === STEPS.length - 1;
  const alreadyComplete = Boolean(user?.onboarding_completed) && allComplete;
  const openSteps = STEPS.map((s, i) => ({ s, i, state: states[i] })).filter(
    ({ s, state }) => s.id !== "finish" && !s.optional && !state.done && state.label,
  );

  return (
    <div className="w-full space-y-5 pb-6">
      <PageHeader
        eyebrow={translate("onboarding.supportWorker")}
        title={translate("onboarding.title")}
        description={translate("onboarding.subtitleLater")}
        actions={
          <span className="inline-flex min-h-8 items-center rounded-full border border-cc-border px-3 text-xs font-medium tabular-nums text-cc-text">
            {completeCount} of {items.length} done
          </span>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
        <StepNav current={current} states={states} onSelect={goTo} />

        <section aria-labelledby="onboarding-step-title" className="min-w-0 max-w-3xl">
          <div>
            <p className="text-xs font-medium text-cc-muted">
              Step {current + 1} of {STEPS.length}
            </p>
            <h2
              id="onboarding-step-title"
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 scroll-mt-4 text-xl font-semibold tracking-tight text-cc-text outline-none"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              {step.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-cc-muted">
              {step.id === "credentials" ? translate("onboarding.addCredentialsHint") : step.description}
            </p>
          </div>

          <div className="mt-5 space-y-5">
            {step.id === "about" && (
              <div className="rounded-2xl border border-cc-border bg-cc-surface p-4 sm:p-5">
                <ProfilePhotoUpload currentUrl={user?.profile_photo_url} />
              </div>
            )}

            {step.id === "pay" && (
              <div className="rounded-2xl border border-cc-border bg-cc-surface p-4 sm:p-5">
                <FinancialDetailsForm onFilledChange={setPayFilled} />
              </div>
            )}

            {step.id === "credentials" && <MyCredentialsCard />}

            {step.id === "interests" && <MyInterestsCard />}

            {step.id === "training" && (
              <div className="divide-y divide-cc-border overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
                <ResourceLink href="/worker/training" title="Mandatory training" hint="Courses your provider needs you to finish" />
                <ResourceLink href="/worker-induction" title="Induction" hint="Policies and first-day guidance" />
                <ResourceLink
                  href="/my-clients"
                  title={translate("onboarding.reviewClients")}
                  hint={translate("onboarding.reviewClientsHint")}
                />
              </div>
            )}

            {step.id === "finish" && (
              <>
                {openSteps.length > 0 ? (
                  <div className="divide-y divide-cc-border overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
                    {openSteps.map(({ s, i, state }) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => goTo(i)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-cc-border text-xs font-semibold text-cc-muted">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-cc-text">{s.title}</span>
                          <span className="block text-xs text-cc-muted">{state.label}</span>
                        </span>
                        <span className="text-sm font-medium text-cc-plum">Go to step</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-cc-text">
                    All the earlier steps are done.
                  </p>
                )}

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-cc-text">Where you are with your provider</h3>
                  <MyOnboardingProgress />
                </div>
              </>
            )}

            {stepItems.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-cc-text">
                  {isLast ? "Before you finish" : "Tick these off when they are done"}
                </h3>
                <WorkerOnboardingChecklist items={stepItems} onToggle={toggleItem} />
              </div>
            )}
          </div>

          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 mt-6 flex items-center justify-between gap-3 rounded-2xl border border-cc-border bg-cc-surface px-3 py-2.5 shadow-[var(--cc-shadow-md)] sm:px-4 md:bottom-4">
            {prev ? (
              <button type="button" onClick={() => goTo(current - 1)} className={outlineClass}>
                Back
              </button>
            ) : (
              <span />
            )}

            {!isLast && next && (
              <button type="button" onClick={() => goTo(current + 1)} className={ctaClass}>
                <span>
                  Next<span className="hidden sm:inline">: {next.title}</span>
                </span>
              </button>
            )}

            {isLast && !alreadyComplete && (
              <div className="flex min-w-0 items-center gap-3">
                {!allComplete && (
                  <p className="hidden text-xs text-cc-muted sm:block">
                    {items.length - completeCount} {items.length - completeCount === 1 ? "item" : "items"} left
                  </p>
                )}
                <button type="button" onClick={complete} disabled={!allComplete || saving} className={ctaClass}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {translate("onboarding.confirmReadiness")}
                </button>
              </div>
            )}

            {isLast && alreadyComplete && (
              <p className="text-sm font-medium text-cc-text">
                {translate("onboarding.complete")}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
