"""One-off: creates (or repairs) the CareCliQ vendor-side super_admin account
for the Super Admin Portal. Safe to re-run — upserts the public.users row
either way, and skips auth user creation if the email already exists.

Credentials come from the environment, never hardcoded here — this script
lives in git history indefinitely, so a literal password here would too.

Usage:
    SUPER_ADMIN_EMAIL=admin@cctechaustralia.com \\
    SUPER_ADMIN_PASSWORD='...' \\
    python3 scripts/seed_super_admin.py
"""

import os
import sys

from app.services.supabase_client import get_supabase_admin

EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "")
PASSWORD = os.environ.get("SUPER_ADMIN_PASSWORD", "")
FULL_NAME = os.environ.get("SUPER_ADMIN_FULL_NAME", "CareCliQ Admin")


def main() -> None:
    if not EMAIL or not PASSWORD:
        sys.exit("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD before running this script.")

    supabase = get_supabase_admin()

    auth_user_id = None
    try:
        result = supabase.auth.admin.create_user(
            {
                "email": EMAIL,
                "password": PASSWORD,
                "user_metadata": {"full_name": FULL_NAME},
                "email_confirm": True,
            }
        )
        auth_user_id = str(result.user.id)
        print(f"Created auth user: {auth_user_id}")
    except Exception as exc:
        msg = str(exc).lower()
        if "already" in msg and "regist" in msg or "already exists" in msg:
            # Look the existing auth user up by paging (admin API has no get-by-email).
            page = 1
            while auth_user_id is None:
                listed = supabase.auth.admin.list_users(page=page, per_page=200)
                users = listed.users if hasattr(listed, "users") else listed
                if not users:
                    break
                for u in users:
                    if (u.email or "").lower() == EMAIL.lower():
                        auth_user_id = str(u.id)
                        break
                page += 1
            if auth_user_id:
                print(f"Auth user already existed: {auth_user_id}")
            else:
                raise RuntimeError("Could not locate existing auth user for this email") from exc
        else:
            raise

    supabase.table("users").upsert(
        {
            "id": auth_user_id,
            "email": EMAIL,
            "role": "super_admin",
            "full_name": FULL_NAME,
            "is_active": True,
            "organization_id": None,
            "onboarding_complete": True,
            "email_verified": True,
            "profile_completed": True,
        }
    ).execute()
    print(f"public.users row upserted for {EMAIL} with role=super_admin")


if __name__ == "__main__":
    main()
