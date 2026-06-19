import unittest

from backend.app.api.auth import (
    _LOCKOUT_MAX_ATTEMPTS,
    _normalize_phone,
    _phone_lookup_candidates,
    _looks_like_email,
)


class AuthLoginHelperTests(unittest.TestCase):
    def test_looks_like_email(self):
        self.assertTrue(_looks_like_email("user@example.com"))
        self.assertFalse(_looks_like_email("0412345678"))

    def test_normalize_australian_mobile(self):
        self.assertEqual(_normalize_phone("0412 345 678"), "0412345678")
        self.assertEqual(_normalize_phone("+61412345678"), "0412345678")

    def test_phone_lookup_candidates(self):
        candidates = _phone_lookup_candidates("0412 345 678")
        self.assertIn("0412345678", candidates)
        self.assertIn("412345678", candidates)

    def test_lockout_threshold(self):
        self.assertEqual(_LOCKOUT_MAX_ATTEMPTS, 5)


if __name__ == "__main__":
    unittest.main()
