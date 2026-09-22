# SOP — Quill Chatbox Setup & Deployment

## 1. Purpose & scope

Procedure for standing up the Quill chatbox (LangGraph agent + Supabase-backed
history) in a new environment — local dev, staging, or production. Covers
prerequisites, setup steps, and verification.

Architecture, tool scoping, and the RLS/service-role security model are
covered in the Appendix at the end of this document.

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| Anthropic API key | The primary provider on a fresh checkout (`CHATBOX_LLM_PROVIDER` defaults to `"anthropic"` — see the caveat in §3 about what's actually configured today). |
| OpenAI API key | **Not just a manual/testing path** — `graph.py`'s `ask_quill()` automatically retries against the *other* provider on any failure (rate limit, outage, insufficient credits), every request, regardless of which one is preferred. If this key is unset, an Anthropic outage takes Quill down completely instead of failing over. Treat it as required for production resilience, not optional. |
| Supabase project (existing) | Same project as the rest of CareCliQ — no separate database. |
| Supabase **legacy JWT secret** | Project Settings → API → *JWT Settings* (newer UI: *JWT Keys* → *Legacy JWT Secret*). Quill's tools do **not** run on the service-role key — `db.py` mints a per-request token for the read-only `quill_agent` Postgres role and signs it with this secret. Without it, every tool call fails closed (`QuillDbNotConfigured`); there is deliberately no fallback to the service role. If your project only shows asymmetric *JWT Signing Keys* and no legacy secret, stop and escalate — the role approach needs HS256. |
| LangSmith account | Optional — only for tracing agent runs. |
| A test user with role `support_coordinator` or `managing_director` | Required to see/use Quill at all — it's role-gated in both the UI and the API (`AppLayout.tsx:651`, `chatbox.py`'s `_require_quill_access`). |

## 3. Setup steps

### Step 1 — Environment variables

Add to the root `.env` (never commit it):

```bash
ANTHROPIC_API_KEY=your-anthropic-api-key      # primary provider
OPENAI_API_KEY=your-openai-api-key            # automatic failover — see prerequisites above
SUPABASE_JWT_SECRET=your-supabase-jwt-secret  # signs the per-request quill_agent token — see prerequisites

# Optional
CHATBOX_LLM_PROVIDER=anthropic                # which one is *preferred*; the other still runs automatically on failure
LANGSMITH_TRACING_ENABLED=false               # set true + LANGSMITH_API_KEY to trace runs
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=carecliq-chatbox
```

> **Verify, don't assume, what's actually configured.** In this repo's current
> dev environment, `CHATBOX_LLM_PROVIDER` is set to `"openai"` — the *reverse*
> of the documented default — meaning GPT-4o-mini is primary and Claude is the
> failover here, not the other way around. Run this before assuming either:
> ```bash
> python3 -c "from app.core.config import settings; print(settings.chatbox_llm_provider)"
> ```

If running on Replit, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` +
`AI_INTEGRATIONS_ANTHROPIC_API_KEY` are checked first and preferred over a
direct `ANTHROPIC_API_KEY` when both are present (`llm.py`) — no extra setup
needed beyond what Replit's own AI Integrations panel provides.

### Step 2 — Database

For a **brand-new** environment: just run the canonical
`backend/supabase_setup.sql` in the Supabase SQL editor — it already includes
`chatbox_messages` (table, index, and the `owner_all` RLS policy), folded in
from migration 101.

For an **existing** environment that predates that fold-in and hasn't run
`supabase_setup.sql` since: apply
`backend/supabase/migrations/101_chatbox_messages.sql` directly instead.
Confirm which situation you're in before picking a path — running the same
table-creation SQL twice is harmless (`CREATE TABLE IF NOT EXISTS`), but
worth knowing which one you actually needed.

**Then, in every environment**, apply
`backend/supabase/migrations/197_quill_agent_role.sql`. It creates the
`quill_agent` role, its read-only grants, and the org-scoped RLS policies
Quill's tools run under (Appendix §J). It is **not** folded into
`supabase_setup.sql` because it grants on `public.shifts`, which that file
doesn't create — run it after the shifts migrations (029 onward). Idempotent;
safe to re-run. Then run the verification block at the bottom of the file
in the SQL editor: you should see rows for one org only, `permission denied`
on `users.email`, on `chatbox_messages`, and on any `DELETE`.

### Step 3 — Install dependencies

```bash
pnpm install                 # frontend workspace (includes FloatingAiAssistant + chatboxService)
cd backend && uv sync        # Python deps — langgraph, langchain-anthropic, langchain-openai, langsmith
```

### Step 4 — Start services

Quill has no separate process — it's part of the existing FastAPI app and the
existing three-terminal dev setup:

```bash
# Terminal 1 — backend
cd backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Node API gateway (Express reverse proxy, no business logic)
cd artifacts/api-server && PORT=8080 node --enable-source-maps dist/index.mjs

