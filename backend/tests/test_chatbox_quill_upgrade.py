"""
Quill for managing directors, and the changes that made it faster and smarter.

- The Claude model is built without sampling settings (the model rejects
  them, which used to fail every Claude call and send each question to the
  fallback provider), with a set effort level and prompt caching.
- The system prompt knows whether it's talking to the director or a
  coordinator, and keeps the clock out of the cached part.
- The reply is read as text even when Claude returns thinking blocks too,
  and an empty reply moves on to the other provider.
- Tools called together for one question share one fetch of sessions,
  participants and staff.
- Three director tools: finances, expiring credentials, a participant brief.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from backend.app.services.chatbox import blocks as chatbox_blocks
from backend.app.services.chatbox import db as chatbox_db
from backend.app.services.chatbox import graph as chatbox_graph
from backend.app.services.chatbox import llm as chatbox_llm
from backend.app.services.chatbox import tools as chatbox_tools

TODAY = date(2026, 11, 22)


@pytest.fixture(autouse=True)
def _quill_jwt_secret():
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", "test-jwt-secret-" + "x" * 40):
        yield


def _user(role: str, org_id: str | None = None) -> dict:
    uid = str(uuid.uuid4())
    return {"id": uid, "sub": uid, "organization_id": org_id or str(uuid.uuid4()), "role": role}


def _tools(user: dict) -> dict:
    return {t.name: t for t in chatbox_tools.build_tools_for_user(user, "thread-1")}


@pytest.fixture
def audit():
    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        yield mock_audit


# ── Model settings ───────────────────────────────────────────────────────────

def test_claude_request_has_no_temperature_and_uses_effort_and_caching(monkeypatch):
    monkeypatch.delenv("CHATBOX_EFFORT", raising=False)
    monkeypatch.delenv("AI_INTEGRATIONS_ANTHROPIC_BASE_URL", raising=False)
    with patch.object(chatbox_llm.settings, "anthropic_api_key", "sk-ant-test"):
        model = chatbox_llm.get_chat_model("anthropic")

    assert model.model == "claude-opus-5-5"
    payload = model._get_request_payload([HumanMessage("hi")])
    assert "temperature" not in payload, "this model returns a 400 for any temperature"
    assert payload["output_config"] == {"effort": "low"}
    assert payload["cache_control"] == {"type": "ephemeral"}
    assert payload["max_tokens"] == chatbox_llm.CHATBOX_MAX_TOKENS


def test_effort_can_be_raised_but_not_set_to_nonsense(monkeypatch):
    monkeypatch.setenv("CHATBOX_EFFORT", "HIGH")
    assert chatbox_llm.chatbox_effort() == "high"
    monkeypatch.setenv("CHATBOX_EFFORT", "turbo")
    assert chatbox_llm.chatbox_effort() == "low"


# ── System prompt ────────────────────────────────────────────────────────────

def test_claude_prompt_caches_the_instructions_and_keeps_the_clock_after_them():
    prompt = chatbox_graph._system_prompt("anthropic", _user("managing_director"))
    assert isinstance(prompt, SystemMessage)
    instructions, clock = prompt.content
    assert instructions["cache_control"] == {"type": "ephemeral"}
    assert "Current date and time" not in instructions["text"], "the clock would break the cache every minute"
    assert "Current date and time" in clock["text"]
    assert "cache_control" not in clock


def test_prompt_knows_who_it_is_talking_to():
    md = chatbox_graph.prompt_text(chatbox_graph._system_prompt("anthropic", _user("managing_director")))
    coordinator = chatbox_graph.prompt_text(chatbox_graph._system_prompt("anthropic", _user("support_coordinator")))
    assert "managing director" in md and "support coordinator" not in md
    assert "support coordinator" in coordinator


def test_openai_prompt_is_plain_text_without_cache_marks():
    prompt = chatbox_graph._system_prompt("openai", _user("managing_director"))
    assert isinstance(prompt, str)
    assert "Current date and time" in prompt


def test_instructions_are_identical_between_questions_so_they_cache():
    md = _user("managing_director")
    first = chatbox_graph._system_prompt("anthropic", md).content[0]["text"]
    second = chatbox_graph._system_prompt("anthropic", md).content[0]["text"]
    assert first == second


# ── Reply handling ───────────────────────────────────────────────────────────

def test_reply_text_skips_thinking_blocks():
    message = AIMessage(content=[
        {"type": "thinking", "thinking": "", "signature": "abc"},
        {"type": "text", "text": "Revenue is **$12,400** this month."},
    ])
    assert chatbox_graph._reply_text(message) == "Revenue is **$12,400** this month."


def _fake_agent(reply_content):
    agent = MagicMock()

    async def ainvoke(state):
        return {"messages": [*state["messages"], AIMessage(content=reply_content)]}

    agent.ainvoke = AsyncMock(side_effect=ainvoke)
    return agent


@pytest.mark.asyncio
async def test_an_empty_reply_moves_on_to_the_other_provider():
    built = []

    def build(provider, tools, current_user=None, answer_style=None):
        built.append(provider)
        return _fake_agent([] if provider == "anthropic" else "Three workers are on shift.")

    with patch.object(chatbox_graph, "build_tools_for_user", return_value=[]), \
         patch.object(chatbox_graph, "load_history", AsyncMock(return_value=[])), \
         patch.object(chatbox_graph, "save_turn", AsyncMock()) as save, \
         patch.object(chatbox_graph, "preferred_provider", return_value="anthropic"), \
         patch.object(chatbox_graph, "_build_agent", side_effect=build):
        reply, blocks, _ = await chatbox_graph.ask_quill(_user("managing_director"), "Who's on shift?", "t1")

    assert built == ["anthropic", "openai"]
    assert reply == "Three workers are on shift."
    assert save.await_args_list[-1].args[-1] == "Three workers are on shift."


@pytest.mark.asyncio
async def test_long_threads_send_only_recent_turns_starting_with_a_question():
    history = []
    for i in range(30):
        history.append({"role": "user", "content": f"q{i}", "created_at": ""})
        history.append({"role": "assistant", "content": f"a{i}", "created_at": ""})
    agent = _fake_agent("ok")

    with patch.object(chatbox_graph, "build_tools_for_user", return_value=[]), \
         patch.object(chatbox_graph, "load_history", AsyncMock(return_value=history[1:])), \
         patch.object(chatbox_graph, "save_turn", AsyncMock()), \
         patch.object(chatbox_graph, "_build_agent", return_value=agent):
        await chatbox_graph.ask_quill(_user("managing_director"), "next", "t1")

    sent = agent.ainvoke.await_args.args[0]["messages"]
    assert len(sent) <= chatbox_graph.MAX_HISTORY_TURNS + 1
    assert sent[0]["role"] == "user"
    assert sent[-1] == {"role": "user", "content": "next"}


# ── Shared fetches ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tools_called_together_load_the_sessions_once(audit):
    md = _user("managing_director")
    sessions = [{"worker_id": "w1", "compliance_score": 90, "session_date": "2026-11-22T01:00:00+00:00"}]
    load_sessions = AsyncMock(return_value=sessions)
    with patch.object(chatbox_tools.session_service, "get_sessions_for_dashboard", load_sessions), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[])):
        tools = _tools(md)
        await asyncio.gather(
            tools["get_compliance_snapshot"].coroutine(),
            tools["get_rp_flag_count"].coroutine(),
            tools["get_session_activity"].coroutine(),
        )
    assert load_sessions.await_count == 1


@pytest.mark.asyncio
async def test_each_question_fetches_fresh_data(audit):
    md = _user("managing_director")
    load = AsyncMock(return_value=[{"id": "p1"}])
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", load):
        await _tools(md)["get_participant_count"].coroutine()
        await _tools(md)["get_participant_count"].coroutine()
    assert load.await_count == 2


# ── Which tools each role gets ───────────────────────────────────────────────

def test_director_tools_are_not_offered_to_coordinators():
    with patch.object(chatbox_tools, "get_coordinator_team_ids", return_value=set()):
        coordinator = set(_tools(_user("support_coordinator")))
    md = set(_tools(_user("managing_director")))
    for name in ("get_financial_overview", "get_participant_overview", "get_revenue_summary"):
        assert name in md
        assert name not in coordinator
    assert "get_expiring_credentials" in md and "get_expiring_credentials" in coordinator


# ── get_expiring_credentials ─────────────────────────────────────────────────

def _cred(user_id, title, expiry, ctype="first_aid", status="valid"):
    return {"id": str(uuid.uuid4()), "user_id": user_id, "title": title, "credential_type": ctype,
            "expiry_date": expiry, "status": status}


@pytest.mark.asyncio
async def test_expiring_credentials_ignores_renewed_and_rejected_ones(audit):
    md = _user("managing_director")
    rows = [
        _cred("w1", "First aid (old)", "2026-10-01", status="expired"),
        _cred("w1", "First aid (renewed)", "2029-10-01"),
        _cred("w2", "Worker screening", "2026-12-05", ctype="ndis_worker_screening"),
        _cred("w2", "Police check", "2026-11-01", ctype="police_check"),
        _cred("w3", "Rejected upload", "2026-11-10", status="rejected"),
        _cred("ex-staff", "First aid", "2026-11-10"),
    ]
    team = [{"id": "w1", "full_name": "Ana Lee"}, {"id": "w2", "full_name": "Ben Ford"}, {"id": "w3", "full_name": "Cy Ho"}]
    with patch.object(chatbox_tools.credential_verification_service, "list_credential_expiries", return_value=rows), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=team)), \
         patch.object(chatbox_tools, "app_today", return_value=TODAY):
        result, _ = await _tools(md)["get_expiring_credentials"].coroutine(days_ahead=30)

    titles = [c["credential"] for c in result["credentials"]]
    assert titles == ["Police check", "Worker screening"]
    assert result["expired_count"] == 1 and result["expiring_count"] == 1
    assert result["credentials"][0]["days_left"] == -21
    assert "number" not in result["credentials"][0]


@pytest.mark.asyncio
async def test_expiring_credentials_for_a_coordinator_cover_only_their_team(audit):
    coordinator = _user("support_coordinator")
    rows = [_cred("mine", "First aid", "2026-11-30"), _cred("theirs", "First aid", "2026-11-30")]
    team_members = AsyncMock(return_value=[{"id": "mine", "full_name": "My Worker"}])
    with patch.object(chatbox_tools, "get_coordinator_team_ids", return_value={"mine"}), \
         patch.object(chatbox_tools.credential_verification_service, "list_credential_expiries", return_value=rows), \
         patch.object(chatbox_tools, "_team_members", team_members), \
         patch.object(chatbox_tools, "app_today", return_value=TODAY):
        result, _ = await _tools(coordinator)["get_expiring_credentials"].coroutine()

    assert result["scope"] == "your team"
    assert [c["worker_name"] for c in result["credentials"]] == ["My Worker"]
    assert team_members.await_args.args[1] == {"mine"}


# ── get_financial_overview ───────────────────────────────────────────────────

FIN = {
    "period_label": "November 2026", "period_start": "2026-11-01", "period_end": "2026-11-30",
    "invoice_count": 4, "billed_cents": 1_240_000, "collected_cents": 800_000,
    "outstanding_cents": 440_000, "overdue_cents": 120_000, "session_count": 40,
    "cost_per_session_cents": 15_000,
    "profit_and_loss": {"wages_cents": 600_000, "overheads_cents": None, "net_profit_cents": 640_000,
                        "margin_pct": 51.6, "wages_complete": True, "overheads_set": False},
    "cash": {"on_hand_cents": None},
    "revenue_by_month": [
        {"month": "2026-10", "billed_cents": 1_000_000, "collected_cents": 900_000, "wages_cents": 500_000, "net_cents": 500_000, "future": False},
        {"month": "2026-11", "billed_cents": 1_240_000, "collected_cents": 800_000, "wages_cents": 600_000, "net_cents": 640_000, "future": False},
        {"month": "2026-12", "billed_cents": 0, "collected_cents": 0, "wages_cents": None, "net_cents": None, "future": True},
    ],
}


@pytest.mark.asyncio
async def test_financial_overview_is_in_dollars_and_flags_missing_figures(audit):
    md = _user("managing_director")
    with patch.object(chatbox_tools.financial_summary_service, "get_financial_summary", return_value=FIN) as fin:
        result, _ = await _tools(md)["get_financial_overview"].coroutine(period="Month")

    assert fin.call_args.args[1] == "month"
    assert result["billed_aud"] == 12_400.0
    assert result["overdue_aud"] == 1_200.0
    assert result["net_profit_aud"] == 6_400.0
    assert [m["month"] for m in result["monthly"]] == ["2026-10", "2026-11"], "future months are left out"
    assert any("overheads" in n for n in result["notes"])
    assert any("Cash on hand" in n for n in result["notes"])

    blocks = chatbox_blocks.build_blocks("get_financial_overview", result)
    assert blocks[0]["value"] == "$12,400.00"
    chart = next(b for b in blocks if b["type"] == "bar_chart")
    assert [s["key"] for s in chart["series"]] == ["billed_aud", "wages_aud"]


@pytest.mark.asyncio
async def test_financial_overview_rejects_a_bad_period_and_non_directors(audit):
    md = _user("managing_director")
    result, _ = await _tools(md)["get_financial_overview"].coroutine(period="decade")
    assert "error" in result

    # Coordinators are never offered the tool (see above); if one somehow
    # reached it, it still refuses rather than load the figures.
    tool = _tools(md)["get_financial_overview"]
    with patch.object(chatbox_tools, "is_managing_director", return_value=False), \
         patch.object(chatbox_tools.financial_summary_service, "get_financial_summary") as fin:
        result, _ = await tool.coroutine(period="month")
    assert "error" in result
    fin.assert_not_called()


# ── get_participant_overview ─────────────────────────────────────────────────

OVERVIEW = {
    "participant": {"id": "p1", "full_name": "Jordan Smith", "phone": "0400 000 000", "email": "j@example.com",
                    "ndis_number": "430000000", "date_of_birth": "1990-01-01", "address": "1 Main St",
                    "plan_end_date": "2027-01-10", "risk_level": "medium"},
    "intake": {"status": "active"},
    "team": {"coordinator": {"id": "c1", "name": "Casey"}, "main_worker": {"id": "w1", "name": "Ana Lee"}, "backups": []},
    "funding": {"total": 50_000.0, "used": 30_000.0, "remaining": 20_000.0, "percent_used": 60.0,
                "percent_time_elapsed": 45.0, "ahead_by": 15.0,
                "categories": [{"label": "Core", "allocated": 40_000.0, "used": 28_000.0, "remaining": 12_000.0,
                                "percent_used": 70.0, "overspent": False}]},
    "delivery": {"completed_30d": 12, "cancelled_30d": 1, "hours_30d": 36.0, "upcoming_14d": 6, "unfilled_14d": 2,
                 "next_shift": None, "last_shift_at": None},
    "quality": {"notes_30d": 12, "average_score": 88.0, "needs_attention_30d": 1},
    "risk": {"incidents_total": 2, "incidents_open": [], "complaints_open": []},
    "medication": {"active": 2, "pending_verification": 0, "high_risk": 0, "prn": 1},
    "agreement": {"status": "active", "start_date": "2026-01-10", "end_date": "2027-01-10"},
    "decisions": [{"tone": "danger", "title": "2 upcoming shifts have no worker", "detail": "In the next 14 days."},
                  {"tone": "warning", "title": "No backup worker", "detail": "If the key worker is away..."}],
}


@pytest.mark.asyncio
async def test_participant_overview_leaves_out_contact_and_identity_details(audit):
    md = _user("managing_director")
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light",
                      AsyncMock(return_value=[{"id": "p1", "full_name": "Jordan Smith"}])), \
         patch.object(chatbox_tools.director_participant_service, "build_overview", AsyncMock(return_value=OVERVIEW)):
        result, _ = await _tools(md)["get_participant_overview"].coroutine(participant_name="jordan")

    flat = repr(result)
    for secret in ("0400 000 000", "j@example.com", "430000000", "1990-01-01", "1 Main St"):
        assert secret not in flat
    assert result["team"]["key_worker"] == "Ana Lee"
    assert result["needs_decision"][0]["urgency"] == "urgent"

    blocks = chatbox_blocks.build_blocks("get_participant_overview", result)
    titles = [b.get("title") for b in blocks if b["type"] == "table"]
    assert titles == ["Funding by support category", "Needs a decision"]
    assert blocks[0]["value"] == "60.0%" and blocks[0]["target"] == "45.0% of plan time"


@pytest.mark.asyncio
async def test_participant_overview_asks_which_one_when_two_people_share_a_name(audit):
    md = _user("managing_director")
    same = [{"id": "p1", "full_name": "Sam Lee"}, {"id": "p2", "full_name": "Sam Lee"}]
    build = AsyncMock()
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=same)), \
         patch.object(chatbox_tools.director_participant_service, "build_overview", build):
        result, _ = await _tools(md)["get_participant_overview"].coroutine(participant_name="Sam Lee")

    assert "error" in result and result["candidates"] == ["Sam Lee", "Sam Lee"]
    build.assert_not_awaited()


def test_exact_name_wins_over_partial_matches():
    people = [{"full_name": "Sam Lee"}, {"full_name": "Samantha Lee"}]
    assert chatbox_tools._name_candidates(people, "sam lee") == [{"full_name": "Sam Lee"}]
    assert len(chatbox_tools._name_candidates(people, "lee")) == 2


# ── Follow-up questions ──────────────────────────────────────────────────────

from backend.app.services.chatbox import followups as chatbox_followups  # noqa: E402
from backend.app.services.chatbox import memory as chatbox_memory  # noqa: E402


def test_follow_ups_come_from_the_tools_that_answered():
    out = chatbox_followups.follow_ups(["get_financial_overview"], is_director=True, asked="How are we going?")
    assert out[0] == "How does this quarter look?"
    assert len(out) <= chatbox_followups.MAX_FOLLOW_UPS


def test_coordinators_are_never_offered_director_questions():
    out = chatbox_followups.follow_ups(
        ["get_participant_overview", "get_financial_overview"], is_director=False, asked="x",
    )
    assert "How are we tracking financially this month?" not in out
    assert all("quarter" not in q for q in out)


def test_the_question_just_asked_is_not_offered_again():
    out = chatbox_followups.follow_ups(
        ["get_compliance_snapshot"], is_director=True, asked="which credentials expire in the next 30 days",
    )
    assert "Which credentials expire in the next 30 days?" not in out


@pytest.mark.asyncio
async def test_ask_quill_returns_follow_ups_and_saves_the_blocks():
    from langchain_core.messages import ToolMessage

    md = _user("managing_director")
    agent = MagicMock()

    async def ainvoke(state):
        return {"messages": [
            *state["messages"],
            ToolMessage(content="{}", tool_call_id="c1", name="get_expiring_credentials",
                        artifact={"scope": "organisation-wide", "days_ahead": 30, "expired_count": 1,
                                  "expiring_count": 0, "credentials": []}),
            AIMessage(content="One credential has expired."),
        ]}

    agent.ainvoke = AsyncMock(side_effect=ainvoke)
    with patch.object(chatbox_graph, "build_tools_for_user", return_value=[]), \
         patch.object(chatbox_graph, "load_history", AsyncMock(return_value=[])), \
         patch.object(chatbox_graph, "save_turn", AsyncMock()) as save, \
         patch.object(chatbox_graph, "_build_agent", return_value=agent):
        reply, blocks, suggestions = await chatbox_graph.ask_quill(md, "Which credentials expire?", "t1")

    assert blocks and blocks[0]["type"] == "stat"
    assert suggestions[0] == "What expires in the next 90 days?"
    assert save.await_args_list[-1].kwargs["blocks"] == blocks


# ── Saved blocks, before and after migration 269 ─────────────────────────────

class _Table:
    """A stand-in for the Supabase table builder that can pretend the
    blocks column doesn't exist yet."""

    def __init__(self, has_blocks_column: bool, rows: list[dict] | None = None):
        self.has_blocks = has_blocks_column
        self.rows = rows or []
        self.inserted: list[dict] = []
        self._columns = ""
        self._insert = None

    def select(self, columns):
        self._columns, self._insert = columns, None
        return self

    def insert(self, row):
        self._insert = row
        return self

    def eq(self, *_):
        return self

    def order(self, *_):
        return self

    def execute(self):
        missing = Exception("column chatbox_messages.blocks does not exist (42703)")
        if self._insert is not None:
            if "blocks" in self._insert and not self.has_blocks:
                raise missing
            self.inserted.append(self._insert)
            return MagicMock(data=[self._insert])
        if "blocks" in self._columns and not self.has_blocks:
            raise missing
        return MagicMock(data=self.rows)


