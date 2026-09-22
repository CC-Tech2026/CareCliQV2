"""
Quill's system prompt carries the real current date/time.

A language model has no reliable sense of "today" on its own — it will
guess from patterns in its training data, which drifts from the truth.
Quill's tools (get_shift_progress_note, the progress-note ZIP exports)
take shift_date / date_from / date_to as plain strings the model has to
write itself, so if the model's idea of "today" is wrong, "show me
yesterday's note" silently queries the wrong day. graph.py fixes this by
stamping the real clock into the system prompt before every call.
"""
from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from backend.app.services.chatbox import graph as chatbox_graph

MELBOURNE = ZoneInfo("Australia/Melbourne")


def test_current_datetime_line_uses_the_asker_branch_zone():
    with patch.object(chatbox_graph, "request_timezone", return_value=MELBOURNE):
        line = chatbox_graph._current_datetime_line()

    now_melbourne = datetime.now(MELBOURNE)
    assert now_melbourne.strftime("%A, %d %B %Y") in line
    assert "Current date and time" in line


def test_system_prompt_tells_the_model_not_to_guess_the_date():
    """Asserts on the exact string handed to create_react_agent, rather
    than langgraph's internal graph state, which isn't stable to introspect
    across versions."""
    with patch.object(chatbox_graph, "request_timezone", return_value=MELBOURNE), \
         patch.object(chatbox_graph, "create_react_agent") as mock_create:
        chatbox_graph._build_agent("anthropic", tools=[])

    passed_prompt = mock_create.call_args.kwargs["prompt"]
    assert "never from your own" in passed_prompt
    assert "Current date and time" in passed_prompt
    assert datetime.now(MELBOURNE).strftime("%d %B %Y") in passed_prompt


def test_build_agent_computes_the_date_fresh_each_call():
    """Two calls a "day" apart must not reuse a stale date — _build_agent
    must recompute it every time, not cache it at import/module load."""
    calls = []

    def fake_create_react_agent(*, model, tools, prompt):
        calls.append(prompt)
        return object()

    with patch.object(chatbox_graph, "create_react_agent", side_effect=fake_create_react_agent), \
         patch.object(chatbox_graph, "request_timezone", return_value=MELBOURNE):
        with patch.object(chatbox_graph, "datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 9, 15, 10, 0, tzinfo=MELBOURNE)
            chatbox_graph._build_agent("anthropic", tools=[])
            mock_dt.now.return_value = datetime(2026, 9, 16, 10, 0, tzinfo=MELBOURNE)
            chatbox_graph._build_agent("anthropic", tools=[])

    assert "15 September 2026" in calls[0]
    assert "16 September 2026" in calls[1]
