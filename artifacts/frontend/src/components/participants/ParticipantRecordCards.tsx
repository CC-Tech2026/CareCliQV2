import type { ReactNode } from "react";
import {
  AlertTriangle,
  Heart,
  HeartPulse,
  Lock,
  Megaphone,
  Pill,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { jsonFetch } from "@/services/http";

/**
 * The rest of a participant's record, for the MD's participant profile on the
 * onboarding board (onboard-participant.tsx). That page only held what was
 * captured at intake; these cards add the care team, health and medications,
 * support preferences, worker briefing, goals and funding, using the same
 * card and field design as the page's own sections so it reads as one
 * profile. Read-only: coordinators maintain these on the participant
 * record, the MD reviews them here.
 */

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const SOFT = "var(--cc-soft)";
const DANGER = "var(--cc-status-danger)";
const DANGER_BG = "var(--cc-status-danger-bg)";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";
const SUCCESS = "var(--cc-status-success)";
const SUCCESS_BG = "var(--cc-status-success-bg)";

type Contact = {
  name?: string | null;
  phone?: string | null;
  relationship?: string | null;
  practice?: string | null;
} | null;

type ShiftContext = {
  profile?: {
    emergency_contact?: Contact;
    next_of_kin?: Contact;
    case_manager?: Contact;
    care_coordinator?: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
    } | null;
    gp?: Contact;
    primary_disability?: string | null;
  };
  preferences?: {
    communication_style?: string | null;
    likes_dislikes?: string | null;
    sensory_preferences?: string | null;
    cultural_preferences?: string | null;
    behaviour_support?: string | null;
  };
  context?: {
    medical?: {
      allergies?: {
        id?: string;
        allergen?: string;
        severity?: string;
        notes?: string | null;
      }[];
      conditions?: string | null;
      alerts?: string | null;
    };
    behavioural_notes?: { title?: string; body?: string }[];
    preferred_activities?: string[];
    previous_visit_notes?: string | null;
    communication_guidance?: string | null;
    goals?: {
      id?: string;
      title?: string;
      description?: string;
      worker_focus?: string | string[];
    }[];
  };
  background_summary?: string | null;
  briefing_alerts?: string[];
};

type Medication = {
  id: string;
  name: string;
  strength?: string | null;
  dosage?: string | null;
  route?: string | null;
  frequency_type?: string | null;
  scheduled_times?: string[] | null;
  is_prn?: boolean;
  prn_max_per_day?: number | null;
  prescriber_name?: string | null;
  status: string;
};

type Budget = {
  has_plan: boolean;
  plan_number?: string;
  total_funding?: number | string | null;
  total_used?: number;
  total_remaining?: number;
  budgets?: {
    category?: string;
    category_label?: string;
    allocated?: number;
    used?: number;
    remaining?: number;
  }[];
};

type Restricted = {
  restricted_behavioural_notes?: string | null;
  behaviour_support_plan?: string | null;
  medical_alerts?: string | null;
};

const money = (value: number | string | null | undefined) =>
  value == null || value === ""
    ? null
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0,
      }).format(Number(value));

/** Same shell as onboard-participant.tsx's IntakeFormSection. */
function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Heart;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-lg border p-5"
      style={{ background: SURFACE, borderColor: BORDER }}
    >
      <div
        className="flex items-center gap-2 pb-3 mb-3 border-b"
        style={{ borderColor: BORDER }}
      >
        <Icon size={15} style={{ color: PLUM }} />
        <p
          className="text-xs font-black uppercase tracking-wide"
          style={{ color: TEXT }}
        >
          {title}
        </p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Same read-only label/value as onboard-participant.tsx's Field; hides when empty. */
function Item({
  label,
  value,
  wide = false,
}: {
  label: string;
  value?: ReactNode;
  wide?: boolean;
}) {
  if (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <p
        className="text-[10px] font-black uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        {label}
      </p>
      <div
        className="text-sm font-bold mt-0.5 whitespace-pre-line break-words"
        style={{ color: TEXT }}
      >
        {value}
      </div>
    </div>
  );
}

