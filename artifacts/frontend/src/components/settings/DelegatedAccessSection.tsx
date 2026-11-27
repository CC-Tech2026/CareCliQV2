import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { PersonPhoto } from "@/components/ui/person-photo";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  CAPABILITY_GROUPS,
  CAPABILITY_INFO,
  capabilityName,
  formatWhen,
  timeLeft,
  type CapabilityGroup,
} from "@/lib/access-capabilities";
import {
  createAccessGrant,
  getGrantableCapabilities,
  listAccessGrants,
  revokeAccessGrant,
  type AccessGrant,
} from "@/services/accessGrantService";
import { getCoordinatorWorkerStats } from "@/services/coordinatorService";

type Coordinator = { id: string; full_name: string; profile_photo_url?: string | null };
type Capability = { capability: string; label: string };

const MAX_DAYS = 90; // access_grant_service.MAX_GRANT_DURATION_DAYS
const HOUR = 3_600_000;

const DURATIONS = [
  { id: "1d", label: "1 day", hours: 24 },
  { id: "3d", label: "3 days", hours: 24 * 3 },
  { id: "1w", label: "1 week", hours: 24 * 7 },
  { id: "2w", label: "2 weeks", hours: 24 * 14 },
  { id: "30d", label: "30 days", hours: 24 * 30 },
] as const;

type DurationId = (typeof DURATIONS)[number]["id"] | "custom";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const choiceClass = (selected: boolean, disabled = false) =>
  cn(
    "flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors",
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-cc-soft",
    selected && "bg-[var(--cc-plum-soft)]",
  );

const pillClass = (selected: boolean) =>
  cn(
    "inline-flex min-h-10 md:min-h-8 items-center rounded-full border px-3.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum",
    selected ? "border-cc-plum bg-[var(--cc-plum-soft)] font-semibold text-cc-text" : "border-cc-border text-cc-text hover:bg-cc-soft",
  );

type StepId = "who" | "what" | "when" | "check";
const STEP_TITLES: Record<StepId, string> = {
  who: "Who",
  what: "What they can do",
  when: "For how long",
  check: "Check and confirm",
};

/**
 * Giving (or extending) temporary access, one question at a time, in the page
 * itself rather than a panel over it. Extending skips straight to the end date.
 */