# Terminal 3 — frontend
pnpm --filter @workspace/frontend run dev
```

### Step 5 — Confirm role gating

Log in as your `support_coordinator` or `managing_director` test user — the
floating Quill icon should appear
(`AppLayout.tsx:651` → `showQuillAssistant`, rendered at `:1018`). Log in as
any other role and confirm it does **not** appear, and that
`POST /api/chatbox/chat` returns `403`.

## 4. Verification checklist

- [ ] Send a message that requires a tool call (e.g. *"what's our compliance score"*) → reply text + a `stat` block renders
- [ ] Ask something requiring a table (e.g. *"who's on shift right now"*) → `table` block renders
- [ ] Ask a revenue question → `bar_chart` block renders (monthly breakdown)
- [ ] Ask for a shift's progress note or a date-range export → `download` block renders with a working link
- [ ] Refresh the page, reopen the same thread → history persists (confirms the Supabase round-trip, not just in-memory state)
- [ ] `GET /api/chatbox/threads` lists the conversation; `DELETE /threads/{id}` removes it
- [ ] With `SUPABASE_JWT_SECRET` temporarily unset, any tool-backed question returns the generic error and the backend log shows `QuillDbNotConfigured` — proves Quill fails closed rather than silently using the service role. Restore the secret afterwards.
- [ ] Audit log recorded a `chatbox.query` entry and a `chatbox.tool_call` entry per tool actually invoked
- [ ] **As a coordinator**, confirm participant/worker counts are scoped to their own linked team (`users.coordinator_id`), not the whole org — compare against a managing director's view of the same question. This is now covered by an automated test (`test_chatbox_tool_scoping.py`) but worth eyeballing once against real data on a new environment.

## 5. Rollback / disabling Quill

There's no dedicated feature flag today. Options, cleanest first:

1. **Revert the gate.** Set `showQuillAssistant` to `false` in `AppLayout.tsx:651`, or comment out `app.include_router(chatbox.router, ...)` at `main.py:218`. This is the only option that actually removes access — the icon disappears and the endpoint stops responding.
2. **Unset a provider key — not reliable on its own.** Unsetting only `ANTHROPIC_API_KEY` (or only `OPENAI_API_KEY`) does **not** disable Quill if the other key is still set: `ask_quill()`'s automatic failover (§2) will simply run entirely on the remaining provider. Both keys would need to be unset to fail every request, and even then the UI icon still shows and users get a generic "couldn't get that data" error rather than a clean disabled state — not a clean rollback, just a degraded one.

## 6. Known gaps to flag before wider rollout

- `CHATBOX_MODEL` in `llm.py:23` is a literal placeholder — the comment at line 21 says pending confirmation from Monich. Every request today runs on a value nobody has formally signed off.
- No rate limiting on `/chatbox/chat` — every message is a live, uncapped LLM API cost.
- Tool-scoping test coverage now exists for the RAG tools plus a representative sample across the other three scoping shapes (`test_chatbox_rag_scoping.py`, `test_chatbox_tool_scoping.py`), and `test_chatbox_db_role.py` pins the `quill_agent` token contract — but not yet all 16 non-RAG tools individually, and nothing exercises the Postgres grants/RLS themselves (that's the manual verification block in migration 197).
- The `quill_agent` role covers only the seven queries `tools.py` issues directly (`shifts`, `users`, `organization_members`). Helpers Quill borrows — `incident_service.get_incident_stats`, `rag_service.retrieve_similar_*`, `dashboards._team_members`, `participant_service.get_participants_list_light`, `session_service.get_sessions_for_dashboard`, `billing_service.get_revenue_report` — still run on the service-role key because they don't accept an injected client. Moving them is the planned step 2; `memory.py` (chat history) is likewise still service-role.
- The RLS layer enforces the *organisation* boundary only. The coordinator *team* boundary (`users.coordinator_id`) is still Python-only via `_resolve_team_or_org_scope()`.
- MFA is available platform-wide but is a per-user opt-in toggle, not enforced for the `support_coordinator`/`managing_director` roles that can reach Quill and the compliance/incident/revenue data it surfaces.

## 7. Escalation

Model configuration decisions and chatbox feature scope route through
Monich, per the standing TODO in `llm.py`.

---

## Appendix — Architecture reference

### A. About Quill — why not data-agnostic

Quill only ever answers through hand-written, individually-scoped functions
(§B) — it can never write its own SQL. That's deliberate.

Making the chatbox data-agnostic — letting the LLM generate arbitrary
queries — would mean one of two things: either it can **bypass the org/role
scoping logic** already built and trusted elsewhere in this app, or CareCliQ
would have to **reimplement that scoping generically** for arbitrary
queries, which is far harder to get right and audit than the existing,
trusted per-function checks.

For a system handling NDIS participant health data, "the LLM can
technically query anything, but we trust it to behave" is not a safe
design. Every access decision Quill makes is deterministic code — never a
judgment call left to the model. The LLM only ever chooses *which*
pre-approved, pre-scoped function to call; it never decides *what* that
function is allowed to touch.

### B. The 19 tools

`backend/app/services/chatbox/tools.py` defines 19 tools, not 9 — the count
below is current as of `develop` on 2026-09-16; an earlier description of
this file undercounted it by 10 tools added since.

**13 structured data lookups:**

| Tool | Returns | Scope |
|---|---|---|
| `get_compliance_snapshot` | Compliance score, target, workers below the 85 threshold ("at risk") | Team for coordinators, org-wide for MDs |
| `get_incident_summary` | Total, open, critical severity, overdue-for-NDIS-reporting incidents | Org-wide for both roles |
| `get_rp_flag_count` | Sessions flagged for restrictive practice this calendar month — deliberately distinct from incident_summary | Team for coordinators, org-wide for MDs |
| `get_shift_coverage` | Who's on shift right now | Org-wide for both roles |
| `get_shift_schedule` | Roster for a date range, any status (scheduled/completed/cancelled) — plain "what shifts does X have on Y" questions, distinct from the progress-note tools below which only match a *completed, documented* shift | Team for coordinators, org-wide for MDs |
| `get_goal_achievement_rate` | % of participants with an active NDIS plan | Team for coordinators, org-wide for MDs |
| `get_participant_count` / `get_participant_list` | Caseload size / names | Team for coordinators, org-wide for MDs |
| `get_active_worker_count` / `get_active_worker_list` | Active support worker count / names | Team for coordinators, org-wide for MDs |
| `get_session_activity` | Sessions today / this week | Team for coordinators, org-wide for MDs |
| `get_retention_rate` | Staff retention % | Managing director only |
| `get_revenue_summary` | Billing/revenue: this month, all-time, monthly breakdown (AUD) | Org-wide for both roles |

**2 RAG (semantic search) tools:**

| Tool | Returns |
|---|---|
| `search_session_notes` | Semantic search over past session notes |
| `search_incident_history` | Semantic search over past incident reports |

RAG is used only for these two — every other tool has a single deterministic
answer (a number or a list), while these two are meaning-based questions
("find sessions about X"), which a deterministic query can't answer.

**4 file/export tools:**

| Tool | Returns |
|---|---|
| `get_shift_progress_note` | One participant, one date's shift PDF |
| `get_participant_progress_notes_zip` | One participant, a date range, as a ZIP |
| `get_worker_progress_notes_zip` | One worker, a date range, as a ZIP |
| `get_all_progress_notes_zip` | Everyone, a date range, as a ZIP |

### C. Request flow (one message → one reply)

```
User types in FloatingAiAssistant (floating chat widget)
        │
        ▼
