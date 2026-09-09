from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from backend.app.services import worker_training_service as training


def module_database(row):
    db = MagicMock()
    query = db.table.return_value
    query.select.return_value = query
    query.eq.return_value = query
    query.maybe_single.return_value = query
    query.execute.return_value.data = row
    return db


@pytest.mark.parametrize("operation", ["start", "complete"])
@pytest.mark.parametrize("row,code", [(None, 404), ({"id": "module", "is_locked": True}, 423)])
def test_unavailable_module_cannot_start_or_complete(operation, row, code):
    db = module_database(row)
    with patch.object(training, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as error:
            if operation == "start":
                training.start_training_module("worker", "org", "module")
            else:
                training.mark_training_complete("worker", "org", "module", date.today(), acknowledged=True)
    assert error.value.status_code == code
    db.table.return_value.eq.assert_any_call("organization_id", "org")
    db.table.return_value.upsert.assert_not_called()
    db.table.return_value.update.assert_not_called()


def test_unlocked_module_is_available():
    db = module_database({"id": "module", "is_locked": False})
    with patch.object(training, "get_supabase_admin", return_value=db):
        assert training.require_available_module("org", "module")["id"] == "module"


def test_shared_resource_requires_organisation_ownership():
    db = module_database(None)
    with patch.object(training, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as error:
            training.shared_resource_url("org", "other-resource")
    assert error.value.status_code == 404
    db.table.return_value.eq.assert_any_call("org_id", "org")
    db.storage.from_.assert_not_called()


def test_shared_resource_uses_private_short_lived_access():
    db = module_database({"file_key": "org/resource/guide.pdf"})
    db.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://example.org/signed"}
    with patch.object(training, "get_supabase_admin", return_value=db):
        assert training.shared_resource_url("org", "resource") == {"url": "https://example.org/signed"}
    db.storage.from_.assert_called_once_with("onboarding-resources")
    db.storage.from_.return_value.create_signed_url.assert_called_once_with("org/resource/guide.pdf", 300)


def test_shared_library_rejects_missing_organisation():
    with pytest.raises(HTTPException) as error:
        training.list_shared_resources(None)
    assert error.value.status_code == 403


def test_database_lock_race_returns_actionable_error():
    db = MagicMock()
    db.table.return_value.upsert.return_value.execute.side_effect = RuntimeError("Training module is under maintenance")
    with patch.object(training, "require_available_module", return_value={}), patch.object(training, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as error:
            training.mark_training_complete("worker", "org", "module", date.today(), acknowledged=True)
    assert error.value.status_code == 423


@pytest.mark.parametrize("role", ["support_worker", "support_coordinator"])
def test_only_directors_can_change_module_locks(role):
    import asyncio
    from backend.app.api.coordinator import set_training_module_lock, TrainingModuleLockBody
    with patch.object(training, "update_training_module") as update:
        with pytest.raises(HTTPException) as error:
            asyncio.run(set_training_module_lock("module", TrainingModuleLockBody(is_locked=True), {"id": "user", "organization_id": "org", "role": role}))
    assert error.value.status_code == 403
    update.assert_not_called()


def test_director_unlock_clears_notice_and_keeps_org_scope():
    import asyncio
    from backend.app.api.coordinator import set_training_module_lock, TrainingModuleLockBody
    with patch.object(training, "update_training_module", return_value={"id": "module", "is_locked": False}) as update:
        asyncio.run(set_training_module_lock("module", TrainingModuleLockBody(is_locked=False, lock_reason="Old notice"), {"id": "md", "organization_id": "org", "role": "managing_director"}))
    update.assert_called_once_with("org", "module", {"is_locked": False, "lock_reason": None})


def test_worker_catalogue_removes_locked_resource_urls():
    import asyncio
    from backend.app.api.worker_performance import worker_training_modules
    modules = [{"id": "module", "is_locked": True, "resources": [{"external_url": "https://example.org/draft"}]}]
    with patch.object(training, "list_training_modules", return_value=modules):
        response = asyncio.run(worker_training_modules({"id": "worker", "organization_id": "org", "role": "support_worker"}))
    assert response["modules"][0]["resources"] == []