function GrantFlow({
  extending,
  capabilities,
  coordinators,
  activeGrants,
  onClose,
  onSaved,
}: {
  extending: AccessGrant | null;
  capabilities: Capability[];
  coordinators: Coordinator[];
  activeGrants: AccessGrant[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const steps: StepId[] = extending ? ["when", "check"] : ["who", "what", "when", "check"];
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [coordinatorId, setCoordinatorId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [duration, setDuration] = useState<DurationId>("1w");
  const [customEnd, setCustomEnd] = useState(() => toLocalInputValue(new Date(Date.now() + 7 * 24 * HOUR)));
  const [reason, setReason] = useState("");

  const personId = extending?.granted_to_user_id ?? coordinatorId;
  const person = coordinators.find((c) => c.id === personId);
  const personName = person?.full_name ?? "Former team member";
  const chosen = extending ? [extending.capability] : picked;

  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);

  const endsAt = useMemo(() => {
    if (duration === "custom") return new Date(customEnd);
    return new Date(Date.now() + DURATIONS.find((d) => d.id === duration)!.hours * HOUR);
  }, [duration, customEnd]);

  const endError = Number.isNaN(endsAt.getTime())
    ? "Choose when access ends."
    : endsAt.getTime() <= Date.now()
      ? "The end has to be in the future."
      : endsAt.getTime() > Date.now() + MAX_DAYS * 24 * HOUR
        ? `Access can last up to ${MAX_DAYS} days. Extend it later if you need longer.`
        : "";

  const activeCount = (id: string) => activeGrants.filter((g) => g.granted_to_user_id === id).length;
  const alreadyHas = useMemo(() => {
    const map = new Map<string, AccessGrant>();
    for (const g of activeGrants) if (g.granted_to_user_id === personId) map.set(g.capability, g);
    return map;
  }, [activeGrants, personId]);

  const grouped = useMemo(() => {
    const groups = new Map<CapabilityGroup | "Other", Capability[]>();
    for (const c of capabilities) {
      const group = CAPABILITY_INFO[c.capability]?.group ?? "Other";
      groups.set(group, [...(groups.get(group) ?? []), c]);
    }
    return [...CAPABILITY_GROUPS, "Other" as const]
      .filter((g) => groups.has(g))
      .map((g) => ({ group: g, items: groups.get(g)! }));
  }, [capabilities]);

  const backendLabel = (capability: string) => capabilities.find((c) => c.capability === capability)?.label;

  const stepReady: Record<StepId, boolean> = {
    who: Boolean(coordinatorId),
    what: picked.length > 0,
    when: !endError,
    check: true,
  };

  const save = useMutation({
    mutationFn: async () => {
      const expires_at = endsAt.toISOString();
      const note = reason.trim() || undefined;
      const failed: { capability: string; message: string }[] = [];
      // One grant per capability: that's how the backend checks and audits them.
      for (const capability of chosen) {
        try {
          await createAccessGrant({ granted_to_user_id: personId, capability, expires_at, reason: note });
        } catch (err) {
          failed.push({ capability, message: err instanceof Error ? err.message : "Try again." });
        }
      }
      // Extending replaces the grant: only end the old one once the new one exists.
      let oldStillOpen = false;
      if (extending && failed.length === 0) {
        try {
          await revokeAccessGrant(extending.id);
        } catch {
          oldStillOpen = true;
        }
      }
      return { failed, oldStillOpen };
    },
    onSuccess: ({ failed, oldStillOpen }) => {
      onSaved();
      if (failed.length === 0) {
        toast({
          title: extending ? "Access extended" : "Access given",
          description: oldStillOpen
            ? "The earlier grant is still listed. End it if you no longer need it."
            : `${personName} has it until ${formatWhen(endsAt.toISOString())}.`,
        });
        onClose();
        return;
      }
      const given = chosen.length - failed.length;
      toast({
        title: given > 0 ? `Gave ${given} of ${chosen.length}` : "Could not give access",
        description: failed.map((f) => `${capabilityName(f.capability, backendLabel(f.capability))}: ${f.message}`).join(" "),
        variant: "destructive",
      });
      if (!extending) setPicked(failed.map((f) => f.capability));
    },
  });

  const isLast = stepIndex === steps.length - 1;

  return (
    <section className="min-w-0 max-w-3xl space-y-5" aria-labelledby="grant-step-title">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-10 md:min-h-8 items-center gap-1 rounded-full pr-3 text-sm font-medium text-cc-plum hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Back to Delegated Access
      </button>

      <div>
        <p className="text-sm font-medium text-cc-muted">
          {extending ? `Extend access for ${personName}` : "Give temporary access"} · Step {stepIndex + 1} of {steps.length}
        </p>
        <ol className="mt-2 flex gap-1.5" aria-label="Steps">
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={i === stepIndex ? "step" : undefined}
              className="h-1.5 flex-1 rounded-full"
              style={{ background: i < stepIndex ? "var(--cc-text)" : i === stepIndex ? "#7C3AED" : "var(--cc-border)" }}
            >
              <span className="sr-only">{STEP_TITLES[s]}</span>
            </li>
          ))}
        </ol>
        <h2
          id="grant-step-title"
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 text-2xl font-semibold tracking-tight text-cc-text outline-none"
        >
          {step === "who" && "Who needs access?"}
          {step === "what" && `What can ${personName.split(" ")[0]} do?`}
          {step === "when" && (extending ? "When should it end now?" : "For how long?")}
          {step === "check" && "Check and confirm"}
        </h2>
        <p className="mt-1 text-sm leading-6 text-cc-muted">
          {step === "who" && "Only coordinators can be given temporary access. Nothing about their role changes."}
          {step === "what" && "Tick everything they need while you're away. You can end any of it early."}
          {step === "when" && "It switches off on its own at this time. You can extend it or end it early."}
          {step === "check" && "Nothing is given until you confirm."}
        </p>
      </div>

      {step === "who" &&
        (coordinators.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-cc-border px-5 py-6 text-sm text-cc-muted">
            There are no coordinators in your organisation yet. Invite one from Team first.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Coordinator" className="divide-y divide-cc-border overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
            {coordinators.map((c) => {
              const selected = coordinatorId === c.id;
              const count = activeCount(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    if (c.id !== coordinatorId) setPicked([]);
                    setCoordinatorId(c.id);
                  }}
                  className={cn(choiceClass(selected), "items-center focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum")}
                >
                  <PersonPhoto name={c.full_name} photoUrl={c.profile_photo_url} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-cc-text">{c.full_name}</span>
                    <span className="block text-xs text-cc-muted">
                      {count === 0 ? "No temporary access" : `Already has ${count} ${count === 1 ? "thing" : "things"}`}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                    style={{ borderColor: selected ? "var(--cc-plum)" : "var(--cc-border)" }}
                  >
                    {selected && <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--cc-plum)" }} />}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

      {step === "what" && (
        <div className="space-y-5">
          {grouped.map(({ group, items }) => (
            <fieldset key={group}>
              <legend className="mb-1.5 text-sm font-semibold text-cc-text">{group}</legend>
              <div className="divide-y divide-cc-border overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
                {items.map((c) => {
                  const info = CAPABILITY_INFO[c.capability];
                  const existing = alreadyHas.get(c.capability);
                  const checked = picked.includes(c.capability);
                  return (
                    <label key={c.capability} className={choiceClass(checked, Boolean(existing))}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--cc-plum)]"
                        disabled={Boolean(existing)}
                        checked={checked}
                        onChange={(e) =>
                          setPicked((prev) =>
                            e.target.checked ? [...prev, c.capability] : prev.filter((x) => x !== c.capability),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-cc-text">{info?.name ?? c.label}</span>
                        {info && (
                          <span className={cn("mt-0.5 block text-xs leading-5", info.highImpact ? "text-[var(--cc-danger-text)]" : "text-cc-muted")}>
                            {info.does}
                          </span>
                        )}
                        {existing && (
                          <span className="mt-0.5 block text-xs text-cc-muted">
                            Already has this until {formatWhen(existing.expires_at)}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {step === "when" && (
        <div className="space-y-5">
          {extending && (
            <p className="text-sm text-cc-text">
              {capabilityName(extending.capability, backendLabel(extending.capability))} currently ends{" "}
              {formatWhen(extending.expires_at)}.
            </p>
          )}
          <div>
            <div role="radiogroup" aria-label="For how long" className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={duration === d.id}
                  onClick={() => setDuration(d.id)}
                  className={pillClass(duration === d.id)}
                >
                  {d.label}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={duration === "custom"}
                onClick={() => setDuration("custom")}
                className={pillClass(duration === "custom")}
              >
                Pick a date
              </button>
            </div>
            {duration === "custom" && <DateTimePicker value={customEnd} onChange={setCustomEnd} className="mt-3 max-w-sm" />}
            <p
              className={cn("mt-3 text-sm", endError ? "text-[var(--cc-danger-text)]" : "text-cc-text")}
              role={endError ? "alert" : undefined}
            >
              {endError || `Ends ${formatWhen(endsAt.toISOString())} (${timeLeft(endsAt.toISOString())}).`}
            </p>
          </div>
          {!extending && (
            <div>
              <label htmlFor="grant-reason" className="text-sm font-semibold text-cc-text">Reason (optional)</label>
              <Textarea
                id="grant-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1.5"
                rows={3}
                placeholder="For example: covering hiring and invoicing while I'm on leave"
              />
              <p className="mt-1 text-xs text-cc-muted">Saved in the audit log with the access.</p>
            </div>
          )}
        </div>
      )}

      {step === "check" && (
        <div className="rounded-2xl border border-cc-border bg-cc-surface">
          <div className="flex items-center gap-3 border-b border-cc-border px-5 py-4">
            <PersonPhoto name={personName} photoUrl={person?.profile_photo_url} size={40} />
            <div className="min-w-0">
              <p className="font-semibold text-cc-text">{personName}</p>
              <p className="text-sm text-cc-muted">
                Until {formatWhen(endsAt.toISOString())} ({timeLeft(endsAt.toISOString())})
              </p>
            </div>
          </div>
          <ul className="divide-y divide-cc-border">
            {chosen.map((capability) => {
              const info = CAPABILITY_INFO[capability];
              return (
                <li key={capability} className="px-5 py-3">
                  <p className="text-sm font-medium text-cc-text">{capabilityName(capability, backendLabel(capability))}</p>
                  {info && <p className="mt-0.5 text-xs text-cc-muted">{info.does}</p>}
                </li>
              );
            })}
          </ul>
          <div className="space-y-1 border-t border-cc-border px-5 py-4 text-sm text-cc-muted">
            {reason.trim() && <p>Reason: {reason.trim()}</p>}
            <p>
              {extending
                ? "The current access is replaced by this one."
                : `${personName.split(" ")[0]} will see this in their menu and in Settings.`}{" "}
              You can end it at any time.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-cc-border pt-4">
        {stepIndex > 0 ? (
          <button type="button" className={outlineClass} onClick={() => setStepIndex((i) => i - 1)}>Back</button>
        ) : (
          <button type="button" className={ghostClass} onClick={onClose}>Cancel</button>
        )}
        {isLast ? (
          <button type="button" className={ctaClass} onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending
              ? "Saving..."
              : extending
                ? "Extend access"
                : chosen.length > 1
                  ? `Give access to ${chosen.length} things`
                  : "Give access"}
          </button>
        ) : (
          <button
            type="button"
            className={ctaClass}
            onClick={() => setStepIndex((i) => i + 1)}
            disabled={!stepReady[step]}
          >
            Next: {STEP_TITLES[steps[stepIndex + 1]]}
          </button>
        )}
      </div>
    </section>
  );
}

function ActiveGrantRow({
  grant,
  label,
  onExtend,
  onEnd,
  ending,
}: {
  grant: AccessGrant;
  label: string;
  onExtend: () => void;
  onEnd: () => void;
  ending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-cc-text">{label}</p>
        <p className="mt-0.5 text-xs text-cc-muted">
          Ends {formatWhen(grant.expires_at)} · {timeLeft(grant.expires_at)}
        </p>
        {grant.reason && <p className="mt-0.5 text-xs text-cc-muted">{grant.reason}</p>}
      </div>
      {confirming ? (
        <div className="flex items-center gap-2" role="group" aria-label={`End ${label} now?`}>
          <span className="text-sm text-cc-text">End now?</span>
          <button type="button" className={cn(ghostClass, "min-h-10")} onClick={() => setConfirming(false)}>Keep</button>
          <button
            type="button"
            disabled={ending}
            onClick={onEnd}
            className="inline-flex min-h-10 md:min-h-8 items-center rounded-full bg-[var(--cc-danger-text)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
          >
            {ending ? "Ending..." : "End access"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" className={outlineClass} onClick={onExtend}>Extend</button>
          <button type="button" className={cn(ghostClass, "min-h-10")} onClick={() => setConfirming(true)}>End now</button>
        </div>
      )}
    </li>
  );
}

export function DelegatedAccessSection() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  // null = the list; otherwise the give/extend flow replaces it in the page.
  const [flow, setFlow] = useState<{ extending: AccessGrant | null } | null>(null);
  const [showPast, setShowPast] = useState(false);

  // useOrgQuery auto-prepends organizationId to the query key
  // ([orgId, "access-grants", "org"]); invalidation has to target that same
  // prefix, or it silently matches nothing and the list never refreshes.
  const orgId = user?.organizationId ?? "__no_org__";
  const invalidateGrants = () => qc.invalidateQueries({ queryKey: [orgId, "access-grants", "org"] });

  const grantsQuery = useOrgQuery(["access-grants", "org"], { queryFn: listAccessGrants });
  const capabilitiesQuery = useQuery({
    queryKey: ["access-grants", "capabilities"],
    queryFn: getGrantableCapabilities,
    staleTime: Infinity,
  });
  const coordinatorsQuery = useOrgQuery(["access-grants", "coordinators"], {
    queryFn: () => getCoordinatorWorkerStats().then((list) => list.filter((w) => w.role === "support_coordinator")),
  });

  const endMutation = useMutation({
    mutationFn: (grantId: string) => revokeAccessGrant(grantId),
    onSuccess: () => {
      toast({ title: "Access ended" });
      void invalidateGrants();
    },
    onError: (err) => {
      toast({
        title: "Could not end this access",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const grants = grantsQuery.data ?? [];
  const capabilities = capabilitiesQuery.data ?? [];
  const coordinators: Coordinator[] = coordinatorsQuery.data ?? [];

  const backendLabel = useMemo(() => new Map(capabilities.map((c) => [c.capability, c.label])), [capabilities]);
  const personById = useMemo(() => new Map(coordinators.map((c) => [c.id, c])), [coordinators]);

  const active = grants
    .filter((g) => g.status === "active")
    .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime());
  const past = grants
    .filter((g) => g.status !== "active")
    .sort((a, b) =>
      new Date(b.revoked_at ?? b.expires_at).getTime() - new Date(a.revoked_at ?? a.expires_at).getTime(),
    );

  // Active access grouped by person, soonest-ending person first.
  const byPerson = useMemo(() => {
    const map = new Map<string, AccessGrant[]>();
    for (const g of active) map.set(g.granted_to_user_id, [...(map.get(g.granted_to_user_id) ?? []), g]);
    return [...map.entries()];
  }, [active]);

  if (flow) {
    return (
      <GrantFlow
        extending={flow.extending}
        capabilities={capabilities}
        coordinators={coordinators}
        activeGrants={active}
        onClose={() => setFlow(null)}
        onSaved={() => void invalidateGrants()}
      />
    );
  }

  return (
    <section className="min-w-0 space-y-6" aria-labelledby="delegated-access-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="delegated-access-heading" className="text-2xl font-semibold tracking-tight text-cc-text">
            Delegated Access
          </h2>
          <p className="mt-1 text-sm leading-6 text-cc-muted">
            Let a coordinator do things only a director can, such as finances, hiring or the audit vault, for a set
            time. It switches off on its own when the time is up, or straight away if you end it. Every change is kept
            in the audit log.
          </p>
        </div>
        <button type="button" onClick={() => setFlow({ extending: null })} className={ctaClass}>
          Give temporary access
        </button>
      </header>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-cc-text">Active now</h3>
        {grantsQuery.isLoading ? (
          <div role="status" aria-label="Loading" className="h-24 animate-pulse rounded-2xl bg-cc-soft" />
        ) : byPerson.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-cc-border px-5 py-6">
            <p className="text-sm font-medium text-cc-text">No one has temporary access</p>
            <p className="mt-1 text-sm text-cc-muted">
              Use this when you're away or need a hand, for example to let a coordinator handle finances and wages or
              invite new staff.
            </p>
          </div>
        ) : (
          byPerson.map(([personId, list]) => {
            const person = personById.get(personId);
            const name = person?.full_name ?? "Former team member";
            return (
              <div key={personId} className="overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
                <div className="flex items-center gap-3 border-b border-cc-border px-4 py-3 sm:px-5">
                  <PersonPhoto name={name} photoUrl={person?.profile_photo_url} size={36} />
                  <div className="min-w-0">
                    <p className="font-semibold text-cc-text">{name}</p>
                    <p className="text-xs text-cc-muted">
                      {list.length} {list.length === 1 ? "thing" : "things"} they can do
                    </p>
                  </div>
                </div>
                <ul className="divide-y divide-cc-border">
                  {list.map((g) => (
                    <ActiveGrantRow
                      key={g.id}
                      grant={g}
                      label={capabilityName(g.capability, backendLabel.get(g.capability))}
                      onExtend={() => setFlow({ extending: g })}
                      onEnd={() => endMutation.mutate(g.id)}
                      ending={endMutation.isPending && endMutation.variables === g.id}
                    />
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>

      {past.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            className="text-sm font-medium text-cc-plum hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
          >
            {showPast ? "Hide past access" : `Show past access (${past.length})`}
          </button>
          {showPast && (
            <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
              {past.map((g) => (
                <li key={g.id} className="px-4 py-3 sm:px-5">
                  <p className="text-sm text-cc-text">
                    <span className="font-medium">{personById.get(g.granted_to_user_id)?.full_name ?? "Former team member"}</span>
                    {" · "}
                    {capabilityName(g.capability, backendLabel.get(g.capability))}
                  </p>
                  <p className="mt-0.5 text-xs text-cc-muted">
                    {g.status === "revoked" ? `Ended early ${formatWhen(g.revoked_at)}` : `Ran out ${formatWhen(g.expires_at)}`}
                    {" · "}given {formatWhen(g.granted_at)}
                    {g.reason ? ` · ${g.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
