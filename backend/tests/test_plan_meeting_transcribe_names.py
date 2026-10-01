"""Easy Capture sends the speaker names as form fields with the audio; they
must reach name resolution (they were read from the query string and lost)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.api import plan_meetings
from backend.app.core.security import get_current_user
from backend.app.main import app

MD = {"sub": "md-1", "id": "md-1", "role": "managing_director", "organization_id": "org-1"}


def test_names_sent_with_the_audio_reach_name_resolution():
    client_db = MagicMock()
    client_db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"id": "s1", "meeting_type": "meet_greet", "conversation_context": {}}])
    )
    whisper = MagicMock()
    whisper.audio.transcriptions.create.return_value = SimpleNamespace(text="Hello Liam, thanks for coming in.")
    stage_1 = AsyncMock(side_effect=ValueError("stop here"))

    app.dependency_overrides[get_current_user] = lambda: MD
    try:
        with patch.object(plan_meetings, "get_supabase_admin", return_value=client_db), \
             patch.object(plan_meetings, "_build_openai_client", return_value=whisper), \
             patch("backend.app.services.plan_meeting_service.run_stage_1_name_resolution", stage_1):
            TestClient(app).post(
                "/api/coordinator/plan-meetings/s1/transcribe-and-resolve",
                files={"audio_file": ("recording.webm", b"\x1aE\xdf\xa3" * 400, "audio/webm")},
                data={"coordinator_name": "Alex Director", "participant_name": "Liam Carter", "others": '["Priya"]'},
            )
    finally:
        app.dependency_overrides.clear()

    names = stage_1.call_args.kwargs["prefilled_names"]
    assert {"name": "Alex Director", "role": "coordinator"} in names
    assert {"name": "Liam Carter", "role": "participant"} in names
    assert {"name": "Priya", "role": "other"} in names
