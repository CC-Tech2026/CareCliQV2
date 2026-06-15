/**
 * Private dev / QA console — not linked in nav.
 * Route: /dev/progress-test (bookmark + password only)
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const PLUM = "#5533CC";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const APP_BG = "#F5F3FC";
const ACTIVE = "#EDEAFF";
const BORDER = "#E2DEF2";
const TICKETS_PER_PAGE = 5;

const DEV_CONSOLE_PASSWORD = (
  import.meta.env.VITE_DEV_CONSOLE_PASSWORD as string | undefined
)?.trim() ?? "";

const UNLOCK_STORAGE_KEY = "ccq_dev_progress_console_unlocked";

const DEMO_JAMES_PARTICIPANT = "0ac8f871-6ca6-4a73-a300-eac933d07232";
const DEMO_JAMES_DRAFT_SESSION = "a1000001-0000-4000-8000-000000000099";

type TicketId =
  | "CARECLIQV2-72"
  | "CARECLIQV2-74"
  | "CARECLIQV2-79"
  | "CARECLIQV2-78"
  | "CARECLIQV2-76"
  | "CARECLIQV2-33";

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
];

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
              <Input
                id="dev-console-password"
                type="password"
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