POST /api/chatbox/chat  { message, thread_id }
        │
        ▼
chatbox.py → _require_quill_access()  (403 if not coordinator/managing_director)
        │
        ▼
ask_quill(current_user, message, thread_id)      [graph.py]
        │
        ├─ load_history()          ← Supabase chatbox_messages table
        ├─ build_tools_for_user()  ← 18 tools, scoped by closure to this user/org
        ├─ create_react_agent()    ← LangGraph ReAct agent, Claude or GPT-4o-mini
        ├─ agent runs, calling tools as needed (e.g. get_compliance_snapshot)
        ├─ build_blocks() turns each tool's raw dict into stat/table/chart/download blocks
        └─ save_turn() × 2         ← persists user msg + assistant reply
        │
        ▼
ChatResponse { reply, thread_id, blocks }  →  rendered in FloatingAiAssistant
```

1. **`chatbox.py`** — the API entry point. Checks the caller is a support
   coordinator or managing director, calls `ask_quill(...)`, writes an audit
   log. Never talks to the LLM itself — HTTP boundary only.
2. **`graph.py`** — where the LLM is actually called. `ask_quill()` loads
   prior turns, builds a fresh ReAct agent wiring in the model (`llm.py`),
   the 18 tools (`tools.py`), and the system prompt (§F), runs the agent
   loop, turns tool results into blocks (`blocks.py`), and saves the turn
   (`memory.py`).
3. **`llm.py`** — model factory only, no calls happen here (§K).
4. **`tools.py`** — the 18 functions the LLM is allowed to call (§B, §H).
5. **`blocks.py`** — turns tool output into UI blocks, from the raw
   `.artifact` dict only, never the model's prose (§G, §I).
6. **`memory.py`** — conversation history storage, no LLM interaction (§J).
7. **`tracing.py`** — observability only, runs once at import time. If
   `LANGSMITH_TRACING_ENABLED` is set, it sets `LANGSMITH_TRACING_V2` and the
   other LangSmith env vars for LangSmith's own SDK to pick up — zero effect
   on what the model sees or answers.
8. **`__init__.py`** — empty, just makes the folder a package.

**In one sentence:** `chatbox.py` receives the request → `graph.py` loads
history, builds an agent, and calls the LLM → the LLM decides which
functions in `tools.py` to run for real data → `blocks.py` turns that raw
data into UI blocks, bypassing the LLM's prose → `memory.py` saves the turn
→ the reply and blocks go back to the frontend.

### D. The pieces

| Layer | File | Responsibility |
|---|---|---|
| API | `backend/app/api/chatbox.py` | Route handlers, request/response models, role gate, audit calls |
| Agent orchestration | `chatbox/graph.py` | Builds + runs the ReAct agent per request |
| Tools | `chatbox/tools.py` | 18 LangChain `@tool`-decorated functions, closure-scoped |
| Blocks | `chatbox/blocks.py` | Deterministic tool-artifact → UI-block mapping |
| Memory | `chatbox/memory.py` | Supabase-backed thread persistence |
| DB identity | `chatbox/db.py` | Mints the per-request `quill_agent` JWT; builds the read-only PostgREST client the tools query through |
| LLM factory | `chatbox/llm.py` | Anthropic/OpenAI model construction |
| Tracing | `chatbox/tracing.py` | LangSmith env setup, runs once at import |
| Frontend widget | `FloatingAiAssistant.tsx` | Chat UI, thread list, block rendering |
| Frontend client | `chatboxService.ts` | Typed fetch wrappers |
| Schema | `chatbox_messages` table (+ RLS) | Persisted turns — folded into `supabase_setup.sql` (§2) |
| Schema | `quill_agent` role, grants, RLS policies | Migration `197_quill_agent_role.sql` — the database-side ceiling on what tools can read (§J) |

### E. API schemas

```python
class ChatRequest(BaseModel):
    message: str
    thread_id: Optional[str] = None

