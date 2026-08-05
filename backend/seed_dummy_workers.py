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


TRAINING_MODULES = [
    {
        "title": "Welcome to CareCliQ",
        "description": "Meet the team, learn our mission and values, and get set up on the app before your first shift.",
        "requires_certification": False,
    },
    {
        "title": "New Starter Induction Pack",
        "description": "Core NDIS induction: code of conduct, safeguarding, incident reporting basics.",
        "requires_certification": False,
    },
    {
        "title": "NDIS Practice Standards Refresher",
        "description": "Overview of the NDIS Practice Standards and how they apply to day-to-day support work.",
        "requires_certification": True,
    },
    {
        "title": "Manual Handling & Injury Prevention",
        "description": "Safe lifting, transfers, and equipment use to protect yourself and the people you support.",
        "requires_certification": True,
    },
    {
        "title": "Medication Support Basics",
        "description": "Assisting with medication safely, recognising errors, and when to escalate.",
        "requires_certification": True,
    },
    {
        "title": "Incident Reporting & Duty of Care",
        "description": "What counts as a reportable incident, timeframes, and how to document what happened.",
        "requires_certification": False,
    },
]


def ensure_training_modules(sb) -> list[dict]:
    modules = []
    for m in TRAINING_MODULES:
        existing = (
            sb.table("training_modules")
            .select("id,title")
            .eq("organization_id", ORG_ID)
            .eq("title", m["title"])
            .execute()
        )
        if existing.data:
            modules.append(existing.data[0])
            continue
        resp = sb.table("training_modules").insert({
            "id": str(uuid4()),
            "organization_id": ORG_ID,
            "title": m["title"],
            "description": m["description"],
            "requires_certification": m["requires_certification"],
            "created_by": COORDINATOR_ID,
            "is_active": True,
        }).execute()
        modules.append(resp.data[0])
    return modules


def seed_onboarding_documents(sb, user_id: str, full_name: str, onboarding_completed: bool):
    sb.table("worker_onboarding_documents").delete().eq("worker_id", user_id).execute()
    first_name = full_name.split(" ")[0]
    docs = [
        {
            "document_type": "offer_letter",
            "title": f"Offer of Employment — {full_name}",
            "notes": f"Signed offer letter countersigned by {first_name}.",
        },
        {
            "document_type": "service_agreement",
            "title": f"Independent Support Worker Agreement — {full_name}",
            "notes": "Standard service agreement, reviewed annually.",
        },
    ]
    if not onboarding_completed:
        docs.append({
            "document_type": "other",
            "title": "Right to Work Verification (pending)",
            "notes": "Awaiting certified copy of visa/citizenship document from worker.",
        })
    for d in docs:
        sb.table("worker_onboarding_documents").insert({
            "id": str(uuid4()),
            "worker_id": user_id,
            "organization_id": ORG_ID,
            "document_type": d["document_type"],
            "title": d["title"],
            "notes": d["notes"],
            "uploaded_by": COORDINATOR_ID,
        }).execute()


def main():
    sb = get_supabase_admin()
    modules = ensure_training_modules(sb)
    module = next(m for m in modules if m["title"] == "New Starter Induction Pack")
    for m in modules:
        print(f"Training module ready: {m['title']} ({m['id']})")

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
        seed_onboarding_documents(sb, user_id, w["full_name"], w["onboarding_completed"])

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
