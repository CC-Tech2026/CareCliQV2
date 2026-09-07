import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.app.services import session_service, shift_service

ORG_A = "11111111-1111-1111-1111-111111111111"

NO_WARNING = {
    "relevant_to_participant": True,
    "fits_task_category": True,
    "inappropriate_content": False,
    "warning_message": None,
}


def _execute_result(data):
    result = MagicMock()
    result.data = data
    return result


def _chained_supabase_mock() -> MagicMock:
    """A Supabase client mock where every query-builder method loops back to
    the same mock object, so .execute() always resolves against one
    configurable call sequence regardless of which builder methods (select/
    eq/is_/order/limit/insert/update) were chained beforehand."""
    supabase = MagicMock()
    for method in ("table", "select", "eq", "is_", "order", "limit", "insert", "update"):
        getattr(supabase, method).return_value = supabase
    return supabase


class SessionNoteVersioningTests(unittest.IsolatedAsyncioTestCase):
    async def test_skips_when_payload_touches_no_note_fields(self):
        with patch.object(session_service, "get_supabase_admin") as mock_admin:
            result = await session_service._snapshot_note_version(
                "sess-1", ORG_A, {"status": "in_progress"}, {"tags": ["a"]}, None, True
            )
        self.assertIsNone(result)
        mock_admin.assert_not_called()

    async def test_inserts_first_version_and_returns_validation_result(self):
        supabase = _chained_supabase_mock()
        # 1st call: look up prior current version -> none exist yet.
        # 2nd call: insert the new version -> returns the new row.
        supabase.execute.side_effect = [
            _execute_result([]),
            _execute_result([{"id": "v1"}]),
        ]

        with patch.object(session_service, "get_supabase_admin", return_value=supabase), patch(
            "backend.app.services.participant_service.get_participant_validation_context",
            AsyncMock(return_value={"full_name": "Alex", "goal_titles": []}),
        ), patch(
            "backend.app.services.ai_service.validate_note_content",
            AsyncMock(return_value=NO_WARNING),
        ):
            result = await session_service._snapshot_note_version(
                "sess-1",
                ORG_A,
                {"status": "in_progress", "patient_id": "p1"},
                {"activities_performed": "Helped with breakfast"},
                {"sub": "worker-1"},
                True,
            )

        self.assertEqual(result, NO_WARNING)
        insert_calls = supabase.insert.call_args_list
        self.assertEqual(len(insert_calls), 1)
        inserted_payload = insert_calls[0][0][0]
        self.assertEqual(inserted_payload["activities_performed"], "Helped with breakfast")
        self.assertTrue(inserted_payload["is_original"])
        self.assertTrue(inserted_payload["created_during_shift"])
        # No prior version existed, so nothing should have been superseded.
        supabase.update.assert_not_called()

    async def test_noop_when_content_unchanged_from_last_version(self):
        supabase = _chained_supabase_mock()
        supabase.execute.side_effect = [
            _execute_result(
                [
                    {
                        "id": "v-prev",
                        "notes": "Same note",
                        "activities_performed": None,
                        "outcomes": None,
                        "participant_response": None,
                        "progress_toward_goals": None,
                    }
                ]
            ),
        ]

        with patch.object(session_service, "get_supabase_admin", return_value=supabase):
            result = await session_service._snapshot_note_version(
                "sess-1",
                ORG_A,
                {"status": "in_progress", "notes": "Same note"},
                {"notes": "Same note"},
                None,
                False,
            )

        self.assertIsNone(result)
        supabase.insert.assert_not_called()

    async def test_marks_prior_version_superseded_on_real_edit(self):
        supabase = _chained_supabase_mock()
        supabase.execute.side_effect = [
            _execute_result([{"id": "v-prev", "notes": "Old note", "activities_performed": None,
                               "outcomes": None, "participant_response": None, "progress_toward_goals": None}]),
            _execute_result([{"id": "v-new"}]),
            _execute_result([{"id": "v-prev"}]),  # the supersede update's response
        ]

        with patch.object(session_service, "get_supabase_admin", return_value=supabase), patch(
            "backend.app.services.participant_service.get_participant_validation_context",
            AsyncMock(return_value={}),
        ), patch(
            "backend.app.services.ai_service.validate_note_content",
            AsyncMock(return_value=NO_WARNING),
        ):
            result = await session_service._snapshot_note_version(
                "sess-1",
                ORG_A,
                {"status": "in_progress", "notes": "Old note"},
                {"notes": "New note"},
                None,
                False,
            )

        self.assertEqual(result, NO_WARNING)
        update_calls = supabase.update.call_args_list
        self.assertEqual(len(update_calls), 1)
        update_payload = update_calls[0][0][0]
        self.assertEqual(update_payload["superseded_by_version_id"], "v-new")
        self.assertIn("superseded_at", update_payload)


