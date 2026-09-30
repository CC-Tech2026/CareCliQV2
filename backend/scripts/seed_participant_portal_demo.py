"""One-off: creates (or repairs) the Participants Portal demo data in the
Sunshine demo org. Safe to re-run — every step finds-or-creates.

Scenarios (see participant_portal_access_service for the access rules):
  1. Self access     — Max Well (existing participant) logs in as himself.
  2. Parent of two   — Emma Parker has ONE login with access to her two
                       children, Lily and Noah Parker, so the portal shows
                       the "Who would you like to view?" picker.
  3. Not using portal — Ruth Adams has no login and a recorded reason.

Key check to try by hand: sign in as Emma, then request Max's
participant_id directly — the backend must return 404.

All emails use @example.com (reserved, never delivered) so a seed or test
can never email a real person. These are throwaway demo credentials, so the
password is hardcoded, same convention as seed_dummy_workers.py.

Requires migration 230_participant_portal_access.sql to have been applied.

Usage (from the repo root):
    PYTHONPATH=backend python3 backend/scripts/seed_participant_portal_demo.py
"""

import sys
from datetime import date, datetime, timedelta, timezone

from app.services.supabase_client import get_supabase_admin

ORGANIZATION_ID = "a1111111-1111-1111-1111-111111111111"
PASSWORD = "PortalDemo2026"

MAX_PARTICIPANT_ID = "89c74ecb-2208-44a4-8d63-54ab29c3ddd1"
MAX_EMAIL = "max.well@example.com"
# The earlier demo login used a real-looking address; it's moved to
# @example.com and its old participant_id link is no longer used.
MAX_OLD_EMAIL = "maxwell2026@gmail.com"

EMMA_EMAIL = "emma.parker@example.com"

CHILDREN = [
    {"full_name": "Lily Parker", "date_of_birth": "2018-04-12", "ndis_number": "431000101"},
    {"full_name": "Noah Parker", "date_of_birth": "2015-09-03", "ndis_number": "431000102"},
]
NOT_USING = {"full_name": "Ruth Adams", "date_of_birth": "1941-02-19", "ndis_number": ""}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def find_or_create_participant(supabase, spec: dict) -> str:
    existing = (
        supabase.table("participants")
        .select("id")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("full_name", spec["full_name"])
        .limit(1)
        .execute()
    ).data
    if existing:
        print(f"Participant exists: {spec['full_name']} ({existing[0]['id']})")
        return existing[0]["id"]
    row = {
        "organization_id": ORGANIZATION_ID,
        "full_name": spec["full_name"],
        "date_of_birth": spec["date_of_birth"],
        "ndis_number": spec["ndis_number"],
    }
    created = supabase.table("participants").insert(row).execute().data[0]
    print(f"Created participant: {spec['full_name']} ({created['id']})")
    return created["id"]


def find_auth_user_id(supabase, email: str):
    page = 1
    while True:
        listed = supabase.auth.admin.list_users(page=page, per_page=200)
        users = listed.users if hasattr(listed, "users") else listed
        if not users:
            return None
        for u in users:
            if (u.email or "").lower() == email.lower():
                return str(u.id)
        page += 1


def find_or_create_login(supabase, email: str, full_name: str) -> str:
    user_id = find_auth_user_id(supabase, email)
    if user_id:
        print(f"Auth user exists: {email} ({user_id})")
    else:
        result = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": PASSWORD,
                "user_metadata": {"full_name": full_name},
                "email_confirm": True,
            }
        )
        user_id = str(result.user.id)
        print(f"Created auth user: {email} ({user_id})")
    supabase.table("users").upsert(
        {
            "id": user_id,
            "email": email,
            "role": "participant",
            "full_name": full_name,
            "is_active": True,
            "organization_id": ORGANIZATION_ID,
            "participant_id": None,
            "onboarding_complete": True,
            "email_verified": True,
            "profile_completed": True,
        }
    ).execute()
    return user_id


def ensure_access(supabase, *, user_id: str, participant_id: str, email: str, full_name: str, relationship: str, notes: str | None) -> None:
    live = (
        supabase.table("participant_portal_access")
        .select("id")
        .eq("participant_id", participant_id)
        .ilike("email", email)
        .neq("status", "revoked")
        .limit(1)
        .execute()
    ).data
    if live:
        print(f"Access exists: {email} -> {participant_id}")
        return
    supabase.table("participant_portal_access").insert(
        {
            "organization_id": ORGANIZATION_ID,
            "participant_id": participant_id,
            "user_id": user_id,
            "email": email,
            "full_name": full_name,
            "relationship": relationship,
            "authority_notes": notes,
            "status": "active",
            "granted_at": _now(),
            "accepted_at": _now(),
        }
    ).execute()
    print(f"Granted access: {email} -> {participant_id} ({relationship})")


def main() -> None:
    supabase = get_supabase_admin()

    max_row = (
        supabase.table("participants")
        .select("id, organization_id")
        .eq("id", MAX_PARTICIPANT_ID)
        .maybe_single()
        .execute()
    )
    if not max_row or not max_row.data:
        sys.exit(f"No participant found with id {MAX_PARTICIPANT_ID} — check MAX_PARTICIPANT_ID.")
    if str(max_row.data.get("organization_id")) != ORGANIZATION_ID:
        sys.exit("Max Well's organization_id doesn't match ORGANIZATION_ID — check both constants.")

    # Retire the old real-looking demo address in place (keeps the same auth user).
    old_id = find_auth_user_id(supabase, MAX_OLD_EMAIL)
    if old_id and not find_auth_user_id(supabase, MAX_EMAIL):
        supabase.auth.admin.update_user_by_id(old_id, {"email": MAX_EMAIL, "email_confirm": True, "password": PASSWORD})
        supabase.table("users").update({"email": MAX_EMAIL}).eq("id", old_id).execute()
        print(f"Moved demo login {MAX_OLD_EMAIL} -> {MAX_EMAIL}")

    # 1. Self access
    max_user = find_or_create_login(supabase, MAX_EMAIL, "Max Well")
    ensure_access(
        supabase, user_id=max_user, participant_id=MAX_PARTICIPANT_ID,
        email=MAX_EMAIL, full_name="Max Well", relationship="self", notes=None,
    )

    # 2. Parent of two
    emma_user = find_or_create_login(supabase, EMMA_EMAIL, "Emma Parker")
    for child in CHILDREN:
        child_id = find_or_create_participant(supabase, child)
        ensure_access(
            supabase, user_id=emma_user, participant_id=child_id,
            email=EMMA_EMAIL, full_name="Emma Parker", relationship="parent",
            notes="Demo: mother of a minor participant; birth certificate sighted.",
        )

    # 3. Not using portal
    ruth_id = find_or_create_participant(supabase, NOT_USING)
    supabase.table("participants").update(
        {
            "portal_not_using_reason": "unable_no_representative",
            "portal_not_using_note": "Demo: no email or nominee; coordinator asked to consider an advocate.",
            "portal_review_date": (date.today() + timedelta(days=180)).isoformat(),
            "portal_not_using_recorded_at": _now(),
        }
    ).eq("id", ruth_id).execute()
    print(f"Recorded not-using-portal for Ruth Adams ({ruth_id})")

    print(f"\nDone. Demo logins (password {PASSWORD}): {MAX_EMAIL}, {EMMA_EMAIL}")


if __name__ == "__main__":
    main()
