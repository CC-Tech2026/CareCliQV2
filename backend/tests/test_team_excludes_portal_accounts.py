"""The staff team (/team, the roster, worker stats) lists staff only.

Participant-portal logins (participants and their family) are members of the
organisation too, so organization_members returns them alongside staff; the
team list must leave them out, as the MD dashboard's staff count already does.
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

from backend.app.api import coordinator


def _query(rows):
    chain = MagicMock()
    for name in ("select", "eq", "in_", "neq", "order", "limit"):
        getattr(chain, name).return_value = chain
    chain.execute.return_value = MagicMock(data=rows)
    return chain


def test_team_leaves_out_participant_portal_logins():
    members = [
        {"user_id": "w1", "role": "support_worker", "is_active": True, "joined_at": None, "employee_id": "SW1"},
        {"user_id": "p1", "role": "participant", "is_active": True, "joined_at": None, "employee_id": None},
        {"user_id": "f1", "role": "support_worker", "is_active": True, "joined_at": None, "employee_id": None},
    ]
    profiles = [
        {"id": "w1", "full_name": "Priya Nair", "role": "support_worker", "organization_id": "org"},
        {"id": "p1", "full_name": "Ethan Clarke", "role": "participant", "organization_id": "org"},
        # Membership row says staff, but the account is a portal login.
        {"id": "f1", "full_name": "Claire Thompson", "role": "participant", "organization_id": "org"},
    ]
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: _query(members if name == "organization_members" else profiles)

    with patch.object(coordinator, "get_supabase_admin", return_value=supabase), \
         patch("backend.app.services.worker_training_service.team_training_overdue_map", return_value={}), \
         patch("backend.app.services.induction_service.team_induction_incomplete_map", return_value={}):
        team = asyncio.run(coordinator._team("org"))

    assert [member["full_name"] for member in team] == ["Priya Nair"]
