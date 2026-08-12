"""LangSmith tracing setup for the CareCliQ chatbox ("Quill").

LangSmith reads its config from environment variables the first time it's
asked whether tracing is enabled, and caches that lookup (lru_cache) for the
life of the process — so this must run at import time, before any agent is
built, not lazily inside a request handler.
"""

import os

from ...core.config import settings


def setup_tracing() -> None:
    if not settings.langsmith_tracing_enabled:
        return
    if not settings.langsmith_api_key:
        return
    os.environ["LANGSMITH_TRACING_V2"] = "true"
    os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
    os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project


setup_tracing()
