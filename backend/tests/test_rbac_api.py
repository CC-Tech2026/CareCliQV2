import unittest

from fastapi.testclient import TestClient

from backend.app.core.security import create_access_token
from backend.app.main import app


class RbacApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def token(self, role: str = "support_worker") -> str:
        return create_access_token({
            "sub": "user-1",
            "email": "user@example.com",
            "role": role,
            "organization_id": "org-1",
        })

    def test_protected_routes_require_auth(self):
        for method, path, body in [
            ("get", "/api/participants", None),
            ("get", "/api/plans/participant/patient-1", None),
            ("post", "/api/ai/translate", {"text": "hello"}),
            ("get", "/api/invitations/list", None),
        ]:
            request = getattr(self.client, method)
            response = request(path, json=body) if body is not None else request(path)
            self.assertEqual(response.status_code, 401, path)

    def test_worker_cannot_use_team_management(self):
        response = self.client.get(
            "/api/invitations/list",
            headers={"Authorization": f"Bearer {self.token('support_worker')}"},
        )
        self.assertEqual(response.status_code, 403)

    def test_unknown_role_fails_closed(self):
        response = self.client.get(
            "/api/invitations/list",
            headers={"Authorization": f"Bearer {self.token('manager')}"},
        )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
