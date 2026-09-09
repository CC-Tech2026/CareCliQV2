"""
Track B — embedding_pipeline: failure-marker discipline, stale-chunk
cleanup, and the schedule() fire-and-forget helper.

A silent embedding failure means a note permanently missing from search, or
stale after an edit, with nothing showing either happened — these tests
assert the failure is always visibly marked (mirroring
sessions.compliance_check_status) and that generation is scheduled in a way
that survives the caller raising an HTTPException afterward, which
FastAPI's BackgroundTasks cannot (see schedule()'s docstring).
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import embedding_pipeline


# ── _mark_embedding_failed / _delete_stale_chunks: query shape ───────────────


def test_mark_embedding_failed_writes_session_status_and_error():
    mock_supabase = MagicMock()
    with patch.object(embedding_pipeline, "get_supabase_admin", return_value=mock_supabase):
        embedding_pipeline._mark_embedding_failed("session", "sess-1", "boom")

    mock_supabase.table.assert_called_once_with("sessions")
    update_mock = mock_supabase.table.return_value.update
    update_mock.assert_called_once_with({"embedding_status": "failed", "embedding_error": "boom"})
    update_mock.return_value.eq.assert_called_once_with("id", "sess-1")


def test_mark_embedding_failed_writes_incident_table():
    mock_supabase = MagicMock()
    with patch.object(embedding_pipeline, "get_supabase_admin", return_value=mock_supabase):
        embedding_pipeline._mark_embedding_failed("incident", "inc-1", "boom")

    mock_supabase.table.assert_called_once_with("incidents")


def test_mark_embedding_failed_is_a_no_op_without_a_marker_write_failure():
    """A failure writing the marker itself must not raise into the caller."""
    mock_supabase = MagicMock()
    mock_supabase.table.side_effect = RuntimeError("db down")
    with patch.object(embedding_pipeline, "get_supabase_admin", return_value=mock_supabase):
        embedding_pipeline._mark_embedding_failed("session", "sess-1", "boom")  # must not raise


def test_delete_stale_chunks_uses_correct_query_shape_for_session():
    mock_supabase = MagicMock()
    with patch.object(embedding_pipeline, "get_supabase_admin", return_value=mock_supabase):
        embedding_pipeline._delete_stale_chunks("session", "sess-1", "org-1", keep_below=2)

    mock_supabase.table.assert_called_once_with("session_embeddings")
    delete_mock = mock_supabase.table.return_value.delete
    eq1 = delete_mock.return_value.eq
    eq1.assert_called_once_with("session_id", "sess-1")
    eq2 = eq1.return_value.eq
    eq2.assert_called_once_with("organization_id", "org-1")
    eq2.return_value.gte.assert_called_once_with("chunk_index", 2)


def test_delete_stale_chunks_uses_incident_id_key_for_incident_source():
    mock_supabase = MagicMock()
    with patch.object(embedding_pipeline, "get_supabase_admin", return_value=mock_supabase):
        embedding_pipeline._delete_stale_chunks("incident", "inc-1", "org-1", keep_below=1)

    mock_supabase.table.return_value.delete.return_value.eq.assert_called_once_with(
        "incident_id", "inc-1"
    )


# ── Full pipeline: failure is visible, success writes no marker ─────────────


@pytest.mark.asyncio
async def test_run_session_embedding_pipeline_marks_failure_when_all_chunks_fail():
    """Every chunk failing to embed must surface as embedding_status='failed'
    on the session, not just a log line."""
    with patch.object(embedding_pipeline, "generate_query_embedding", return_value=[]), \
         patch.object(embedding_pipeline, "_mark_embedding_failed") as mock_mark, \
         patch("backend.app.services.embedding_pipeline.asyncio.sleep", return_value=None):
        await embedding_pipeline.run_session_embedding_pipeline(
            session_id="sess-1",
            organization_id="org-1",
            text="Participant engaged in community access today with support.",
        )

    mock_mark.assert_called_once()
    call_args = mock_mark.call_args[0]
    assert call_args[0] == "session"
    assert call_args[1] == "sess-1"


@pytest.mark.asyncio
async def test_run_session_embedding_pipeline_success_writes_no_marker():
    """Never written on success — presence of the marker alone must mean
    something went wrong (same contract as compliance_check_status)."""
    mock_supabase = MagicMock()
    with patch.object(embedding_pipeline, "generate_query_embedding", return_value=[0.1] * 1536), \
         patch.object(embedding_pipeline, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(embedding_pipeline, "_mark_embedding_failed") as mock_mark, \
         patch("backend.app.services.embedding_pipeline.asyncio.sleep", return_value=None):
        await embedding_pipeline.run_session_embedding_pipeline(
            session_id="sess-1",
            organization_id="org-1",
            text="Participant engaged in community access today with support.",
        )

    mock_mark.assert_not_called()


@pytest.mark.asyncio
async def test_run_session_embedding_pipeline_cleans_up_stale_trailing_chunks():
    """An edit that shortens a note must drop chunks beyond the new length,
    not just upsert the ones that still exist — otherwise old trailing
    content from a longer prior version stays searchable forever."""
    mock_supabase = MagicMock()
    with patch.object(embedding_pipeline, "generate_query_embedding", return_value=[0.1] * 1536), \
         patch.object(embedding_pipeline, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(embedding_pipeline, "_delete_stale_chunks") as mock_delete, \
         patch("backend.app.services.embedding_pipeline.asyncio.sleep", return_value=None):
        await embedding_pipeline.run_session_embedding_pipeline(
            session_id="sess-1",
            organization_id="org-1",
            text="A short edited note.",
        )

    mock_delete.assert_called_once()
    args, kwargs = mock_delete.call_args
    assert args[:3] == ("session", "sess-1", "org-1")
    assert kwargs["keep_below"] == len(embedding_pipeline.chunk_text("A short edited note."))


@pytest.mark.asyncio
async def test_run_incident_embedding_pipeline_marks_failure_when_all_chunks_fail():
    with patch.object(embedding_pipeline, "generate_query_embedding", return_value=[]), \
         patch.object(embedding_pipeline, "_mark_embedding_failed") as mock_mark, \
         patch("backend.app.services.embedding_pipeline.asyncio.sleep", return_value=None):
        await embedding_pipeline.run_incident_embedding_pipeline(
            incident_id="inc-1",
            organization_id="org-1",
            text="A worker behaviour incident occurred during the shift.",
        )

    mock_mark.assert_called_once()
    call_args = mock_mark.call_args[0]
    assert call_args[0] == "incident"
    assert call_args[1] == "inc-1"


# ── schedule(): survives the caller raising afterward ────────────────────────


@pytest.mark.asyncio
async def test_schedule_runs_and_discards_its_own_reference():
    ran = {"value": False}

    async def _work():
        ran["value"] = True

    task = embedding_pipeline.schedule(_work())
    assert task in embedding_pipeline._inflight_tasks
    await task
    assert ran["value"] is True
    assert task not in embedding_pipeline._inflight_tasks


@pytest.mark.asyncio
async def test_schedule_survives_caller_raising_immediately_after():
    """This is the whole reason schedule() exists instead of
    background_tasks.add_task(): FastAPI only attaches queued BackgroundTasks
    to the response on the non-exception path, so a task added right before
    an HTTPException is raised would silently never run. asyncio.create_task
    is not tied to response construction at all, so it must still complete
    here even though the caller raises immediately afterward."""
    ran = {"value": False}

    async def _work():
        ran["value"] = True

    async def _caller_that_raises_afterward():
        task = embedding_pipeline.schedule(_work())
        try:
            raise ValueError("simulated compliance block-tier HTTPException")
        except ValueError:
            pass
        return task

    task = await _caller_that_raises_afterward()
    await task
    assert ran["value"] is True
