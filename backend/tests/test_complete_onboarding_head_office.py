import asyncio
from unittest.mock import MagicMock, patch

from backend.app.api import auth


def _run(role):
    db = MagicMock()
    body = auth.OnboardingCompleteRequest(account_type="small_provider", organization_name="Sunshine Care", state="WA")
    user = {"sub": "user-1", "role": role, "organization_id": "org-1"}
    with patch.object(auth, "get_supabase_admin", return_value=db), \
         patch.object(auth, "_set_head_office_state") as set_state:
        result = asyncio.run(auth.complete_onboarding(body, current_user=user))
    db.table.return_value.insert.assert_not_called()
    assert result["organization_id"] == "org-1"
    return set_state


def test_founding_md_sets_head_office_state_on_existing_org():
    set_state = _run("managing_director")
    set_state.assert_called_once()
    assert set_state.call_args.args[1:] == ("org-1", "WA")


def test_invited_staff_cannot_move_the_head_office():
    _run("support_coordinator").assert_not_called()
    _run("support_worker").assert_not_called()
