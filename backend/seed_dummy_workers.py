"""
Seed dummy support workers for the coordinator Workers tab demo:
- Two fully "verified" workers (onboarding complete + all mandatory credentials valid)
- Two "needs attention" workers (onboarding incomplete, few/no credentials, one with
  training assigned and one with a pending self-reported completion awaiting review)

Run: python backend/seed_dummy_workers.py
"""
import sys, os
from datetime import date, timedelta
from uuid import uuid4

sys.path.insert(0, os.path.dirname(__file__))

from app.services.supabase_client import get_supabase_admin

ORG_ID = "a1111111-1111-1111-1111-111111111111"
COORDINATOR_ID = "e704e016-689d-4d93-9577-691a5ba5879b"  # Sarah Coordinator
PASSWORD = "DummyWorker2026!"

REQUIRED_CREDENTIAL_TYPES = [
    ("ndis_screening", "NDIS Worker Screening Check", "NDIS Worker Screening Unit"),
    ("wwcc", "Working With Children Check", "State WWCC Registry"),
    ("code_of_conduct", "NDIS Code of Conduct", "NDIS Commission"),
    ("first_aid", "First Aid Certificate", "St John Ambulance"),
    ("cpr", "CPR Certificate", "St John Ambulance"),
    ("manual_handling", "Manual Handling Certificate", "SafeWork Training"),
    ("infection_control", "Infection Control Certificate", "SafeWork Training"),
    ("medication_admin", "Medication Administration Certificate", "HealthCert"),
]

WORKERS = [
    {
        "full_name": "Priya Nair",
        "email": "priya.nair@sunshine-demo.com",
        "onboarding_completed": True,
        "credentials": "all",
        "phone": "0412 555 101",
    },
    {
        "full_name": "Marcus Webb",
        "email": "marcus.webb@sunshine-demo.com",
        "onboarding_completed": True,
        "credentials": "all",
        "phone": "0412 555 102",
    },
    {
        "full_name": "Chloe Bennett",
        "email": "chloe.bennett@sunshine-demo.com",
        "onboarding_completed": False,
        "credentials": "partial",  # only screening check on file, rest missing
        "phone": "0412 555 103",
        "assign_training": True,
    },
    {
        "full_name": "Tyrone Osei",
        "email": "tyrone.osei@sunshine-demo.com",
        "onboarding_completed": False,
        "credentials": "none",  # brand new starter, nothing on file yet
        "phone": "0412 555 104",
        "pending_completion": True,
    },
]


def find_or_create_auth_user(sb, email: str, full_name: str) -> str:
    existing = sb.table("users").select("id").eq("email", email).execute()
    if existing.data:
        return existing.data[0]["id"]
    try:
        result = sb.auth.admin.create_user({
            "email": email,
            "password": PASSWORD,
            "user_metadata": {"full_name": full_name},
            "email_confirm": True,
        })
        return str(result.user.id)
    except Exception as e:
        if "already" in str(e).lower():
            users = sb.auth.admin.list_users()
            match = next((u for u in users if u.email == email), None)
            if match:
                return str(match.id)
        raise


def ensure_org_membership(sb, user_id: str):
    existing = (
        sb.table("organization_members")
        .select("user_id")
        .eq("user_id", user_id)
        .eq("organization_id", ORG_ID)
        .execute()
    )
    if existing.data:
        return
    sb.table("organization_members").insert({
        "user_id": user_id,
        "organization_id": ORG_ID,
        "role": "support_worker",
        "is_active": True,
    }).execute()


def seed_credentials(sb, user_id: str, mode: str):
    sb.table("credentials").delete().eq("user_id", user_id).execute()
    if mode == "none":
        return
    types_to_add = REQUIRED_CREDENTIAL_TYPES if mode == "all" else REQUIRED_CREDENTIAL_TYPES[:1]
    for cred_type, title, issuer in types_to_add:
        sb.table("credentials").insert({
            "id": str(uuid4()),
            "user_id": user_id,
            "organization_id": ORG_ID,
            "credential_type": cred_type,
            "title": title,
            "credential_number": f"{cred_type.upper()}-{str(uuid4())[:8]}",
            "issuer": issuer,
            "issue_date": (date.today() - timedelta(days=200)).isoformat(),
            "expiry_date": (date.today() + timedelta(days=500)).isoformat(),
            "status": "valid",
        }).execute()


def ensure_training_module(sb) -> dict:
    existing = (
        sb.table("training_modules")
        .select("id,title")
        .eq("organization_id", ORG_ID)
        .eq("title", "New Starter Induction Pack")
        .execute()
    )
    if existing.data:
        return existing.data[0]
    resp = sb.table("training_modules").insert({
        "id": str(uuid4()),
        "organization_id": ORG_ID,
        "title": "New Starter Induction Pack",
        "description": "Core NDIS induction: code of conduct, safeguarding, incident reporting basics.",
        "requires_certification": False,
        "created_by": COORDINATOR_ID,
        "is_active": True,
    }).execute()
    return resp.data[0]


def main():
    sb = get_supabase_admin()
    module = ensure_training_module(sb)
    print(f"Training module ready: {module['title']} ({module['id']})")

    for w in WORKERS:
        user_id = find_or_create_auth_user(sb, w["email"], w["full_name"])
        sb.table("users").upsert({
            "id": user_id,
            "email": w["email"],
            "full_name": w["full_name"],
            "role": "support_worker",
            "account_type": "independent_worker",
            "organization_id": ORG_ID,
            "coordinator_id": COORDINATOR_ID,
            "phone": w["phone"],
            "onboarding_completed": w["onboarding_completed"],
            "email_verified": True,
            "profile_completed": True,
        }).execute()
        ensure_org_membership(sb, user_id)
        seed_credentials(sb, user_id, w["credentials"])

        if w.get("assign_training"):
            sb.table("worker_training_recommendations").delete().eq("worker_id", user_id).execute()
            sb.table("worker_training_recommendations").insert({
                "id": str(uuid4()),
                "worker_id": user_id,
                "coordinator_id": COORDINATOR_ID,
                "organization_id": ORG_ID,
                "training_module_id": module["id"],
                "title": module["title"],
            }).execute()

        if w.get("pending_completion"):
            sb.table("worker_training_completions").delete().eq("worker_id", user_id).eq("module_id", module["id"]).execute()
            sb.table("worker_training_completions").insert({
                "id": str(uuid4()),
                "worker_id": user_id,
                "module_id": module["id"],
                "organization_id": ORG_ID,
                "completed_at": date.today().isoformat(),
                "note": "Watched the induction video and read the handbook.",
                "status": "awaiting_confirmation",
            }).execute()

        print(f"Seeded: {w['full_name']} ({user_id}) — credentials={w['credentials']}, onboarding_completed={w['onboarding_completed']}")

    print("\nDone. Password for all dummy workers:", PASSWORD)


if __name__ == "__main__":
    main()
