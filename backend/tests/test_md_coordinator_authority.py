"""The managing director can do everything a coordinator can (rostering,
messaging, live monitoring), while support workers are still refused."""

import pytest
from fastapi import HTTPException

from backend.app.api import coordinator


@pytest.mark.parametrize("role", ["support_coordinator", "managing_director"])
def test_coordinator_actions_accept_coordinator_and_md(role):
    user = {"id": "u-1", "role": role, "organization_id": "org-1"}
    assert coordinator._require_coordinator(user) == "org-1"


@pytest.mark.parametrize("role", ["support_worker", "participant"])
def test_coordinator_actions_refuse_other_roles(role):
    user = {"id": "u-1", "role": role, "organization_id": "org-1"}
    with pytest.raises(HTTPException) as exc:
        coordinator._require_coordinator(user)
    assert exc.value.status_code == 403