class ShiftVisitNoteEditTests(unittest.IsolatedAsyncioTestCase):
    async def test_edit_is_noop_when_content_unchanged(self):
        supabase = _chained_supabase_mock()
        existing_row = {
            "id": "note-1",
            "shift_id": "shift-1",
            "organization_id": ORG_A,
            "worker_id": "worker-1",
            "content": "Same content",
            "superseded_at": None,
        }
        supabase.execute.return_value = _execute_result([existing_row])

        with patch.object(shift_service, "get_supabase_admin", return_value=supabase), patch.object(
            shift_service, "get_shift_by_id", return_value={"worker_id": "worker-1", "participant_id": "p1"}
        ):
            result = await shift_service.edit_shift_visit_note(
                "note-1", "worker-1", ORG_A, "Same content"
            )

        self.assertEqual(result, existing_row)
        supabase.insert.assert_not_called()

    async def test_edit_supersedes_old_row_and_inserts_new_one(self):
        supabase = _chained_supabase_mock()
        existing_row = {
            "id": "note-1",
            "shift_id": "shift-1",
            "session_id": None,
            "organization_id": ORG_A,
            "worker_id": "worker-1",
            "content": "Old content",
            "category": "task_context",
            "task_id": "t1",
            "goal_id": None,
            "attachment_urls": [],
            "superseded_at": None,
        }
        supabase.execute.side_effect = [
            _execute_result([existing_row]),   # fetch existing
            _execute_result([{"id": "note-2"}]),  # insert new version
            _execute_result([{"id": "note-1"}]),  # supersede update
        ]

        with patch.object(shift_service, "get_supabase_admin", return_value=supabase), patch.object(
            shift_service, "get_shift_by_id", return_value={"worker_id": "worker-1", "participant_id": "p1", "tasks": []}
        ), patch(
            "backend.app.services.participant_service.get_participant_validation_context",
            AsyncMock(return_value={}),
        ), patch(
            "backend.app.services.ai_service.validate_note_content",
            AsyncMock(return_value=NO_WARNING),
        ):
            result = await shift_service.edit_shift_visit_note(
                "note-1", "worker-1", ORG_A, "New content"
            )

        self.assertEqual(result, {"id": "note-2"})
        update_calls = supabase.update.call_args_list
        self.assertEqual(len(update_calls), 1)
        self.assertEqual(update_calls[0][0][0]["superseded_by_note_id"], "note-2")

    async def test_edit_rejects_worker_who_does_not_own_shift(self):
        supabase = _chained_supabase_mock()
        existing_row = {
            "id": "note-1",
            "shift_id": "shift-1",
            "organization_id": ORG_A,
            "worker_id": "worker-1",
            "content": "Old content",
            "superseded_at": None,
        }
        supabase.execute.return_value = _execute_result([existing_row])

        with patch.object(shift_service, "get_supabase_admin", return_value=supabase), patch.object(
            shift_service, "get_shift_by_id", return_value={"worker_id": "someone-else"}
        ):
            result = await shift_service.edit_shift_visit_note(
                "note-1", "worker-1", ORG_A, "New content"
            )

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
