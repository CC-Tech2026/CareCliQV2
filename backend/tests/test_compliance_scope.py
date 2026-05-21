import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.api import reports
from backend.app.services import session_service


class Query:
    def __init__(self):
        self.filters = []

    def select(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        return SimpleNamespace(data=[])


class Supabase:
    def __init__(self, query):
        self.query = query

    def table(self, name):
        assert name == "sessions"
        return self.query


class ComplianceScopeTests(unittest.IsolatedAsyncioTestCase):
    async def test_compliance_report_filters_by_organization(self):
        query = Query()
        with patch("backend.app.services.session_service.get_supabase_admin", return_value=Supabase(query)):
            await session_service.get_compliance_report(org_id="org-1")

        self.assertIn(("organization_id", "org-1"), query.filters)

    async def test_compliance_overview_passes_current_user_org(self):
        captured = {}

        async def fake_report(org_id=None):
            captured["org_id"] = org_id
            return []

        with patch("backend.app.api.reports.session_service.get_compliance_report", side_effect=fake_report):
            await reports.compliance_overview({
                "sub": "coord-1",
                "role": "support_coordinator",
                "organization_id": "org-1",
            })

        self.assertEqual(captured["org_id"], "org-1")


if __name__ == "__main__":
    unittest.main()
