from unittest.mock import MagicMock, patch
import asyncio
import pytest
from fastapi import HTTPException
from backend.app.api.coordinator import TrainingModuleUpdateBody, coordinator_update_training_module
from backend.app.services import training_material_service as materials


@pytest.mark.parametrize("fields", [{"cover_path": "org/training-covers/abcd.png", "cover_color": "#FED7AA"}, {"cover_path": None, "cover_color": None}, {"title": "Renamed"}])
def test_update_api_preserves_cover_changes_and_explicit_removal(fields):
    body = TrainingModuleUpdateBody(**fields)
    with patch("backend.app.api.coordinator._require_org_read", return_value="org"), patch("backend.app.services.worker_training_service.update_training_module") as update:
        asyncio.run(coordinator_update_training_module("module", body, {}))
    update.assert_called_once_with(organization_id="org", module_id="module", updates=fields)


def database(owned=True):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"id": "module"} if owned else None
    return db


def test_upload_saves_scoped_file_and_metadata():
    db = database()
    with patch.object(materials, "get_supabase_admin", return_value=db), patch("backend.app.services.worker_training_service.manage_training_resource", return_value={"id": "resource"}) as save:
        assert materials.upload_material("org", "module", " Guide ", b"%PDF-1.7", "application/pdf", 2, "resource") == {"id": "resource"}
    args = save.call_args.args
    assert args[0:2] == ("org", "module")
    assert args[2]["title"] == "Guide"
    assert args[2]["sort_order"] == 2
    assert args[3] == "resource"
    path = args[2]["storage_path"]
    materials.validate_material_path("org", "module", path, "pdf")
    db.storage.from_.return_value.upload.assert_called_once_with(path, b"%PDF-1.7", file_options={"content-type": "application/pdf"})


def test_upload_removes_only_new_file_when_metadata_save_fails():
    db = database()
    with patch.object(materials, "get_supabase_admin", return_value=db), patch("backend.app.services.worker_training_service.manage_training_resource", side_effect=RuntimeError("save failed")):
        with pytest.raises(RuntimeError):
            materials.upload_material("org", "module", "Guide", b"%PDF-1.7", "application/pdf")
    storage = db.storage.from_.return_value
    storage.remove.assert_called_once_with([storage.upload.call_args.args[0]])


def test_upload_rejects_other_organisation_before_storage():
    db = database(False)
    with patch.object(materials, "get_supabase_admin", return_value=db), pytest.raises(HTTPException) as error:
        materials.upload_material("other-org", "module", "Guide", b"%PDF-1.7", "application/pdf")
    assert error.value.status_code == 404
    db.storage.from_.assert_not_called()


@pytest.mark.parametrize("content,mime", [(b"", "application/pdf"), (b"fake", "application/pdf"), (b"<html>", "text/html")])
def test_upload_rejects_invalid_files(content, mime):
    db = database()
    with patch.object(materials, "get_supabase_admin", return_value=db), pytest.raises(HTTPException):
        materials.upload_material("org", "module", "Guide", content, mime)
    db.storage.from_.assert_not_called()


@pytest.mark.parametrize("path,kind", [("other/training-materials/module/abcd.pdf", "pdf"), ("org/training-materials/other/abcd.pdf", "pdf"), ("org/training-materials/module/abcd.pdf", "video"), ("org/training-materials/module/../abcd.pdf", "pdf")])
def test_rejects_cross_module_and_mismatched_file_paths(path, kind):
    with pytest.raises(HTTPException):
        materials.validate_material_path("org", "module", path, kind)


def test_worker_cannot_open_material_while_module_is_locked():
    from backend.app.api import worker_performance as api
    with patch.object(api, "_require_worker"), patch.object(api, "get_user_organization_id", return_value="org"), patch.object(api.worker_training_service, "require_available_module", side_effect=HTTPException(status_code=423)), patch.object(materials, "material_access_url") as access:
        with pytest.raises(HTTPException) as error:
            asyncio.run(api.worker_material_access("module", "resource", {}))
    assert error.value.status_code == 423
    access.assert_not_called()


def test_learning_design_fields_survive_update_api():
    fields = {"material_layout": "cards", "learning_steps": ["Read the guide", "Discuss questions"], "estimated_minutes": 20}
    body = TrainingModuleUpdateBody(**fields)
    with patch("backend.app.api.coordinator._require_org_read", return_value="org"), patch("backend.app.services.worker_training_service.update_training_module") as update:
        asyncio.run(coordinator_update_training_module("module", body, {}))
    update.assert_called_once_with(organization_id="org", module_id="module", updates=fields)


@pytest.mark.parametrize("fields", [{"material_layout": "html"}, {"estimated_minutes": 0}, {"learning_steps": ["Step"] * 31}])
def test_learning_design_rejects_invalid_settings(fields):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        TrainingModuleUpdateBody(**fields)
