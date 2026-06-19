import unittest

import pyotp

from backend.app.services import device_security_service as dss


class DeviceSecurityServiceTests(unittest.TestCase):
    def test_verify_totp_code_accepts_valid_code(self):
        secret = pyotp.random_base32()
        code = pyotp.TOTP(secret).now()
        self.assertTrue(dss.verify_totp_code(secret, code))

    def test_verify_totp_code_rejects_invalid_code(self):
        secret = pyotp.random_base32()
        self.assertFalse(dss.verify_totp_code(secret, "000000"))

    def test_parse_user_agent_detects_mobile(self):
        device_name, os_name = dss.parse_user_agent(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "Version/17.0 Mobile/15E148 Safari/604.1"
        )
        self.assertIn("iPhone", device_name)
        self.assertEqual(os_name, "iOS")

    def test_is_suspicious_login_false_for_unknown_country(self):
        self.assertFalse(dss._is_suspicious_login("user-id", "device-1", "Unknown"))


if __name__ == "__main__":
    unittest.main()
