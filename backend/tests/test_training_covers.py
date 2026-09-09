from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException
from backend.app.services import training_cover_service as covers


@pytest.mark.parametrize("fields", [{"cover_color": "red"}, {"cover_color": "#12345g"}, {"cover_path": "other/training-covers/abc.png"}, {"cover_path": "org/training-covers/../private.jpg"}])
def test_cover_fields_reject_invalid_colours_and_cross_org_paths(fields):
    with pytest.raises(HTTPException) as error:
        covers.validate_cover("org", fields)
    assert error.value.status_code == 422


def test_cover_fields_allow_clear_and_organisation_cover():
    covers.validate_cover("org", {"cover_color": "#Fed7AA", "cover_path": "org/training-covers/abcd-1234.png"})
    covers.validate_cover("org", {"cover_color": None, "cover_path": None})


@pytest.mark.parametrize("content,mime", [(b"", "image/png"), (b"<svg></svg>", "image/svg+xml"), (b"not an image", "image/png"), (b"x" * (5 * 1024 * 1024 + 1), "image/jpeg")], ids=["empty", "svg", "invalid-signature", "oversized"])
def test_cover_upload_rejects_unsupported_or_oversized_file(content, mime):
    with patch.object(covers, "get_supabase_admin") as db:
        with pytest.raises(HTTPException):
            covers.upload_cover("org", content, mime)
    db.assert_not_called()


def test_cover_upload_uses_org_folder_and_private_bucket():
    db = MagicMock()
    with patch.object(covers, "get_supabase_admin", return_value=db):
        result = covers.upload_cover("org", b"\x89PNG\r\n\x1a\ncontent", "image/png")
    assert result["cover_path"].startswith("org/training-covers/")
    db.storage.from_.assert_called_once_with("onboarding-resources")


def test_cover_signing_failure_does_not_hide_the_module():
    db = MagicMock()
    db.storage.from_.return_value.create_signed_url.side_effect = RuntimeError("storage unavailable")
    module = {"id": "module", "organization_id": "org", "cover_path": "org/training-covers/abcd.png", "cover_color": "#FED7AA"}
    with patch.object(covers, "get_supabase_admin", return_value=db):
        result = covers.with_cover_url(module)
    assert result["cover_url"] is None
    assert result["cover_color"] == "#FED7AA"
