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
from langchain_openai import ChatOpenAI

from ...core.config import settings

# Pending confirmation from Monich — update here once the exact model string
# for this project is confirmed.
CHATBOX_MODEL = "claude-sonnet-5"

# Matches the model already used elsewhere in this codebase (ai_service.py).
CHATBOX_MODEL_OPENAI = "gpt-4o-mini"

PROVIDERS = ("anthropic", "openai")


def _get_anthropic_chat_model() -> ChatAnthropic:
    base_url = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_BASE_URL")
    integ_key = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_API_KEY")

    kwargs: dict = {"model": CHATBOX_MODEL, "temperature": 0}
    if base_url and integ_key:
        kwargs["anthropic_api_key"] = integ_key
        kwargs["anthropic_api_url"] = base_url
    else:
        kwargs["anthropic_api_key"] = settings.anthropic_api_key

    return ChatAnthropic(**kwargs)


def _get_openai_chat_model() -> ChatOpenAI:
    return ChatOpenAI(model=CHATBOX_MODEL_OPENAI, api_key=settings.openai_api_key, temperature=0)


def get_chat_model(provider: str | None = None):
    """Builds a chat model for the given provider ("anthropic" or "openai"),
    defaulting to the configured preferred provider (CHATBOX_LLM_PROVIDER)."""
    resolved = provider or settings.chatbox_llm_provider
    if resolved == "openai":
        return _get_openai_chat_model()
    return _get_anthropic_chat_model()


def fallback_provider(provider: str) -> str:
    """The other provider — used when the preferred one fails."""
    return "openai" if provider == "anthropic" else "anthropic"


def preferred_provider() -> str:
    configured = settings.chatbox_llm_provider
    return configured if configured in PROVIDERS else "anthropic"
