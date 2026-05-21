import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.app.core import rbac


class Query:
    def __init__(self, rows=None, fail=False):
        self.rows = rows or []
        self.fail = fail
        self.filters = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def limit(self, *_args):
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("db unavailable")
        return SimpleNamespace(data=self.rows)


class Supabase:
    def __init__(self, query):
        self.query = query

    def table(self, name):
        assert name == "practitioner_allocations"
        return self.query


class RbacTests(unittest.IsolatedAsyncioTestCase):
    async def test_support_worker_can_view_assigned_participant(self):
        user = {
            "sub": "worker-1",
            "role": "support_worker",
            "organization_id": "org-1",
        }
        participant = {"id": "participant-1", "organization_id": "org-1"}
        query = Query(rows=[{"id": "allocation-1"}])

        with patch("backend.app.core.rbac.get_supabase_admin", return_value=Supabase(query)):
            self.assertTrue(await rbac.can_access_participant(user, participant))

        self.assertIn(("patient_id", "participant-1"), query.filters)
        self.assertIn(("user_id", "worker-1"), query.filters)
        self.assertIn(("organization_id", "org-1"), query.filters)
        self.assertIn(("is_active", True), query.filters)

    async def test_support_worker_cannot_view_unassigned_participant_by_direct_id(self):
        user = {
            "sub": "worker-1",
            "role": "support_worker",
            "organization_id": "org-1",
        }
        participant = {"id": "participant-2", "organization_id": "org-1"}

        with patch("backend.app.core.rbac.get_supabase_admin", return_value=Supabase(Query(rows=[]))):
            with self.assertRaises(HTTPException) as ctx:
                await rbac.require_participant_access(user, participant)

        self.assertEqual(ctx.exception.status_code, 403)

    async def test_assignment_lookup_failure_fails_closed(self):
        user = {
            "sub": "worker-1",
            "role": "support_worker",
            "organization_id": "org-1",
        }
        participant = {"id": "participant-1", "organization_id": "org-1"}

        with patch("backend.app.core.rbac.get_supabase_admin", return_value=Supabase(Query(fail=True))):
            self.assertFalse(await rbac.can_access_participant(user, participant))

    async def test_coordinator_can_view_same_org_but_not_other_org(self):
        user = {
            "sub": "coord-1",
            "role": "support_coordinator",
            "organization_id": "org-1",
        }

        self.assertTrue(
            await rbac.can_access_participant(user, {"id": "participant-1", "organization_id": "org-1"})
        )
        self.assertFalse(
            await rbac.can_access_participant(user, {"id": "participant-2", "organization_id": "org-2"})
        )

    async def test_unknown_role_fails_closed(self):
        user = {
            "sub": "user-1",
            "role": "manager",
            "organization_id": "org-1",
        }
        participant = {"id": "participant-1", "organization_id": "org-1"}

        self.assertFalse(await rbac.can_access_participant(user, participant))


if __name__ == "__main__":
    unittest.main()
