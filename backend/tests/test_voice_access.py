"""Voice notes can be limited to listed organisations (VOICE_NOTES_ORG_IDS)
while the speech processing agreements are put in place."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from backend.app.services import voice_access

DEMO = "78f88e07-757b-402e-bf62-f3d40ff6033d"
PILOT = "20c02ba8-2ed7-4484-8d97-28b29089c3cb"


def test_unset_means_only_the_demo_organisations():
    assert voice_access.voice_notes_allowed(DEMO, raw="")
    assert voice_access.voice_notes_allowed("93d13ce5-4607-4150-930b-1528dbc9f91c", raw="   ")
    assert not voice_access.voice_notes_allowed(PILOT, raw="")
    assert not voice_access.voice_notes_allowed("f81f8aa9-9619-4072-8c30-e04503d2ef15", raw="")
    assert not voice_access.voice_notes_allowed("a-brand-new-provider", raw="")


def test_all_turns_voice_back_on_everywhere():
    assert voice_access.voice_notes_allowed(PILOT, raw="all")


def test_only_listed_organisations_when_set():
    raw = f"{DEMO}, 93d13ce5-4607-4150-930b-1528dbc9f91c"
    assert voice_access.voice_notes_allowed(DEMO, raw=raw)
    assert voice_access.voice_notes_allowed(DEMO.upper(), raw=raw)
    assert not voice_access.voice_notes_allowed(PILOT, raw=raw)
    assert not voice_access.voice_notes_allowed(None, raw=raw)


def test_none_switches_voice_off_everywhere():
    assert not voice_access.voice_notes_allowed(DEMO, raw="none")


def test_refused_with_a_plain_message():
    with patch.object(voice_access.settings, "voice_notes_org_ids", DEMO):
        voice_access.require_voice_notes(DEMO)
        with pytest.raises(HTTPException) as info:
            voice_access.require_voice_notes(PILOT)
    assert info.value.status_code == 403
    assert "type your notes" in info.value.detail


@pytest.mark.asyncio
async def test_worker_endpoint_refuses_before_any_audio_is_sent():
    from backend.app.api import worker

    user = {"sub": "w1", "role": "support_worker", "organization_id": PILOT}
    with patch.object(voice_access.settings, "voice_notes_org_ids", DEMO), patch.object(
        worker.ai_service, "transcribe_audio"
    ) as transcribe:
        with pytest.raises(HTTPException) as info:
            await worker.worker_transcribe_session_audio("s1", None, user)
    assert info.value.status_code == 403
    transcribe.assert_not_called()


@pytest.mark.asyncio
async def test_session_endpoint_refuses_before_any_audio_is_sent():
    from backend.app.api import sessions

    user = {"sub": "c1", "role": "support_coordinator", "organization_id": PILOT}
    with patch.object(voice_access.settings, "voice_notes_org_ids", DEMO), patch.object(
        sessions.ai_service, "transcribe_audio"
    ) as transcribe:
        with pytest.raises(HTTPException) as info:
            await sessions.transcribe_audio("s1", None, user)
    assert info.value.status_code == 403
    transcribe.assert_not_called()


@pytest.mark.asyncio
async def test_meeting_recordings_follow_the_same_setting():
    from backend.app.api import plan_meetings

    user = {"sub": "c1", "role": "support_coordinator", "organization_id": PILOT}
    with patch.object(voice_access.settings, "voice_notes_org_ids", DEMO):
        with pytest.raises(HTTPException) as one:
            await plan_meetings.transcribe_plan_meeting_audio(None, user)
        with pytest.raises(HTTPException) as two:
            await plan_meetings.transcribe_and_resolve_names("s1", None, None, None, "[]", user)
    assert one.value.status_code == 403 and two.value.status_code == 403
