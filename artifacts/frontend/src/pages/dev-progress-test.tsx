/**
 * Private dev / QA console — not linked in nav.
 * Route: /dev/progress-test (bookmark + password only)
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ShiftTaskChecklist } from "@/components/shifts/ShiftTaskChecklist";
import type { ShiftTask } from "@/services/shiftService";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  FlaskConical,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Lock,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const APP_BG = "#F8F8FE";
const ACTIVE = "var(--cc-active-bg)";
const BORDER = "var(--cc-border)";
const TICKETS_PER_PAGE = 5;

const DEV_CONSOLE_PASSWORD = (
  import.meta.env.VITE_DEV_CONSOLE_PASSWORD as string | undefined
)?.trim() ?? "";

const UNLOCK_STORAGE_KEY = "ccq_dev_progress_console_unlocked";

const DEMO_JAMES_PARTICIPANT = "0ac8f871-6ca6-4a73-a300-eac933d07232";
const DEMO_JAMES_DRAFT_SESSION = "a1000001-0000-4000-8000-000000000099";
const DEMO_JAMES_SHIFT = "b2000002-0000-4000-8000-000000000088";

type TicketId =
  | "CARECLIQV2-72"
  | "CARECLIQV2-74"
  | "CARECLIQV2-79"
  | "CARECLIQV2-78"
  | "CARECLIQV2-76"
  | "CARECLIQV2-33"
  | "CARECLIQV2-36"
  | "CARECLIQV2-87"
  | "CARECLIQV2-35"
  | "CARECLIQV2-34"
  | "CARECLIQV2-90"
  | "CARECLIQV2-75"
  | "CARECLIQV2-217";

type TicketDef = {
  id: TicketId;
  title: string;
  description: string;
  keywords: string;
};

const TICKETS: TicketDef[] = [
  {
    id: "CARECLIQV2-72",
    title: "progress_delta JSONB column",
    description: "Add progress_delta JSONB array on sessions table and wire through save APIs.",
    keywords: "migration 028 schema jsonb column database",
  },
  {
    id: "CARECLIQV2-74",
    title: "GPT progress signal extraction",
    description: "On save-with-ai, extract per-goal prompt_level, independence_rating, skill_step, delta_summary.",
    keywords: "gpt save-with-ai extraction goals",
  },
  {
    id: "CARECLIQV2-79",
    title: "Prior session trajectory in GPT",
    description: "Inject last 5 completed sessions' progress_delta into GPT context on save/preview.",
    keywords: "trajectory prior history context sessions",
  },
  {
    id: "CARECLIQV2-78",
    title: "delta_summary in approval modal",
    description: "Show Progress Summary box in worker Review & Approve modal via preview-progress.",
    keywords: "approval modal ui live session worker",
  },
  {
    id: "CARECLIQV2-76",
    title: "Participant progress API",
    description: "GET /api/participants/:id/progress — coordinator aggregation with trends.",
    keywords: "api coordinator trends goals progress",
  },
  {
    id: "CARECLIQV2-33",
    title: "RAG note improvement",
    description: "improve-note uses high-scoring past notes for the participant when participant_id is sent.",
    keywords: "rag improve note ai documentation",
  },
  {
    id: "CARECLIQV2-36",
    title: "NDIS plan budget alignment rules",
    description:
      "On compliance scoring, add budget_exceeded / budget_warning to rules_result from ndis_plan per-category budgets; surface advisories on compliance overview.",
    keywords: "budget ndis plan exceeded warning compliance rules_result coordinator",
  },
  {
    id: "CARECLIQV2-87",
    title: "Shifts table (MyShift schema)",
    description:
      "Create shifts table with scheduling, clock-in/out, participant snapshot, care instructions, status enum; add sessions.shift_id FK.",
    keywords: "shifts migration 029 myshift schema shift_id table",
  },
  {
    id: "CARECLIQV2-35",
    title: "Duration consistency compliance rule",
    description:
      "When session.shift_id is set, compare session.duration_minutes vs shift.duration_minutes; warning >30 min, fail >60 min (-10 score).",
    keywords: "duration consistency shift compliance rules_result warning error",
  },
  {
    id: "CARECLIQV2-34",
    title: "Cross-session AI detected patterns",
    description:
      "Weekly org pattern job: low compliance pairs, incident escalation, refused activity without de-escalation; coordinator Compliance Centre UI.",
    keywords: "pattern detection ai coordinator compliance dashboard weekly dismiss",
  },
  {
    id: "CARECLIQV2-90",
    title: "Shift briefing GET + clock-in API",
    description:
      "GET /api/worker/shifts/:id hydrates safety, active goals, coordinator notes. Clock-in returns 403/409/422.",
    keywords: "shift briefing clock-in active goals health alerts",
  },
  {
    id: "CARECLIQV2-75",
    title: "Progress Evidence 5th criterion",
    description:
      "POST /api/ai/assess-note adds 20pt Progress Evidence from progress_delta; score capped at 80% without it.",
    keywords: "assess-note compliance progress_delta billing 80 cap",
  },
  {
    id: "CARECLIQV2-217",
    title: "Mandatory vs optional task visuals",
    description:
      "Task states: not started → in progress → evidence required → complete (gray/amber/orange/green).",
    keywords: "task checklist mandatory optional evidence visual",
  },
];

const DEMO_TASKS: ShiftTask[] = [
  {
    task_id: "demo_mandatory_hygiene",
    type: "default",
    label: "Personal Hygiene",
    description: "Showering, grooming",
    completed: false,
    order: 1,
    mandatory: true,
    goal_title: "Develop Daily Living Skills",
  },
  {
    task_id: "demo_optional_community",
    type: "default",
    label: "Community Access",
    description: "Outing or social activity",
    completed: true,
    completed_at: new Date().toISOString(),
    order: 2,
    mandatory: false,
    goal_title: "Community Participation",
    note: "Visited local café — participant ordered independently.",
    has_photo: true,
    photo_evidence: "demo-photo",
  },
];

function TaskVisualDemo() {
  const [tasks, setTasks] = useState(DEMO_TASKS);
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
      <ShiftTaskChecklist
        shiftId="demo-shift"
        sessionId="demo-session"
        participantName="Demo Participant"
        tasks={tasks}
        onTasksChange={setTasks}
      />
    </div>
  );
}

type ApiResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
};

type TestContext = {
  user: ReturnType<typeof useAuth>["user"];
  participants: Array<{ id: string; full_name?: string }>;
  loadingParticipants: boolean;
  participantId: string;
  setParticipantId: (v: string) => void;
  sessionId: string;
  setSessionId: (v: string) => void;
  noteText: string;
  setNoteText: (v: string) => void;
  busy: string | null;
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  migrationResult: ApiResult | null;
  setMigrationResult: (r: ApiResult | null) => void;
  progressResult: ApiResult | null;
  setProgressResult: (r: ApiResult | null) => void;
  previewResult: ApiResult | null;
  setPreviewResult: (r: ApiResult | null) => void;
  saveAiResult: ApiResult | null;
  setSaveAiResult: (r: ApiResult | null) => void;
  improveResult: ApiResult | null;
  setImproveResult: (r: ApiResult | null) => void;
  budgetSummaryResult: ApiResult | null;
  setBudgetSummaryResult: (r: ApiResult | null) => void;
  complianceRunResult: ApiResult | null;
  setComplianceRunResult: (r: ApiResult | null) => void;
  sessionComplianceResult: ApiResult | null;
  setSessionComplianceResult: (r: ApiResult | null) => void;
  complianceOverviewResult: ApiResult | null;
  setComplianceOverviewResult: (r: ApiResult | null) => void;
  patternRunResult: ApiResult | null;
  setPatternRunResult: (r: ApiResult | null) => void;
  patternListResult: ApiResult | null;
  setPatternListResult: (r: ApiResult | null) => void;
  shiftId: string;
  setShiftId: (v: string) => void;
  shiftBriefResult: ApiResult | null;
  setShiftBriefResult: (r: ApiResult | null) => void;
  clockInResult: ApiResult | null;
  setClockInResult: (r: ApiResult | null) => void;
  assessNoteResult: ApiResult | null;
  setAssessNoteResult: (r: ApiResult | null) => void;
  withProgressDelta: boolean;
  setWithProgressDelta: (v: boolean) => void;
};

function readUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setUnlocked(unlocked: boolean) {
  try {
    if (unlocked) sessionStorage.setItem(UNLOCK_STORAGE_KEY, "1");
    else sessionStorage.removeItem(UNLOCK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function callApi(input: RequestInfo, init?: RequestInit): Promise<ApiResult> {
  try {
    const res = await apiFetch(input, init);
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? undefined : String((data as { detail?: string })?.detail ?? res.statusText),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

function extractDurationRules(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  const rulesResult = root.rules_result as Record<string, unknown> | undefined;
  const rules = (rulesResult?.rules ?? root.rules) as unknown;
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r): r is Record<string, unknown> =>
      typeof r === "object" &&
      r !== null &&
      (r.rule === "duration_consistency_warning" || r.rule === "duration_consistency_error"),
  );
}

function extractBudgetRules(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  const rulesResult = root.rules_result as Record<string, unknown> | undefined;
  const rules = (rulesResult?.rules ?? root.rules) as unknown;
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r): r is Record<string, unknown> =>
      typeof r === "object" &&
      r !== null &&
      (r.rule === "budget_exceeded" || r.rule === "budget_warning"),
  );
}

function ShiftsMigrationStatusNote({ result }: { result: ApiResult | null }) {
  if (!result?.ok || !result.data || typeof result.data !== "object") return null;
  const data = result.data as {
    shifts_table_missing?: boolean;
    sessions_shift_id_column_missing?: boolean;
  };
  const shiftsOk = data.shifts_table_missing === false;
  const shiftIdOk = data.sessions_shift_id_column_missing === false;
  const allOk = shiftsOk && shiftIdOk;

  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs leading-relaxed space-y-2"
      style={{
        borderColor: allOk ? "#BBF7D0" : "#FDE68A",
        background: allOk ? "#F0FDF4" : "#FFFBEB",
        color: allOk ? "#166534" : "#92400E",
      }}
    >
      <p className="font-semibold">How to read this (CARECLIQV2-87)</p>
      <ul className="list-disc pl-4 space-y-1">
        <li>
          <code className="text-[11px]">shifts_table_missing: false</code> — shifts table exists
        </li>
        <li>
          <code className="text-[11px]">sessions_shift_id_column_missing: false</code> —{" "}
          <code className="text-[11px]">sessions.shift_id</code> column exists
        </li>
      </ul>
      {!allOk && (
        <p>
          Run <code className="text-[11px]">029_shifts.sql</code> in Supabase SQL Editor, restart backend,
          then check again.
        </p>
      )}
      {allOk && (
        <p>
          Optional demo data: <code className="text-[11px]">045_shifts_demo_james_chen.sql</code> links shift{" "}
          <code className="text-[11px]">{DEMO_JAMES_SHIFT}</code> to James draft session.
        </p>
      )}
    </div>
  );
}

function DurationRulesStatusNote({
  complianceRun,
  sessionCompliance,
}: {
  complianceRun: ApiResult | null;
  sessionCompliance: ApiResult | null;
}) {
  const durationRules =
    extractDurationRules(complianceRun?.data).length > 0
      ? extractDurationRules(complianceRun?.data)
      : extractDurationRules(sessionCompliance?.data);

  if (!complianceRun && !sessionCompliance) return null;

  const hasError = durationRules.some((r) => r.rule === "duration_consistency_error");
  const hasWarning = durationRules.some((r) => r.rule === "duration_consistency_warning");
  const none = durationRules.length === 0;

  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs leading-relaxed space-y-2"
      style={{
        borderColor: hasError ? "#FECACA" : hasWarning ? "#FDE68A" : none ? "#E2E8F0" : "#BBF7D0",
        background: hasError ? "#FEF2F2" : hasWarning ? "#FFFBEB" : none ? "#F8FAFC" : "#F0FDF4",
        color: hasError ? "#991B1B" : hasWarning ? "#92400E" : "#475569",
      }}
    >
      <p className="font-semibold">How to read this (CARECLIQV2-35)</p>
      {none ? (
        <p>
          No duration rules fired — session may lack <code className="text-[11px]">shift_id</code>, shift has no{" "}
          <code className="text-[11px]">duration_minutes</code>, or deviation is ≤30 min. Demo shift is 135 min;
          set session <code className="text-[11px]">duration_minutes</code> to 170 (warning) or 200 (error) to test.
        </p>
      ) : (
        <ul className="list-disc pl-4 space-y-1">
          {durationRules.map((r, i) => (
            <li key={i}>
              <code className="text-[11px]">{String(r.rule)}</code> — {String(r.message ?? "")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PatternsMigrationNote({ result }: { result: ApiResult | null }) {
  if (!result?.ok || !result.data || typeof result.data !== "object") return null;
  const data = result.data as { ai_detected_patterns_table_missing?: boolean };
  const ok = data.ai_detected_patterns_table_missing === false;
  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs leading-relaxed"
      style={{
        borderColor: ok ? "#BBF7D0" : "#FDE68A",
        background: ok ? "#F0FDF4" : "#FFFBEB",
        color: ok ? "#166534" : "#92400E",
      }}
    >
      {ok ? (
        <p>
          <code className="text-[11px]">ai_detected_patterns_table_missing: false</code> — schema ready.
        </p>
      ) : (
        <p>
          Run <code className="text-[11px]">030_ai_detected_patterns.sql</code> in Supabase, then restart backend.
        </p>
      )}
    </div>
  );
}

function PatternsStatusNote({ run, list }: { run: ApiResult | null; list: ApiResult | null }) {
  const extract = (data: unknown): unknown[] => {
    if (!data || typeof data !== "object") return [];
    const root = data as Record<string, unknown>;
    const patterns = root.patterns;
    return Array.isArray(patterns) ? patterns : [];
  };
  const patterns = extract(run?.data).length > 0 ? extract(run?.data) : extract(list?.data);
  if (!run && !list) return null;
  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs leading-relaxed space-y-2"
      style={{ borderColor: BORDER, background: "var(--cc-soft)", color: TEXT }}
    >
      <p className="font-semibold">How to read this (CARECLIQV2-34)</p>
      {patterns.length === 0 ? (
        <p>
          No active patterns — ensure org has ≥4 low-scoring sessions per worker–participant pair, incident spike,
          or 2+ refused-activity notes without de-escalation, then run POST patterns/run again.
        </p>
      ) : (
        <ul className="list-disc pl-4 space-y-1">
          {patterns.slice(0, 5).map((p, i) => {
            const row = p as Record<string, unknown>;
            return (
              <li key={i}>
                <code className="text-[11px]">{String(row.pattern_type ?? "pattern")}</code> —{" "}
                {String(row.message ?? row.title ?? "")}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BudgetRulesStatusNote({
  budgetSummary,
  complianceRun,
  sessionCompliance,
}: {
  budgetSummary: ApiResult | null;
  complianceRun: ApiResult | null;
  sessionCompliance: ApiResult | null;
}) {
  const budgetRules =
    extractBudgetRules(complianceRun?.data).length > 0
      ? extractBudgetRules(complianceRun?.data)
      : extractBudgetRules(sessionCompliance?.data);

  const hasPlan: boolean =
    !!(budgetSummary?.ok &&
    budgetSummary.data &&
    typeof budgetSummary.data === "object" &&
    (budgetSummary.data as { has_plan?: boolean }).has_plan === true);

  const exceeded = budgetRules.some((r) => r.rule === "budget_exceeded");
  const warning = budgetRules.some((r) => r.rule === "budget_warning");

  if (!budgetSummary && !complianceRun && !sessionCompliance) return null;

  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs leading-relaxed space-y-2"
      style={{
        borderColor: exceeded ? "#FECACA" : warning ? "#FDE68A" : hasPlan ? "#BBF7D0" : "#E5E7EB",
        background: exceeded ? "#FEF2F2" : warning ? "#FFFBEB" : hasPlan ? "#F0FDF4" : "#F8F7FC",
        color: TEXT,
      }}
    >
      <p className="font-semibold">How to read this (CARECLIQV2-36)</p>
      {budgetSummary?.ok && (
        <p>
          <code className="text-[11px]">has_plan: {String(hasPlan)}</code>
          {hasPlan
            ? " — NDIS plan found; budget rules can run on compliance scoring."
            : " — no active NDIS plan; budget rules should be skipped (not failed)."}
        </p>
      )}
      {exceeded && (
        <p>
          <code className="text-[11px]">budget_exceeded</code> detected — session estimated cost exceeds
          remaining category budget.
        </p>
      )}
      {warning && !exceeded && (
        <p>
          <code className="text-[11px]">budget_warning</code> detected — category budget is within 10% of
          exhausted.
        </p>
      )}
      {hasPlan && budgetRules.length === 0 && Boolean(complianceRun?.ok || sessionCompliance?.ok) && (
        <p>No budget rules fired — plan budget is healthy for this session category.</p>
      )}
      <p style={{ color: MUTED }}>
        Uses <code className="text-[11px]">apiFetch</code> (respects{" "}
        <code className="text-[11px]">VITE_API_URL</code> for direct backend). Coordinator overview:{" "}
        <code className="text-[11px]">GET /api/coordinator/compliance-overview</code> →{" "}
        <code className="text-[11px]">budget_warnings[]</code>.
      </p>
    </div>
  );
}

function MigrationStatusNote({ result }: { result: ApiResult | null }) {
  if (!result?.ok || !result.data || typeof result.data !== "object") return null;
  const data = result.data as {
    progress_delta_column_missing?: boolean;
    all_ok?: boolean;
    organizations_table_missing?: boolean;
  };
  const progressOk = data.progress_delta_column_missing === false;

  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs leading-relaxed space-y-2"
      style={{
        borderColor: progressOk ? "#BBF7D0" : "#FDE68A",
        background: progressOk ? "#F0FDF4" : "#FFFBEB",
        color: progressOk ? "#166534" : "#92400E",
      }}
    >
      <p className="font-semibold">How to read this (CARECLIQV2-72 only)</p>
      {progressOk ? (
        <p>
          <code className="text-[11px]">progress_delta_column_missing: false</code> means the{" "}
          <code className="text-[11px]">progress_delta</code> column exists —{" "}
          <strong>this ticket is satisfied</strong>, even if you applied{" "}
          <code className="text-[11px]">028_progress_delta.sql</code> directly in the Supabase SQL Editor.
        </p>
      ) : (
        <p>
          <code className="text-[11px]">progress_delta_column_missing: true</code> — run{" "}
          <code className="text-[11px]">028_progress_delta.sql</code> in Supabase, then check again.
        </p>
      )}
      {data.all_ok === false && progressOk && (
        <p>
          <code className="text-[11px]">all_ok: false</code> checks{" "}
          <em>all</em> schema probes, not just this ticket. Other flags (e.g.{" "}
          {data.organizations_table_missing && (
            <>
              <code className="text-[11px]">organizations_table_missing</code>
              {" "}
            </>
          )}
          ) can keep <code className="text-[11px]">all_ok</code> false while 72 is still complete.
        </p>
      )}
    </div>
  );
}

function ResultBox({ title, result }: { title: string; result: ApiResult | null }) {
  if (!result) return null;
  return (
    <div
      className="mt-3 rounded-xl border p-4 text-sm"
      style={{
        borderColor: result.ok ? "#BBF7D0" : "#FECACA",
        background: result.ok ? "#F0FDF4" : "#FEF2F2",
      }}
    >
      <div className="flex items-center gap-2 font-semibold mb-2" style={{ color: TEXT }}>
        {result.ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <XCircle className="h-4 w-4 text-red-600" />
        )}
        {title} — HTTP {result.status || "error"}
      </div>
      {result.error && <p className="text-red-700 mb-2">{result.error}</p>}
      <pre className="text-xs overflow-auto max-h-80 whitespace-pre-wrap" style={{ color: TEXT }}>
        {JSON.stringify(result.data, null, 2)}
      </pre>
    </div>
  );
}

function ParticipantFields({
  ctx,
  showDemoFill = true,
}: {
  ctx: TestContext;
  showDemoFill?: boolean;
}) {
  return (
    <div className="space-y-3">
      {ctx.loadingParticipants ? (
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: PLUM }} />
      ) : (
        <select
          aria-label="Select participant"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          value={ctx.participantId}
          onChange={(e) => ctx.setParticipantId(e.target.value)}
        >
          <option value="">— choose participant —</option>
          {ctx.participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name ?? p.id}
            </option>
          ))}
        </select>
      )}
      <div>
        <Label className="text-xs text-muted-foreground">Participant UUID</Label>
        <Input
          value={ctx.participantId}
          onChange={(e) => ctx.setParticipantId(e.target.value)}
          className="mt-1"
        />
      </div>
      {showDemoFill && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => ctx.setParticipantId(DEMO_JAMES_PARTICIPANT)}
        >
          Use James Chen demo ID
        </Button>
      )}
    </div>
  );
}

function SessionField({ ctx, showDemoFill = true }: { ctx: TestContext; showDemoFill?: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground">Session UUID</Label>
        <Input
          value={ctx.sessionId}
          onChange={(e) => ctx.setSessionId(e.target.value)}
          className="mt-1"
        />
      </div>
      {showDemoFill && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => ctx.setSessionId(DEMO_JAMES_DRAFT_SESSION)}
        >
          Use James Chen draft session
        </Button>
      )}
    </div>
  );
}

function TicketTestPanel({ ticketId, ctx }: { ticketId: TicketId; ctx: TestContext }) {
  const isCoordinator = ctx.user?.role === "support_coordinator";
  const ticket = TICKETS.find((t) => t.id === ticketId)!;

  switch (ticketId) {
    case "CARECLIQV2-72":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <ul className="text-sm space-y-1 list-disc pl-5" style={{ color: MUTED }}>
            <li>Migration file: <code className="text-xs">028_progress_delta.sql</code></li>
            <li>Expect <code className="text-xs">progress_delta_column_missing: false</code></li>
          </ul>
          <Button
            variant="outline"
            disabled={ctx.busy === "migration" || !isCoordinator}
            onClick={() =>
              ctx.run("migration", async () => {
                const r = await callApi("/api/system/migration-status");
                ctx.setMigrationResult(r);
              })
            }
          >
            {ctx.busy === "migration" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Check migration status
          </Button>
          <ResultBox title="Migration status" result={ctx.migrationResult} />
          <MigrationStatusNote result={ctx.migrationResult} />
        </div>
      );

    case "CARECLIQV2-74":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <SessionField ctx={ctx} />
          <Button
            variant="destructive"
            disabled={!ctx.sessionId || ctx.busy === "saveai"}
            onClick={() =>
              ctx.run("saveai", async () => {
                if (!window.confirm("Runs save-with-ai and writes progress_delta to DB. Continue?")) return;
                const r = await callApi(`/api/sessions/${ctx.sessionId}/save-with-ai`, { method: "POST" });
                ctx.setSaveAiResult(r);
              })
            }
          >
            {ctx.busy === "saveai" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            POST /api/sessions/:id/save-with-ai
          </Button>
          <ResultBox title="Save with AI" result={ctx.saveAiResult} />
          <p className="text-xs" style={{ color: MUTED }}>
            Verify response includes <code>progress_delta</code> array with goal_id, prompt_level,
            independence_rating, skill_step, delta_summary.
          </p>
        </div>
      );

    case "CARECLIQV2-79":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <ParticipantFields ctx={ctx} />
          <SessionField ctx={ctx} />
          <p className="text-sm" style={{ color: MUTED }}>
            Use a participant with 2+ completed sessions that already have progress_delta. Compare
            preview output — delta_summary should reference prior trajectory.
          </p>
          <Button
            variant="outline"
            disabled={!ctx.sessionId || ctx.busy === "preview79"}
            onClick={() =>
              ctx.run("preview79", async () => {
                const r = await callApi(`/api/sessions/${ctx.sessionId}/preview-progress`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ participant_id: ctx.participantId || undefined }),
                });
                ctx.setPreviewResult(r);
              })
            }
          >
            {ctx.busy === "preview79" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            POST preview-progress (with prior context)
          </Button>
          <ResultBox title="Preview progress" result={ctx.previewResult} />
        </div>
      );

    case "CARECLIQV2-78":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <SessionField ctx={ctx} />
          <ol className="text-sm list-decimal pl-5 space-y-2" style={{ color: MUTED }}>
            <li>
              Open live session:{" "}
              <Link
                href={ctx.sessionId ? `/sessions/${ctx.sessionId}/live` : "#"}
                className="font-mono text-xs underline"
                style={{ color: PLUM }}
              >
                /sessions/{ctx.sessionId || ":id"}/live
              </Link>
            </li>
            <li>End session → Review &amp; Approve modal opens</li>
            <li>Green <strong>Progress Summary</strong> box shows per-goal delta_summary</li>
            <li>Approve &amp; Save persists progress_delta</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            {ctx.sessionId && (
              <Link href={`/sessions/${ctx.sessionId}/live`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  Open live session <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.sessionId || ctx.busy === "preview78"}
              onClick={() =>
                ctx.run("preview78", async () => {
                  const r = await callApi(`/api/sessions/${ctx.sessionId}/preview-progress`, {
                    method: "POST",
                  });
                  ctx.setPreviewResult(r);
                })
              }
            >
              {ctx.busy === "preview78" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              API dry-run (preview-progress)
            </Button>
          </div>
          <ResultBox title="Preview progress" result={ctx.previewResult} />
        </div>
      );

    case "CARECLIQV2-76":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <ParticipantFields ctx={ctx} />
          <p className="text-sm" style={{ color: MUTED }}>
            Coordinator → 200 with goals + trends. Worker → 403.
          </p>
          <Button
            disabled={!ctx.participantId || ctx.busy === "progress"}
            onClick={() =>
              ctx.run("progress", async () => {
                const r = await callApi(`/api/participants/${ctx.participantId}/progress`);
                ctx.setProgressResult(r);
              })
            }
            style={{ background: PLUM }}
            className="text-white"
          >
            {ctx.busy === "progress" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            GET /api/participants/:id/progress
          </Button>
          <ResultBox title="Progress API" result={ctx.progressResult} />
        </div>
      );

    case "CARECLIQV2-33":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <ParticipantFields ctx={ctx} />
          <textarea
            className="w-full rounded-lg border p-3 text-sm min-h-[120px]"
            value={ctx.noteText}
            onChange={(e) => ctx.setNoteText(e.target.value)}
            placeholder="Draft note to improve..."
          />
          <Button
            variant="outline"
            disabled={!ctx.noteText.trim() || ctx.busy === "improve"}
            onClick={() =>
              ctx.run("improve", async () => {
                const r = await callApi("/api/ai/improve-note", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    notes: ctx.noteText,
                    failed_rules: [
                      { rule: "documentation", message: "Note lacks measurable outcomes" },
                    ],
                    participant_id: ctx.participantId || undefined,
                  }),
                });
                ctx.setImproveResult(r);
              })
            }
          >
            {ctx.busy === "improve" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            POST /api/ai/improve-note
          </Button>
          <ResultBox title="Improve note" result={ctx.improveResult} />
        </div>
      );

    case "CARECLIQV2-36":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <ParticipantFields ctx={ctx} />
          <SessionField ctx={ctx} />
          <ol className="text-sm list-decimal pl-5 space-y-2" style={{ color: MUTED }}>
            <li>Confirm participant has an active NDIS plan with per-category budgets.</li>
            <li>
              Session needs a legal English note (<code className="text-xs">compliance_input_text</code> or
              translated note) or <code className="text-xs">POST /compliance/run</code> returns 422.
            </li>
            <li>
              Run compliance → inspect <code className="text-xs">rules_result.rules</code> for{" "}
              <code className="text-xs">budget_exceeded</code> / <code className="text-xs">budget_warning</code>.
            </li>
            <li>Coordinator: check overview <code className="text-xs">budget_warnings[]</code>.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.participantId || ctx.busy === "budget36"}
              onClick={() =>
                ctx.run("budget36", async () => {
                  const r = await callApi(`/api/participants/${ctx.participantId}/budget-summary`);
                  ctx.setBudgetSummaryResult(r);
                })
              }
            >
              {ctx.busy === "budget36" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              GET budget-summary
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.sessionId || ctx.busy === "compliance36"}
              onClick={() =>
                ctx.run("compliance36", async () => {
                  const r = await callApi(`/api/compliance/run/${ctx.sessionId}`, { method: "POST" });
                  ctx.setComplianceRunResult(r);
                })
              }
            >
              {ctx.busy === "compliance36" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              POST compliance/run
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.sessionId || ctx.busy === "sessioncomp36"}
              onClick={() =>
                ctx.run("sessioncomp36", async () => {
                  const r = await callApi(`/api/sessions/${ctx.sessionId}/compliance`);
                  ctx.setSessionComplianceResult(r);
                })
              }
            >
              {ctx.busy === "sessioncomp36" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              GET session compliance
            </Button>
            {isCoordinator ? (
              <Button
                size="sm"
                disabled={ctx.busy === "overview36"}
                onClick={() =>
                  ctx.run("overview36", async () => {
                    const r = await callApi("/api/coordinator/compliance-overview");
                    ctx.setComplianceOverviewResult(r);
                  })
                }
                style={{ background: PLUM }}
                className="text-white"
              >
                {ctx.busy === "overview36" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                GET coordinator overview
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={ctx.busy === "overview36"}
                onClick={() =>
                  ctx.run("overview36", async () => {
                    const r = await callApi("/api/reports/compliance-overview");
                    ctx.setComplianceOverviewResult(r);
                  })
                }
                style={{ background: PLUM }}
                className="text-white"
              >
                {ctx.busy === "overview36" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                GET reports overview
              </Button>
            )}
            {ctx.sessionId && (
              <Link href={`/sessions/${ctx.sessionId}`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  Open session detail <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
            <Link href="/compliance">
              <Button variant="outline" size="sm" className="gap-1.5">
                Compliance Centre <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <ResultBox title="Budget summary" result={ctx.budgetSummaryResult} />
          <ResultBox title="Compliance run" result={ctx.complianceRunResult} />
          <ResultBox title="Stored session compliance" result={ctx.sessionComplianceResult} />
          <ResultBox title="Compliance overview (budget_warnings)" result={ctx.complianceOverviewResult} />
          <BudgetRulesStatusNote
            budgetSummary={ctx.budgetSummaryResult}
            complianceRun={ctx.complianceRunResult}
            sessionCompliance={ctx.sessionComplianceResult}
          />
        </div>
      );

    case "CARECLIQV2-87":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <ul className="text-sm space-y-1 list-disc pl-5" style={{ color: MUTED }}>
            <li>Migration file: <code className="text-xs">029_shifts.sql</code></li>
            <li>Demo seed: <code className="text-xs">045_shifts_demo_james_chen.sql</code></li>
            <li>
              Expect <code className="text-xs">shifts_table_missing: false</code> and{" "}
              <code className="text-xs">sessions_shift_id_column_missing: false</code>
            </li>
          </ul>
          <Button
            variant="outline"
            disabled={ctx.busy === "migration87" || !isCoordinator}
            onClick={() =>
              ctx.run("migration87", async () => {
                const r = await callApi("/api/system/migration-status");
                ctx.setMigrationResult(r);
              })
            }
          >
            {ctx.busy === "migration87" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Check migration status
          </Button>
          <ResultBox title="Migration status" result={ctx.migrationResult} />
          <ShiftsMigrationStatusNote result={ctx.migrationResult} />
        </div>
      );

    case "CARECLIQV2-35":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <SessionField ctx={ctx} />
          <ol className="text-sm list-decimal pl-5 space-y-2" style={{ color: MUTED }}>
            <li>Apply <code className="text-xs">029_shifts.sql</code> then optional demo seed <code className="text-xs">045_shifts_demo_james_chen.sql</code>.</li>
            <li>Session must have <code className="text-xs">shift_id</code> set and shift must have <code className="text-xs">duration_minutes</code>.</li>
            <li>Demo: shift 135 min — set session duration 170 (warning) or 200 (error).</li>
            <li>Run compliance → inspect <code className="text-xs">duration_consistency_warning</code> / <code className="text-xs">duration_consistency_error</code> in rules matrix.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.sessionId || ctx.busy === "compliance35"}
              onClick={() =>
                ctx.run("compliance35", async () => {
                  const r = await callApi(`/api/compliance/run/${ctx.sessionId}`, { method: "POST" });
                  ctx.setComplianceRunResult(r);
                })
              }
            >
              {ctx.busy === "compliance35" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              POST compliance/run
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.sessionId || ctx.busy === "sessioncomp35"}
              onClick={() =>
                ctx.run("sessioncomp35", async () => {
                  const r = await callApi(`/api/sessions/${ctx.sessionId}/compliance`);
                  ctx.setSessionComplianceResult(r);
                })
              }
            >
              {ctx.busy === "sessioncomp35" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              GET session compliance
            </Button>
            {ctx.sessionId && (
              <Link href={`/sessions/${ctx.sessionId}`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  Open session detail <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
          </div>
          <ResultBox title="Compliance run" result={ctx.complianceRunResult} />
          <ResultBox title="Stored session compliance" result={ctx.sessionComplianceResult} />
          <DurationRulesStatusNote
            complianceRun={ctx.complianceRunResult}
            sessionCompliance={ctx.sessionComplianceResult}
          />
        </div>
      );

    case "CARECLIQV2-34":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <ul className="text-sm space-y-1 list-disc pl-5" style={{ color: MUTED }}>
            <li>Migration: <code className="text-xs">030_ai_detected_patterns.sql</code></li>
            <li>Weekly cron: <code className="text-xs">python3 -m backend.scripts.pattern_detection_cron</code> (Sun 00:00 UTC)</li>
            <li>Coordinator login required for all endpoints below.</li>
          </ul>
          <ol className="text-sm list-decimal pl-5 space-y-2" style={{ color: MUTED }}>
            <li>Run migration, restart backend.</li>
            <li>POST <code className="text-xs">/ai-detected-patterns/run</code> to scan org sessions/incidents.</li>
            <li>GET patterns → open <code className="text-xs">/compliance</code> → <strong>AI Detected Patterns</strong> section.</li>
            <li>Dismiss a pattern from Compliance Centre or via API.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!isCoordinator || ctx.busy === "migration34"}
              onClick={() =>
                ctx.run("migration34", async () => {
                  const r = await callApi("/api/system/migration-status");
                  ctx.setMigrationResult(r);
                })
              }
            >
              {ctx.busy === "migration34" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Check migration status
            </Button>
            <Button
              size="sm"
              disabled={!isCoordinator || ctx.busy === "patternrun34"}
              onClick={() =>
                ctx.run("patternrun34", async () => {
                  const r = await callApi("/api/coordinator/ai-detected-patterns/run", { method: "POST" });
                  ctx.setPatternRunResult(r);
                })
              }
              style={{ background: PLUM }}
              className="text-white"
            >
              {ctx.busy === "patternrun34" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              POST patterns/run
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!isCoordinator || ctx.busy === "patternlist34"}
              onClick={() =>
                ctx.run("patternlist34", async () => {
                  const r = await callApi("/api/coordinator/ai-detected-patterns");
                  ctx.setPatternListResult(r);
                })
              }
            >
              {ctx.busy === "patternlist34" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              GET patterns
            </Button>
            <Link href="/compliance">
              <Button variant="outline" size="sm" className="gap-1.5">
                Compliance Centre <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <ResultBox title="Migration status" result={ctx.migrationResult} />
          <PatternsMigrationNote result={ctx.migrationResult} />
          <ResultBox title="Pattern detection run" result={ctx.patternRunResult} />
          <ResultBox title="Active patterns" result={ctx.patternListResult} />
          <PatternsStatusNote run={ctx.patternRunResult} list={ctx.patternListResult} />
        </div>
      );

    case "CARECLIQV2-90":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <div>
            <Label className="text-xs text-muted-foreground">Shift UUID</Label>
            <Input
              value={ctx.shiftId}
              onChange={(e) => ctx.setShiftId(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => ctx.setShiftId(DEMO_JAMES_SHIFT)}
          >
            Use James Chen demo shift
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.shiftId || ctx.busy === "brief90"}
              onClick={() =>
                ctx.run("brief90", async () => {
                  const r = await callApi(`/api/worker/shifts/${ctx.shiftId}`);
                  ctx.setShiftBriefResult(r);
                })
              }
            >
              {ctx.busy === "brief90" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              GET shift briefing
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!ctx.shiftId || ctx.busy === "clock90"}
              onClick={() =>
                ctx.run("clock90", async () => {
                  const r = await callApi(`/api/worker/shifts/${ctx.shiftId}/clock-in`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ method: "gps", location: { lat: -34.92, lng: 138.6 } }),
                  });
                  ctx.setClockInResult(r);
                })
              }
            >
              {ctx.busy === "clock90" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              POST clock-in (expect 409 if already clocked)
            </Button>
            {ctx.shiftId && (
              <Link href={`/my-shifts/${ctx.shiftId}`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  Open My Shift <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
          </div>
          <ResultBox title="Shift briefing" result={ctx.shiftBriefResult} />
          <ResultBox title="Clock-in" result={ctx.clockInResult} />
          <p className="text-xs" style={{ color: MUTED }}>
            Expect <code className="text-xs">active_goals</code>,{" "}
            <code className="text-xs">health_alerts</code>,{" "}
            <code className="text-xs">coordinator_notes</code>,{" "}
            <code className="text-xs">primary_contact</code> in briefing. Wrong worker → 403. Already clocked → 409.
            Wrong day → 422 &quot;Shift not scheduled for today&quot;.
          </p>
        </div>
      );

    case "CARECLIQV2-75":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <SessionField ctx={ctx} />
          <div>
            <Label htmlFor="dev-note-text" className="text-xs text-muted-foreground">Note text for assess-note</Label>
            <textarea
              id="dev-note-text"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm min-h-[100px]"
              value={ctx.noteText}
              onChange={(e) => ctx.setNoteText(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ctx.withProgressDelta}
              onChange={(e) => ctx.setWithProgressDelta(e.target.checked)}
            />
            Include sample progress_delta (20pt Progress Evidence)
          </label>
          <Button
            size="sm"
            disabled={ctx.busy === "assess75"}
            onClick={() =>
              ctx.run("assess75", async () => {
                const progress_delta = ctx.withProgressDelta
                  ? [{
                      goal_id: "demo-goal",
                      prompt_level: "partial",
                      independence_rating: 3,
                      skill_step: "meal prep",
                      delta_summary: "Improved from full to partial prompting during lunch.",
                    }]
                  : [];
                const r = await callApi("/api/ai/assess-note", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    note_text: ctx.noteText,
                    session_started: true,
                    session_id: ctx.sessionId || undefined,
                    progress_delta,
                    goals: [{ title: "Develop daily living skills", description: "Meal preparation" }],
                  }),
                });
                ctx.setAssessNoteResult(r);
              })
            }
            style={{ background: PLUM }}
            className="text-white"
          >
            {ctx.busy === "assess75" && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            POST /api/ai/assess-note
          </Button>
          <ResultBox title="Assess note" result={ctx.assessNoteResult} />
          <p className="text-xs" style={{ color: MUTED }}>
            Without progress_delta: score capped at 80. With delta: up to 100. Billing threshold remains 75.
            Check <code className="text-xs">breakdown.progress_evidence</code>.
          </p>
        </div>
      );

    case "CARECLIQV2-217":
      return (
        <div className="space-y-4">
          <TicketHeader ticket={ticket} />
          <p className="text-sm" style={{ color: MUTED }}>
            Interactive demo — mandatory tasks show red warning icon and orange &quot;evidence required&quot; state.
            Optional tasks use lighter styling. Complete with evidence turns green.
          </p>
          <TaskVisualDemo />
          {ctx.shiftId && (
            <Link href={`/my-shifts/${ctx.shiftId}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                Open live shift checklist <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          )}
        </div>
      );

    default:
      return null;
  }
}

function TicketHeader({ ticket }: { ticket: TicketDef }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PLUM }}>
        {ticket.id}
      </p>
      <h2 className="text-xl font-bold mt-1">{ticket.title}</h2>
      <p className="text-sm mt-2" style={{ color: MUTED }}>
        {ticket.description}
      </p>
    </div>
  );
}

function DevConsolePasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!DEV_CONSOLE_PASSWORD) {
      setError("VITE_DEV_CONSOLE_PASSWORD is not set. Add it to .env and rebuild the frontend.");
      return;
    }
    if (password === DEV_CONSOLE_PASSWORD) {
      setUnlocked(true);
      setError("");
      onUnlock();
      return;
    }
    setError("Incorrect password.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: APP_BG }}>
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: ACTIVE, color: PLUM }}>
            <Lock className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Dev Test Console</h1>
            <p className="text-sm" style={{ color: MUTED }}>Private — not in navigation</p>
          </div>
        </div>
        {!DEV_CONSOLE_PASSWORD ? (
          <p className="text-sm text-amber-700">
            Set <code className="text-xs">VITE_DEV_CONSOLE_PASSWORD</code> in <code className="text-xs">.env</code>, then{" "}
            <code className="text-xs">docker compose up -d --build frontend</code>
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="dev-console-password" className="text-xs" style={{ color: MUTED }}>
                Console password
              </Label>
              <PasswordInput
                id="dev-console-password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full text-white" style={{ background: PLUM }}>
              Unlock
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function DevProgressTestContent({ onLock }: { onLock: () => void }) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<TicketId | null>(null);
  const [page, setPage] = useState(1);

  const { data: participants = [], isLoading: loadingParticipants } = useOrgQuery<
    Array<{ id: string; full_name?: string }>
  >(["dev", "participants"], {
    queryFn: async () => {
      const res = await apiFetch("/api/participants");
      if (!res.ok) throw new Error(`Failed to load participants (${res.status})`);
      return res.json();
    },
  });

  const [participantId, setParticipantId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [noteText, setNoteText] = useState(
    "Supported participant with dressing. Required partial verbal prompting for shirt buttons.",
  );
  const [progressResult, setProgressResult] = useState<ApiResult | null>(null);
  const [previewResult, setPreviewResult] = useState<ApiResult | null>(null);
  const [saveAiResult, setSaveAiResult] = useState<ApiResult | null>(null);
  const [improveResult, setImproveResult] = useState<ApiResult | null>(null);
  const [migrationResult, setMigrationResult] = useState<ApiResult | null>(null);
  const [budgetSummaryResult, setBudgetSummaryResult] = useState<ApiResult | null>(null);
  const [complianceRunResult, setComplianceRunResult] = useState<ApiResult | null>(null);
  const [sessionComplianceResult, setSessionComplianceResult] = useState<ApiResult | null>(null);
  const [complianceOverviewResult, setComplianceOverviewResult] = useState<ApiResult | null>(null);
  const [patternRunResult, setPatternRunResult] = useState<ApiResult | null>(null);
  const [patternListResult, setPatternListResult] = useState<ApiResult | null>(null);
  const [shiftId, setShiftId] = useState(DEMO_JAMES_SHIFT);
  const [shiftBriefResult, setShiftBriefResult] = useState<ApiResult | null>(null);
  const [clockInResult, setClockInResult] = useState<ApiResult | null>(null);
  const [assessNoteResult, setAssessNoteResult] = useState<ApiResult | null>(null);
  const [withProgressDelta, setWithProgressDelta] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TICKETS;
    return TICKETS.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.keywords.toLowerCase().includes(q),
    );
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / TICKETS_PER_PAGE));

  const paginatedTickets = useMemo(() => {
    const start = (page - 1) * TICKETS_PER_PAGE;
    return filteredTickets.slice(start, start + TICKETS_PER_PAGE);
  }, [filteredTickets, page]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const ctx: TestContext = {
    user,
    participants,
    loadingParticipants,
    participantId,
    setParticipantId,
    sessionId,
    setSessionId,
    noteText,
    setNoteText,
    busy,
    run,
    migrationResult,
    setMigrationResult,
    progressResult,
    setProgressResult,
    previewResult,
    setPreviewResult,
    saveAiResult,
    setSaveAiResult,
    improveResult,
    setImproveResult,
    budgetSummaryResult,
    setBudgetSummaryResult,
    complianceRunResult,
    setComplianceRunResult,
    sessionComplianceResult,
    setSessionComplianceResult,
    complianceOverviewResult,
    setComplianceOverviewResult,
    patternRunResult,
    setPatternRunResult,
    patternListResult,
    setPatternListResult,
    shiftId,
    setShiftId,
    shiftBriefResult,
    setShiftBriefResult,
    clockInResult,
    setClockInResult,
    assessNoteResult,
    setAssessNoteResult,
    withProgressDelta,
    setWithProgressDelta,
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: APP_BG, color: TEXT }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur px-4 py-3 md:px-6"
        style={{ borderColor: BORDER }}
      >
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <FlaskConical className="h-5 w-5" style={{ color: PLUM }} />
            <span className="font-bold text-sm hidden sm:inline">Progress Test Console</span>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: MUTED }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets (e.g. CARECLIQV2-78, approval, RAG...)"
              className="pl-9 rounded-full"
            />
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={onLock}>
            <LogOut className="h-3.5 w-3.5" />
            Lock
          </Button>
        </div>
      </header>

      <div className="flex-1 max-w-6xl mx-auto w-full p-4 md:p-6 flex flex-col lg:flex-row gap-6">
        {/* Left — ticket list */}
        <aside className="w-full lg:w-72 shrink-0">
          <div className="rounded-2xl border bg-white overflow-hidden sticky top-20" style={{ borderColor: BORDER }}>
            <div
              className="px-4 py-3 border-b text-xs font-bold uppercase tracking-wider"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              Tickets ({filteredTickets.length})
            </div>
            <div>
              {filteredTickets.length === 0 ? (
                <p className="p-4 text-sm" style={{ color: MUTED }}>
                  No tickets match your search.
                </p>
              ) : (
                paginatedTickets.map((ticket) => {
                  const active = selectedId === ticket.id;
                  return (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => setSelectedId(ticket.id)}
                      className="w-full text-left px-4 py-3 border-b transition-colors hover:bg-black/[0.02]"
                      style={{
                        borderColor: BORDER,
                        background: active ? ACTIVE : "transparent",
                      }}
                    >
                      <p className="text-xs font-bold" style={{ color: active ? PLUM : MUTED }}>
                        {ticket.id}
                      </p>
                      <p className="text-sm font-semibold mt-0.5 leading-snug">{ticket.title}</p>
                    </button>
                  );
                })
              )}
            </div>
            {filteredTickets.length > 0 && (
              <div
                className="flex items-center justify-between gap-2 px-3 py-2 border-t"
                style={{ borderColor: BORDER }}
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-medium tabular-nums" style={{ color: MUTED }}>
                  Page {page} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* Right — selected test */}
        <main className="flex-1 min-w-0">
          <div className="rounded-2xl border bg-white p-6 min-h-[420px]" style={{ borderColor: BORDER }}>
            {!selectedId ? (
              <div
                className="h-full flex flex-col items-center justify-center text-center py-16"
                style={{ color: MUTED }}
              >
                <FlaskConical className="h-10 w-10 mb-3 opacity-40" />
                <p className="font-medium">Select a ticket on the left to run its test case.</p>
                <p className="text-xs mt-2">Logged in as {user?.role ?? "unknown"}</p>
              </div>
            ) : (
              <TicketTestPanel ticketId={selectedId} ctx={ctx} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function DevProgressTestPage() {
  const [unlocked, setUnlockedState] = useState(readUnlocked);

  if (!unlocked) {
    return <DevConsolePasswordGate onUnlock={() => setUnlockedState(true)} />;
  }

  return (
    <DevProgressTestContent
      onLock={() => {
        setUnlocked(false);
        setUnlockedState(false);
      }}
    />
  );
}
