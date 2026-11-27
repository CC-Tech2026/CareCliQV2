"""Chat model factory for the CareCliQ chatbox ("Quill").

CHATBOX_LLM_PROVIDER picks which provider is tried first (default
"anthropic"), mirroring the key-resolution order already used in
``app.services.ai_service.get_anthropic_client()``: prefer Replit AI
Integrations (no user key required), fall back to a direct ANTHROPIC_API_KEY.

graph.py tries the preferred provider first and automatically falls back to
the other one if the call fails (billing, rate limit, outage, etc) — see
ask_quill()'s provider loop. This module just builds a model for a given
provider; it doesn't decide which one to use.
"""

import os

from langchain_anthropic import ChatAnthropic
from langchain_core.callbacks import BaseCallbackHandler
from langchain_openai import ChatOpenAI

from ...core.config import settings
from ..ai_usage_guard import consume_ai_call
from ..quill_credits import ModelUsage

CHATBOX_MODEL = "claude-opus-5-5"

# How hard Claude thinks before answering. Quill's questions are lookups that
# take one to three tool calls, where "low" answers fastest with fewer, better
# grouped tool calls; raise it with CHATBOX_EFFORT if answers need more care.
# Thinking itself is always on for this model and is not configured here.
CHATBOX_EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")
DEFAULT_EFFORT = "low"

# Room for the reply plus Claude's thinking on a turn. Replies are a sentence
# or two (the figures go in cards and tables), so this is never the limit in
# practice; it only stops a runaway turn.
CHATBOX_MAX_TOKENS = 8000

# Matches the model already used elsewhere in this codebase (ai_service.py).
CHATBOX_MODEL_OPENAI = "gpt-4o-mini"

PROVIDERS = ("anthropic", "openai")


class MeterModelCalls(BaseCallbackHandler):
    """Counts each model step of a Quill answer toward the asker's AI usage
    limits (one question can take several steps of tool calls), and stops
    the answer once they're reached."""

    raise_error = True  # let the limit stop the call instead of being logged
    run_inline = True   # run in the request's context, where the user is known

    def __init__(self, usage_sink: list | None = None, model: str = ""):
        super().__init__()
        # Each model step's token use, for the answer's credit charge.
        self.usage_sink = usage_sink
        self.model = model

    def on_chat_model_start(self, serialized, messages, **kwargs):
        consume_ai_call("quill")

    def on_llm_end(self, response, **kwargs):
        if self.usage_sink is None:
            return
        for generations in getattr(response, "generations", None) or []:
            for gen in generations:
                usage = getattr(getattr(gen, "message", None), "usage_metadata", None) or {}
                if not usage:
                    continue
                details = usage.get("input_token_details") or {}
                self.usage_sink.append(ModelUsage(
                    model=self.model,
                    input_tokens=int(usage.get("input_tokens") or 0),
                    cached_input_tokens=int(details.get("cache_read") or 0),
                    cache_write_tokens=int(details.get("cache_creation") or 0),
                    output_tokens=int(usage.get("output_tokens") or 0),
                ))


def chatbox_effort() -> str:
    configured = (os.environ.get("CHATBOX_EFFORT") or "").strip().lower()
    return configured if configured in CHATBOX_EFFORT_LEVELS else DEFAULT_EFFORT


def _get_anthropic_chat_model(usage_sink: list | None = None) -> ChatAnthropic:
    base_url = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_BASE_URL")
    integ_key = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_API_KEY")

    # No temperature: this model rejects sampling settings with a 400, which
    # used to fail every Claude call and send each question to the fallback.
    kwargs: dict = {
        "model": CHATBOX_MODEL,
        "max_tokens": CHATBOX_MAX_TOKENS,
        "output_config": {"effort": chatbox_effort()},
        # Caches the conversation so far on each step of a multi-tool answer,
        # so the next step reads it back cheaply instead of paying for it
        # again. graph.py also marks the fixed instructions for caching.
        "model_kwargs": {"cache_control": {"type": "ephemeral"}},
        "callbacks": [MeterModelCalls(usage_sink, CHATBOX_MODEL)],
    }
    if base_url and integ_key:
        kwargs["anthropic_api_key"] = integ_key
        kwargs["anthropic_api_url"] = base_url
    else:
        kwargs["anthropic_api_key"] = settings.anthropic_api_key

    return ChatAnthropic(**kwargs)


def _get_openai_chat_model(usage_sink: list | None = None) -> ChatOpenAI:
    return ChatOpenAI(
        model=CHATBOX_MODEL_OPENAI,
        api_key=settings.openai_api_key,
        temperature=0,
        # A drafted report is the longest thing Quill writes; this stops a
        # runaway answer from costing more than a few credits.
        max_tokens=4000,
        stream_usage=True,
        callbacks=[MeterModelCalls(usage_sink, CHATBOX_MODEL_OPENAI)],
    )


def get_chat_model(provider: str | None = None, usage_sink: list | None = None):
    """Builds a chat model for the given provider ("anthropic" or "openai"),
    defaulting to the configured preferred provider (CHATBOX_LLM_PROVIDER)."""
    resolved = provider or settings.chatbox_llm_provider
    if resolved == "openai":
        return _get_openai_chat_model(usage_sink)
    return _get_anthropic_chat_model(usage_sink)


def fallback_provider(provider: str) -> str:
    """The other provider — used when the preferred one fails."""
    return "openai" if provider == "anthropic" else "anthropic"


def preferred_provider() -> str:
    configured = settings.chatbox_llm_provider
    return configured if configured in PROVIDERS else "anthropic"
