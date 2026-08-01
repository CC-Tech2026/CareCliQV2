"""Chat model factory for the CareCliQ chatbox ("Quill").

Production default is Anthropic, mirroring the key-resolution order already
used in ``app.services.ai_service.get_anthropic_client()``: prefer Replit AI
Integrations (no user key required), fall back to a direct ANTHROPIC_API_KEY.

Set CHATBOX_LLM_PROVIDER=openai to use OpenAI instead — a testing fallback
for when the Anthropic account has no credit balance, not a production path.
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


def get_chat_model():
    if settings.chatbox_llm_provider == "openai":
        return _get_openai_chat_model()
    return _get_anthropic_chat_model()