class ChatResponse(BaseModel):
    reply: str
    thread_id: str
    blocks: list[dict] = []

class ThreadSummary(BaseModel):
    thread_id: str
    title: Optional[str] = None
    updated_at: str
    message_count: int

class ThreadMessage(BaseModel):
    role: str
    content: str
```

`thread_id` is client-optional — if omitted, the server mints a
`uuid.uuid4()`, so a "new conversation" is really just "no `thread_id` sent
yet."

### F. Agent internals

`_build_agent()` calls LangGraph's prebuilt `create_react_agent(model,
tools, prompt)` — the standard "reason → pick a tool → observe result →
repeat until it can answer" loop, not a custom graph. A new agent instance
is compiled on **every** HTTP request, because tools must be rebuilt scoped
to that request's `current_user` via closure — the LLM is never given
`org_id`/`user_id` as parameters it could tamper with; they're baked into
each tool function's closure before the agent ever sees a message.

**System prompt, verbatim (`graph.py`):**

```
You are Quill, the CareCliQ assistant for NDIS support coordinators and
managing directors. You answer plain-English questions about compliance
and operational data using the tools available to you — never guess or
invent numbers.

Rules:
- Always call a tool to get real data before answering any factual question.
- If no tool can answer the question, say so plainly rather than speculating.
- Keep answers concise and in a professional, data-query tone.
- Never reveal data belonging to another organisation.
- Write in plain prose sentences — no bullet lists, no numbered lists. The
detailed data already appears in a table or card below your reply, so your
text only needs to summarise it in one or two sentences. You may use
**double asterisks** around a name or figure to mark it as important.
```

`ask_quill()`'s actual sequence:

1. `load_history()` → list of `{"role": "user"|"assistant", "content": str}` dicts
2. Append the new user message
3. `agent.ainvoke({"messages": messages})` — runs the full ReAct loop, potentially several tool calls in sequence
4. Take the last message as `reply_text`
5. Walk every message in the result; for each `ToolMessage` with a `.name`, call `build_blocks(tool_name, artifact)` and extend the blocks list — a multi-tool-call turn can produce blocks from several tools in one reply
6. Persist both the user message and assistant reply via `save_turn()` — two separate inserts, not one

### G. Tool contract — the `content_and_artifact` trick

Every tool gets wrapped at the bottom of `build_tools_for_user()`:

```python
async def _audited(*args, _name=t.name, _orig=original_coroutine, **kwargs):
    result = await _orig(*args, **kwargs)
    await _log_tool_call(current_user, thread_id, _name, result)
    return result, result

