from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import worker_training_service as training


def database(owned=True):
    db = MagicMock()
    modules = db.table.return_value
    modules.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"id": "module"} if owned else None
    return db


@pytest.mark.parametrize("payload", [None, {"title": "Guide", "external_url": "https://example.org", "resource_type": "pdf"}])
def test_material_write_requires_owned_module(payload):
    db = database(False)
    with patch.object(training, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as error:
            training.manage_training_resource("other-org", "module", payload, "resource")
    assert error.value.status_code == 404
    db.table.return_value.delete.assert_not_called()
    db.table.return_value.update.assert_not_called()


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,hello", "#", "https://", "https://[invalid"])
def test_rejects_invalid_material_urls(url):
    db = database()
    with patch.object(training, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as error:
            training.manage_training_resource("org", "module", {"title": "Guide", "external_url": url, "resource_type": "pdf"})
    assert error.value.status_code == 422
    db.table.return_value.insert.assert_not_called()


def test_creates_resource_linked_to_verified_module():
    db = database()
    with patch.object(training, "get_supabase_admin", return_value=db):
        resource = training.manage_training_resource("org", "module", {"title": " Guide ", "external_url": "https://example.org/guide.pdf", "resource_type": "pdf", "sort_order": 2})
    assert resource["module_id"] == "module"
    assert resource["title"] == "Guide"
    assert resource["sort_order"] == 2
    db.table.return_value.insert.assert_called_once_with(resource)
