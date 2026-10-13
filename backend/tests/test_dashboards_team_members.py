"""The MD staff directory is built from _team_members; participant portal
logins share organization_members with staff but must never be listed as staff."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.api import dashboards

ORG = "org-1"


class _Query:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def in_(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _Supabase:
    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = tables

    def table(self, name: str):
        return _Query(self._tables[name])


def test_team_members_skips_participant_accounts():
    supabase = _Supabase({
        "organization_members": [
            {"user_id": "w1", "role": "support_worker", "is_active": True, "joined_at": None},
            {"user_id": "p1", "role": "participant", "is_active": True, "joined_at": None},
            {"user_id": "p2", "role": None, "is_active": True, "joined_at": None},
        ],
        "users": [
            {"id": "w1", "full_name": "Wanjiru Worker", "role": "support_worker", "organization_id": ORG},
            {"id": "p1", "full_name": "Hailey Brown", "role": "participant", "organization_id": ORG},
            {"id": "p2", "full_name": "Max Well", "role": "participant", "organization_id": ORG},
        ],
    })

    with patch.object(dashboards, "get_supabase_admin", return_value=supabase):
        team = asyncio.run(dashboards._team_members(ORG))

    assert [member["id"] for member in team] == ["w1"]
