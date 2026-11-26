from __future__ import annotations

import re

_COMMON_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "qwerty123",
    "letmein1",
    "welcome1",
    "admin123",
    "carecliq1",
    "support1",
    "ndis1234",
}


def validate_password_policy(password: str) -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters."
    if not re.search(r"[A-Z]", password):
        return "Password must include at least one uppercase letter."
    if not re.search(r"\d", password):
        return "Password must include at least one number."
    if password.lower() in _COMMON_PASSWORDS:
        return "This password is too common. Choose a stronger password."
    return None


def password_strength_score(password: str) -> int:
    """Return 0-4 strength score for UI meter."""
    if not password:
        return 0
    score = 0
    if len(password) >= 10:
        score += 1
    if len(password) >= 12:
        score += 1
    if re.search(r"[A-Z]", password) and re.search(r"[a-z]", password):
        score += 1
    if re.search(r"\d", password) and re.search(r"[^A-Za-z0-9]", password):
        score += 1
    return min(score, 4)


def auth_password_error(exc: Exception) -> str | None:
    """A readable reason when the auth service refuses a password.

    Supabase can be stricter than our own policy (its project settings may
    demand more character types, or block passwords seen in breaches). Its
    refusal used to surface as "Failed to create account, please try again",
    which reads like an outage, so people tried the same password again."""
    text = str(exc).lower()
    if "pwned" in text or "breach" in text or "leaked" in text:
        return "This password has appeared in a data breach. Choose a different password."
    if "weak" in text or ("password" in text and ("should" in text or "must" in text or "at least" in text)):
        return (
            "This password isn't strong enough. Use at least 10 characters with "
            "a capital letter, a lower-case letter and a number."
        )
    return None