t.coroutine = _audited
t.response_format = "content_and_artifact"
```

Returning `(result, result)` under `content_and_artifact` means LangChain
stores the same dict twice: once as `ToolMessage.content` (what the LLM
reads as text), once as `ToolMessage.artifact` (untouched, never
re-serialized). `blocks.py` only ever reads `.artifact` — a rendered
stat/table number is byte-identical to what the tool actually returned,
immune to the model paraphrasing or hallucinating while narrating.

Every tool returns a dict with a `"scope"` key (`"organisation-wide"` or
`"your team"`) — `_log_tool_call` writes that into the audit row's
`details.scope`, so the audit trail records whether each answer was team-
or org-scoped, not just that a tool ran.

### H. Scoping logic

Two independent axes decide what a tool returns:

- **Role** — `is_managing_director()` vs. `is_coordinator_role()`.
- **Data availability** — some metrics only exist organisation-wide
  anywhere in the app (incidents, shifts, revenue); the tools don't invent a
  narrower view that doesn't exist elsewhere. `get_retention_rate` is
  hard-gated MD-only for the same reason.

**Updated 2026-09-14:** for the 8 tools with the exact team-vs-org shape
(`get_compliance_snapshot`, `get_rp_flag_count`, `get_goal_achievement_rate`,
`get_participant_count`, `get_participant_list`, `get_active_worker_count`,
`get_active_worker_list`, `get_session_activity`), this check is no longer
hand-copied per tool — it's centralized in one shared helper,
`_resolve_team_or_org_scope()`, added specifically because 8 identical
copies of an access check is 8 chances to get one slightly wrong. As of
2026-09-15 there *is* a database-level backstop for the org boundary (§J),
but the team boundary this helper resolves is still Python-only. The helper
also now runs **before** any data fetch in every tool that uses it — six
tools previously loaded participants/sessions first and rejected the caller
afterwards. The remaining tools use a simpler
either-role gate (`get_incident_summary`, `get_shift_coverage`,
`get_revenue_summary`), an MD-only gate (`get_retention_rate`), the 4
export tools' own `Optional[team_worker_ids]` variant, or `has_org_wide_access`
for the 2 RAG tools — each a genuinely different shape, not further
unified.

Team scoping, when it applies, works via `get_coordinator_team_ids()` → a
set of worker IDs (drawn from `users.coordinator_id`, i.e. workers actually
linked to that coordinator) → passed into `_filter_sessions_by_worker_ids` /
`_filter_participants_by_worker_ids` (imported from `app.api.dashboards`,
not reimplemented). Verified live against real data: a coordinator with 8
linked workers correctly sees exactly the 14 participants assigned to those
workers, out of 39 total in the org — never the other 25.

### I. Block shapes

Four shapes exist, not three:

```
{"type": "stat",  "label": str, "value": number|str, "target": number|None}
{"type": "table", "title": str, "columns": [str,...], "rows": [[cell,...],...]}
{"type": "bar_chart", "title": str, "x_key": str,
 "series": [{"key": str, "label": str}], "data": [dict,...]}
{"type": "download", "title": str, "url": str, "count": int|None}
```

The fourth (`download`) renders the 4 export tools' file links (§B) — it was
missing from an earlier description of this file, from before those tools
existed.

`build_blocks()` fails closed: an artifact that isn't a dict, or carries an
`"error"` key, or an unknown tool name → returns `[]`; any exception inside
a builder is also caught → `[]`. Never raises into the response path.

### J. Database identity and RLS

Quill has two very different relationships with the database, and it's
worth being precise about which is which.

**Tools — the `quill_agent` role (migration 197, `db.py`).** Every direct
query in `tools.py` runs as a dedicated, read-only Postgres role rather
than the service-role key. Per request, `db.quill_client(current_user)`
mints a 60-second HS256 JWT signed with `SUPABASE_JWT_SECRET`:

```
{ role: "quill_agent", org_id, user_id, app_role, iss: "carecliq-backend", iat, exp }
```

PostgREST reads `role` to `SET ROLE quill_agent` and exposes the rest via
`request.jwt.claims`, which the RLS policies read through
`public.quill_jwt_org_id()`. The claims come from the *authenticated* user
captured in the tool closure — never from tool arguments — so the LLM has
no way to point a query at another organisation.

What the role can do, enforced by Postgres regardless of the Python:

| | `service_role` (before) | `quill_agent` (now) |
|---|---|---|
| Tables | everything | `shifts`, `organization_members` (5 columns), `users` (6 columns: `id, full_name, role, coordinator_id, organization_id, is_active`) |
| Rows | everything | only `organization_id = org_id` from the token |
| Writes | everything | none — SELECT only |
| Missing/forgotten org filter in a tool | leaks every org | RLS silently narrows to the caller's org |
| Missing `SUPABASE_JWT_SECRET` | n/a | `QuillDbNotConfigured` — the tool errors; no fallback to service role |

The client is a fresh `SyncPostgrestClient` per call (not the shared
singleton), because `auth()` mutates headers and concurrent requests must
never see each other's token.

**What this layer does *not* cover yet.** Only the seven queries `tools.py`
issues itself. The helpers Quill borrows from `incident_service`,
`rag_service`, `dashboards`, `participant_service`, `session_service`, and
`billing_service` still run on the service-role key internally — see §6.
And it enforces the org boundary only; a coordinator's team boundary is
still `_resolve_team_or_org_scope()` in Python.

**Chat history — `chatbox_messages`.** Table:
`chatbox_messages(id, organization_id, user_id, thread_id, role, content,
created_at)`, RLS policy `owner_all` restricts access to `user_id =
auth.uid()`. **`memory.py` still uses the service-role client
(`get_supabase_admin()`), which bypasses that policy entirely.** The real
isolation there is the explicit `.eq("user_id", ...).eq("organization_id",
...)` filter on every query in the file — RLS is a second net for if an
anon/authenticated path is ever added, not today's enforcement. Moving
history onto `quill_agent` (with INSERT/DELETE grants and a `user_id`-claim
policy) is a natural follow-up but out of scope for the tools change.

`list_threads()` derives a thread's title from its first user message
(first 60 chars + `…`), and `updated_at` from the last row's `created_at` —
there's no dedicated "thread" table; threads are purely an aggregation over
`chatbox_messages.thread_id`.

### K. LLM factory resolution order

```python
def get_chat_model(provider=None):
    resolved = provider or settings.chatbox_llm_provider
    if resolved == "openai":
        return _get_openai_chat_model()
    return _get_anthropic_chat_model()   # default
```

`_get_anthropic_chat_model()` prefers Replit's AI Integrations proxy
(`AI_INTEGRATIONS_ANTHROPIC_BASE_URL` + `AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
no user-provided key needed) and falls back to a direct
`settings.anthropic_api_key` — the same key-resolution pattern already used
by `ai_service.get_anthropic_client()` elsewhere in this codebase, not a new
one invented for Quill. `get_chat_model()` only builds a model for a given
provider; `graph.py`'s `ask_quill()` is what actually decides to try the
other one on failure (§2, Prerequisites).

---
*Verified against `develop` on 2026-09-15 — every path, line number, and
config value in this document was checked directly against the running code
and this environment's actual settings, not assumed from an earlier
description.*