function contactLine(c: Contact | undefined) {
  if (!c || (!c.name && !c.phone)) return null;
  return (
    <>
      {[c.name, c.relationship, c.practice].filter(Boolean).join(" · ") ||
        c.phone}
      {c.name && c.phone && (
        <a
          href={`tel:${c.phone.replace(/\s/g, "")}`}
          className="block text-xs font-semibold mt-0.5"
          style={{ color: PLUM }}
        >
          {c.phone}
        </a>
      )}
    </>
  );
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger" | "warning";
}) {
  const style =
    tone === "danger"
      ? { background: DANGER_BG, color: DANGER }
      : tone === "warning"
        ? { background: WARNING_BG, color: WARNING }
        : { background: SOFT, color: TEXT };
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={style}
    >
      {children}
    </span>
  );
}

function useRecord<T>(key: string, participantId: string, path: string) {
  return useOrgQuery<T>(["participant", participantId, key], {
    queryFn: () =>
      jsonFetch<T>(
        `/api/participants/${encodeURIComponent(participantId)}${path}`,
      ),
  });
}

export function ParticipantRecordCards({
  participantId,
}: {
  participantId: string;
}) {
  const contextQuery = useRecord<ShiftContext>(
    "shift-context",
    participantId,
    "/shift-context",
  );
  const medsQuery = useRecord<{ medications: Medication[] }>(
    "medications",
    participantId,
    "/medications",
  );
  const budgetQuery = useRecord<Budget>(
    "budget-summary",
    participantId,
    "/budget-summary",
  );
  const restrictedQuery = useRecord<Restricted>(
    "restricted-clinical",
    participantId,
    "/restricted-clinical",
  );

  if (contextQuery.isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (contextQuery.isError) {
    return (
      <div
        role="alert"
        className="rounded-lg border p-5 text-sm"
        style={{ background: SURFACE, borderColor: BORDER, color: TEXT }}
      >
        The rest of this participant's record could not be loaded.{" "}
        <Button
          variant="link"
          className="px-1"
          onClick={() => void contextQuery.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const ctx = contextQuery.data ?? {};
  const profile = ctx.profile ?? {};
  const prefs = ctx.preferences ?? {};
  const medical = ctx.context?.medical ?? {};
  const allergies = medical.allergies ?? [];
  const behavioural = (ctx.context?.behavioural_notes ?? []).filter(
    (n) => n.body || n.title,
  );
  const activities = ctx.context?.preferred_activities ?? [];
  const goals = ctx.context?.goals ?? [];
  const meds = (medsQuery.data?.medications ?? []).filter(
    (m) => m.status !== "rejected",
  );
  const budget = budgetQuery.data;
  const restricted = restrictedQuery.data;

  return (
    <>
      <Card icon={Users} title="Care Team & Contacts">
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
          <Item
            label="Care coordinator"
            value={profile.care_coordinator?.name ?? "Not set"}
          />
          <Item label="GP" value={contactLine(profile.gp)} />
          <Item
            label="Emergency contact"
            value={contactLine(profile.emergency_contact) ?? "Not on file"}
          />
          <Item
            label="Next of kin / guardian"
            value={contactLine(profile.next_of_kin)}
          />
          <Item
            label="Plan management billing contact"
            value={contactLine(profile.case_manager)}
          />
        </div>
      </Card>

      <Card icon={HeartPulse} title="Health & Medical">
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
          <Item label="Primary disability" value={profile.primary_disability} />
          <Item label="Current conditions" value={medical.conditions} />
          <Item label="Medical alerts" value={medical.alerts} wide />
        </div>
        <Item
          label="Allergies"
          value={
            allergies.length ? (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {allergies.map((a) => (
                  <Chip
                    key={a.id ?? a.allergen}
                    tone={
                      a.severity === "severe" || a.severity === "anaphylactic"
                        ? "danger"
                        : "warning"
                    }
                  >
                    {a.allergen}
                    {a.severity ? ` · ${a.severity}` : ""}
                  </Chip>
                ))}
              </div>
            ) : (
              "No known allergies"
            )
          }
        />
      </Card>

      <Card icon={Pill} title="Medications">
        {medsQuery.isLoading ? (
          <Skeleton className="h-12 w-full rounded-lg" />
        ) : meds.length === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>
            No medications recorded.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {meds.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
                style={{ borderColor: BORDER }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: TEXT }}>
                    {m.name}
                    {m.strength ? ` · ${m.strength}` : ""}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                    {[
                      m.dosage,
                      m.route,
                      m.is_prn || m.frequency_type === "prn"
                        ? `As needed${m.prn_max_per_day ? `, up to ${m.prn_max_per_day} a day` : ""}`
                        : (m.scheduled_times ?? []).join(", "),
                      m.prescriber_name
                        ? `Prescribed by ${m.prescriber_name}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide"
                  style={
                    m.status === "active"
                      ? { background: SUCCESS_BG, color: SUCCESS }
                      : { background: WARNING_BG, color: WARNING }
                  }
                >
                  {m.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card icon={Heart} title="Support Preferences">
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
          <Item label="Communication" value={prefs.communication_style} wide />
          <Item
            label="Communication guidance"
            value={ctx.context?.communication_guidance}
            wide
          />
          <Item label="Cultural needs" value={prefs.cultural_preferences} />
          <Item label="Sensory preferences" value={prefs.sensory_preferences} />
          <Item label="Likes & dislikes" value={prefs.likes_dislikes} wide />
          <Item
            label="Preferred activities"
            value={
              activities.length ? (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {activities.map((a) => (
                    <Chip key={a}>{a}</Chip>
                  ))}
                </div>
              ) : null
            }
            wide
          />
        </div>
        {behavioural.length > 0 && (
          <Item
            label="Behavioural notes"
            value={
              <div className="space-y-2 mt-1">
                {behavioural.map((n, i) => (
                  <div
                    key={i}
                    className="rounded-lg p-3"
                    style={{ background: SOFT }}
                  >
                    {n.title && (
                      <p className="text-xs font-black" style={{ color: TEXT }}>
                        {n.title}
                      </p>
                    )}
                    {n.body && (
                      <p
                        className="text-sm font-medium mt-0.5"
                        style={{ color: TEXT }}
                      >
                        {n.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            }
          />
        )}
        <Item label="Behaviour support" value={prefs.behaviour_support} />
      </Card>

      <Card icon={Megaphone} title="Worker Briefing">
        <Item
          label="About the participant"
          value={ctx.background_summary ?? "No briefing written yet."}
        />
        {(ctx.briefing_alerts ?? []).length > 0 && (
          <Item
            label="Critical alerts"
            value={
              <ul className="space-y-1.5 mt-1">
                {(ctx.briefing_alerts ?? []).map((a) => (
                  <li
                    key={a}
                    className="flex items-start gap-2 text-sm font-semibold"
                  >
                    <AlertTriangle
                      size={14}
                      className="mt-0.5 shrink-0"
                      style={{ color: DANGER }}
                    />
                    {a}
                  </li>
                ))}
              </ul>
            }
          />
        )}
        <Item
          label="Notes from previous visits"
          value={ctx.context?.previous_visit_notes}
        />
      </Card>

      <Card icon={Target} title="NDIS Goals">
        {goals.length === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>
            No active goals.
          </p>
        ) : (
          <div className="space-y-2">
            {goals.map((g, i) => {
              const focus = Array.isArray(g.worker_focus)
                ? g.worker_focus.join(" ")
                : g.worker_focus;
              return (
                <div
                  key={g.id ?? i}
                  className="rounded-lg border p-3"
                  style={{ borderColor: BORDER }}
                >
                  <p className="text-sm font-bold" style={{ color: TEXT }}>
                    {g.title}
                  </p>
                  {focus && (
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                      Worker focus: {focus}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {budget?.has_plan && (
        <Card icon={Wallet} title="NDIS Funding">
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            <Item label="Total" value={money(budget.total_funding)} />
            <Item label="Used" value={money(budget.total_used ?? 0)} />
            <Item label="Remaining" value={money(budget.total_remaining)} />
          </div>
          {(budget.budgets ?? []).length > 0 && (
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 pt-1">
              {(budget.budgets ?? []).map((b) => (
                <Item
                  key={b.category}
                  label={b.category_label ?? b.category ?? "Budget"}
                  value={`${money(b.remaining ?? 0)} left of ${money(b.allocated ?? 0)}`}
                />
              ))}
            </div>
          )}
          {budget.plan_number && (
            <Item label="Plan number" value={budget.plan_number} />
          )}
        </Card>
      )}

      {restricted &&
        (restricted.restricted_behavioural_notes ||
          restricted.behaviour_support_plan) && (
          <Card icon={Lock} title="Restricted Clinical Records">
            <p className="text-[11px]" style={{ color: MUTED }}>
              Visible only to coordinators and the managing director. Handle in
              line with the participant's privacy consent.
            </p>
            <Item
              label="Restricted behavioural notes"
              value={restricted.restricted_behavioural_notes}
            />
            <Item
              label="Behaviour support plan"
              value={restricted.behaviour_support_plan}
            />
          </Card>
        )}
    </>
  );
}