def _client(table):
    client = MagicMock()
    client.table.return_value = table
    return client


@pytest.mark.parametrize("has_column", [True, False])
@pytest.mark.asyncio
async def test_answers_save_with_or_without_the_blocks_column(has_column):
    table = _Table(has_column)
    with patch.object(chatbox_memory, "get_supabase_admin", return_value=_client(table)):
        await chatbox_memory.save_turn(_user("managing_director"), "t1", "assistant", "Hi", blocks=[{"type": "stat"}])
    assert len(table.inserted) == 1
    assert ("blocks" in table.inserted[0]) is has_column


@pytest.mark.parametrize("has_column", [True, False])
@pytest.mark.asyncio
async def test_history_loads_with_or_without_the_blocks_column(has_column):
    rows = [{"role": "assistant", "content": "Hi", "created_at": "2026-11-23", **({"blocks": [{"type": "stat"}]} if has_column else {})}]
    table = _Table(has_column, rows)
    with patch.object(chatbox_memory, "get_supabase_admin", return_value=_client(table)):
        history = await chatbox_memory.load_history(_user("managing_director"), "t1")
    assert history[0]["content"] == "Hi"
    assert history[0]["blocks"] == ([{"type": "stat"}] if has_column else [])


# ── Answer length setting ────────────────────────────────────────────────────

def test_detailed_answers_are_asked_for_outside_the_cached_instructions():
    md = _user("managing_director")
    brief = chatbox_graph._system_prompt("anthropic", md, "brief")
    detailed = chatbox_graph._system_prompt("anthropic", md, "detailed")
    # The cached block is identical, so the setting never breaks the cache.
    assert brief.content[0]["text"] == detailed.content[0]["text"]
    assert "detailed answers" in detailed.content[1]["text"]
    assert "detailed answers" not in brief.content[1]["text"]
    assert "detailed answers" in chatbox_graph._system_prompt("openai", md, "detailed")
