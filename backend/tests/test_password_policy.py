import unittest

from backend.app.services.password_policy import password_strength_score, validate_password_policy


class PasswordPolicyTests(unittest.TestCase):
    def test_rejects_short_password(self):
        self.assertEqual(
            validate_password_policy("Ab1"),
            "Password must be at least 10 characters.",
        )

    def test_requires_uppercase(self):
        self.assertEqual(
            validate_password_policy("password12"),
            "Password must include at least one uppercase letter.",
        )

    def test_requires_number(self):
        self.assertEqual(
            validate_password_policy("Passwordab"),
            "Password must include at least one number.",
        )

    def test_rejects_common_password(self):
        self.assertEqual(
            validate_password_policy("Password123"),
            "This password is too common. Choose a stronger password.",
        )

    def test_accepts_valid_password(self):
        self.assertIsNone(validate_password_policy("SecurePass9"))

    def test_strength_score(self):
        self.assertGreater(password_strength_score("SecurePass9!"), password_strength_score("Secure1"))


if __name__ == "__main__":
    unittest.main()
