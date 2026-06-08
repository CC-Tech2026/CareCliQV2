"""
Seed a demo Managing Director user.

Run AFTER running the managing_director constraint patch in Supabase SQL editor:
  python3 backend/seed_md_user.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.services.supabase_client import get_supabase_admin

ORG_ID    = "a1111111-1111-1111-1111-111111111111"
EMAIL     = "director@sunshine-demo.com"
PASSWORD  = "Director123!"
FULL_NAME = "Alex Director"

def main():
    sb = get_supabase_admin()

    # 1. Find or create auth user
    existing = sb.table("users").select("id").eq("email", EMAIL).execute()
    if existing.data:
        user_id = existing.data[0]["id"]
        print(f"User already exists in public.users: {user_id}")
    else:
        # Check auth — the auth user may already exist from a failed previous run
        try:
            result = sb.auth.admin.create_user({
                "email": EMAIL,
                "password": PASSWORD,
                "user_metadata": {"full_name": FULL_NAME},
                "email_confirm": True,
            })
            auth_user = result.user
            if not auth_user:
                print("ERROR: Supabase auth.admin.create_user returned no user")
                sys.exit(1)
            user_id = str(auth_user.id)
            print(f"Created auth user: {user_id}")
        except Exception as e:
            err = str(e)
            if "already" in err.lower():
                # Auth user exists but public row doesn't — find it
                users = sb.auth.admin.list_users()
                match = next((u for u in users if u.email == EMAIL), None)
                if not match:
                    print(f"ERROR: could not find existing auth user for {EMAIL}: {e}")
                    sys.exit(1)
                user_id = str(match.id)
                print(f"Reusing existing auth user: {user_id}")
            else:
                print(f"ERROR creating auth user: {e}")
                sys.exit(1)

    # 2. Upsert public.users profile
    sb.table("users").upsert({
        "id": user_id,
        "email": EMAIL,
        "full_name": FULL_NAME,
        "role": "managing_director",
        "account_type": "managing_director",
        "organization_id": ORG_ID,
        "onboarding_complete": True,
        "email_verified": True,
        "profile_completed": True,
    }).execute()
    print("Upserted public.users profile")

    # 3. Verify
    row = sb.table("users").select(
        "id, email, full_name, role, organization_id, onboarding_complete"
    ).eq("id", user_id).single().execute()
    print(f"\nVerified: {row.data}")
    print(f"\n{'='*50}")
    print(f"  MD Demo Account Ready")
    print(f"  Email:    {EMAIL}")
    print(f"  Password: {PASSWORD}")
    print(f"  Role:     managing_director")
    print(f"{'='*50}")

if __name__ == "__main__":
    main()
