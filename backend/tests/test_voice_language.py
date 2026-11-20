from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.app.services import ai_service


@pytest.mark.parametrize(
    ("heard", "code"),
    [("french", "fr"), ("Vietnamese", "vi"), ("english", "en"), ("fr", "fr"), ("klingon", None), (None, None)],
)
def test_whisper_language_names_map_to_note_language_codes(heard, code):
    assert ai_service.whisper_language_code(heard) == code


@pytest.mark.asyncio
async def test_voice_note_reports_the_language_it_heard():
    with patch.object(ai_service, "_transcribe_openai_whisper_detailed_sync", return_value=("Liam a bien mangé.", "fr")):
        text, language = await ai_service.transcribe_audio_with_language(b"audio", "note.m4a")
    assert (text, language) == ("Liam a bien mangé.", "fr")


@pytest.mark.asyncio
async def test_fallback_transcript_has_unknown_language():
    with patch.object(ai_service, "_transcribe_openai_whisper_detailed_sync", side_effect=RuntimeError("down")), patch.object(
        ai_service, "transcribe_audio", AsyncMock(return_value="Liam ate well.")
    ):
        text, language = await ai_service.transcribe_audio_with_language(b"audio", "note.m4a")
    assert (text, language) == ("Liam ate well.", None)
