"""
Seed data for testing the Employee Onboarding flow end to end (spec §4.1):
- A mandatory "NDIS Worker Orientation" training module flagged auto_assign_on_hire,
  so accepting a new-hire invite live actually auto-assigns it.
- Four New Hire records (onboard-employee.tsx), one at each pipeline stage:
  draft, draft-with-documents, awaiting_signatures (with a real /onboarding-sign
  link), and signed (ready to invite).
- One existing worker with an ndis_screening credential expiring inside the
  60-day recheck window, so the new recheck reminder + coordinator "Mark
  rechecked" button in /credentials have something to act on.
- One existing worker with overdue mandatory training, so the rostering hard
  gate (coordinator.py) actually blocks an assignment attempt.

Run: python backend/seed_employee_onboarding_demo.py
"""
import sys, os
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

sys.path.insert(0, os.path.dirname(__file__))

from app.services.supabase_client import get_supabase_admin

ORG_ID = "a1111111-1111-1111-1111-111111111111"
COORDINATOR_ID = "e704e016-689d-4d93-9577-691a5ba5879b"  # Sarah Coordinator
PASSWORD = "DummyWorker2026!"


def ensure_orientation_module(sb) -> dict:
    existing = (
        sb.table("training_modules")
        .select("id, title")
        .eq("organization_id", ORG_ID)
        .eq("title", "NDIS Worker Orientation")
        .execute()
    )
    if existing.data:
        module = existing.data[0]
    else:
        resp = sb.table("training_modules").insert({
            "id": str(uuid4()),
            "organization_id": ORG_ID,
            "title": "NDIS Worker Orientation",
            "description": "Mandatory induction covering the NDIS Code of Conduct, "
                            "worker screening obligations, and incident reporting basics. "
                            "Auto-assigned to every new hire on account acceptance.",
            "requires_certification": True,
            "created_by": COORDINATOR_ID,
            "is_active": True,
        }).execute()
        module = resp.data[0]
    sb.table("training_modules").update({"auto_assign_on_hire": True}).eq("id", module["id"]).execute()
    print(f"Mandatory induction module ready (auto_assign_on_hire=true): {module['title']} ({module['id']})")
    return module


HIRES = [
    {
        "full_name": "Jordan Kelly",
        "email": "jordan.kelly@sunshine-demo.com",
        "phone": "0412 555 201",
        "role": "support_worker",
        "stage": "draft_no_documents",
    },
    {
        "full_name": "Amara Osei",
        "email": "amara.osei@sunshine-demo.com",
        "phone": "0412 555 202",
        "role": "support_worker",
        "stage": "draft_with_documents",
    },
    {
        "full_name": "Liam Fitzgerald",
        "email": "liam.fitzgerald@sunshine-demo.com",
        "phone": "0412 555 203",
        "role": "support_worker",
        "stage": "awaiting_signatures",
    },
    {
        "full_name": "Priya Chandran",
        "email": "priya.chandran@sunshine-demo.com",
        "phone": "0412 555 204",
        "role": "support_coordinator",
        "stage": "signed",
    },
]


def seed_hire(sb, hire: dict):
    # Idempotent: wipe any prior seed run for this email first.
    existing = sb.table("employee_onboarding").select("id").eq("organization_id", ORG_ID).eq("email", hire["email"]).execute()
    for row in existing.data or []:
        sb.table("employee_onboarding_documents").delete().eq("onboarding_id", row["id"]).execute()
        sb.table("employee_onboarding").delete().eq("id", row["id"]).execute()

    hire_id = str(uuid4())
    now = datetime.now(timezone.utc)
    record = {
        "id": hire_id,
        "organization_id": ORG_ID,
        "created_by": COORDINATOR_ID,
        "full_name": hire["full_name"],
        "email": hire["email"],
        "phone": hire["phone"],
        "role": hire["role"],
        "status": "draft",
    }
    sb.table("employee_onboarding").insert(record).execute()

    if hire["stage"] == "draft_no_documents":
        print(f"Seeded: {hire['full_name']} — draft, no documents yet")
        return

    docs = [
        {
            "id": str(uuid4()),
            "onboarding_id": hire_id,
            "document_type": "offer_letter",
            "title": f"Offer of Employment — {hire['full_name']}",
            "notes": "Standard support worker offer, casual rate.",
        },
        {
            "id": str(uuid4()),
            "onboarding_id": hire_id,
            "document_type": "service_agreement",
            "title": f"Independent Support Worker Agreement — {hire['full_name']}",
            "notes": "Standard service agreement.",
        },
    ]
    for d in docs:
        sb.table("employee_onboarding_documents").insert(d).execute()

    if hire["stage"] == "draft_with_documents":
        print(f"Seeded: {hire['full_name']} — draft, documents attached, ready to send for signature")
        return

    if hire["stage"] == "awaiting_signatures":
        sign_token = uuid4().hex + uuid4().hex[:16]
        sb.table("employee_onboarding").update({
            "status": "awaiting_signatures",
            "sign_token": sign_token,
            "employer_signed_by": COORDINATOR_ID,
            "employer_signed_name": "Sarah Coordinator",
            "employer_signed_at": now.isoformat(),
        }).eq("id", hire_id).execute()
        print(f"Seeded: {hire['full_name']} — awaiting applicant signature")
        print(f"  Sign link: /onboarding-sign?token={sign_token}")
        return

    if hire["stage"] == "signed":
        sb.table("employee_onboarding").update({
            "status": "signed",
            "sign_token": uuid4().hex + uuid4().hex[:16],
            "employer_signed_by": COORDINATOR_ID,
            "employer_signed_name": "Sarah Coordinator",
            "employer_signed_at": (now - timedelta(days=2)).isoformat(),
            "worker_signed_name": hire["full_name"],
            "worker_signed_at": (now - timedelta(days=1)).isoformat(),
        }).eq("id", hire_id).execute()
        print(f"Seeded: {hire['full_name']} — both signed, ready to send login invite")
        return


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


def ensure_org_membership(sb, user_id: str, role: str = "support_worker"):
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
        "role": role,
        "is_active": True,
    }).execute()


def seed_screening_recheck_worker(sb):
    """Existing worker with an ndis_screening credential expiring in 45 days —
    inside the 60-day recheck window — so the screening_recheck_service pass
    and the /credentials "Mark rechecked" action have something to act on."""
    email = "nadia.farrow@sunshine-demo.com"
    full_name = "Nadia Farrow"
    user_id = find_or_create_auth_user(sb, email, full_name)
    sb.table("users").upsert({
        "id": user_id,
        "email": email,
        "full_name": full_name,
        "role": "support_worker",
        "account_type": "independent_worker",
        "organization_id": ORG_ID,
        "coordinator_id": COORDINATOR_ID,
        "onboarding_completed": True,
        "email_verified": True,
        "profile_completed": True,
    }).execute()
    ensure_org_membership(sb, user_id)

    sb.table("credentials").delete().eq("user_id", user_id).eq("credential_type", "ndis_screening").execute()
    sb.table("credentials").insert({
        "id": str(uuid4()),
        "user_id": user_id,
        "organization_id": ORG_ID,
        "credential_type": "ndis_screening",
        "title": "NDIS Worker Screening Check",
        "screening_number": "WWC4471829301",
        "issuer": "NDIS Worker Screening Unit",
        "issue_date": (date.today() - timedelta(days=1780)).isoformat(),
        "expiry_date": (date.today() + timedelta(days=45)).isoformat(),
        "status": "valid",
        "verified_by": COORDINATOR_ID,
        "verified_at": (date.today() - timedelta(days=1780)).isoformat(),
    }).execute()
    print(f"Seeded: {full_name} — NDIS screening expiring in 45 days (inside recheck window)")


def seed_training_overdue_worker(sb, module: dict):
    """Existing worker with the mandatory module assigned and overdue, with no
    completion on file — so attempting to roster them hits the new hard gate
    in coordinator.py (POST /coordinator/shifts)."""
    email = "declan.moss@sunshine-demo.com"
    full_name = "Declan Moss"
    user_id = find_or_create_auth_user(sb, email, full_name)
    sb.table("users").upsert({
        "id": user_id,
        "email": email,
        "full_name": full_name,
        "role": "support_worker",
        "account_type": "independent_worker",
        "organization_id": ORG_ID,
        "coordinator_id": COORDINATOR_ID,
        "onboarding_completed": True,
        "email_verified": True,
        "profile_completed": True,
    }).execute()
    ensure_org_membership(sb, user_id)

    # Give them valid credentials so the *only* thing blocking rostering is
    # the overdue training — isolates the new gate from the existing one.
    sb.table("credentials").delete().eq("user_id", user_id).execute()
    for cred_type, title, issuer in [
        ("ndis_screening", "NDIS Worker Screening Check", "NDIS Worker Screening Unit"),
        ("wwcc", "Working With Children Check", "State WWCC Registry"),
        ("first_aid", "First Aid Certificate", "St John Ambulance"),
        ("cpr", "CPR Certificate", "St John Ambulance"),
    ]:
        sb.table("credentials").insert({
            "id": str(uuid4()),
            "user_id": user_id,
            "organization_id": ORG_ID,
            "credential_type": cred_type,
            "title": title,
            "issuer": issuer,
            "issue_date": (date.today() - timedelta(days=200)).isoformat(),
            "expiry_date": (date.today() + timedelta(days=500)).isoformat(),
            "status": "valid",
            "verified_by": COORDINATOR_ID,
            "verified_at": (date.today() - timedelta(days=200)).isoformat(),
        }).execute()

    sb.table("worker_training_recommendations").delete().eq("worker_id", user_id).eq("training_module_id", module["id"]).execute()
    overdue_due_at = datetime.now(timezone.utc) - timedelta(days=3)
    sb.table("worker_training_recommendations").insert({
        "id": str(uuid4()),
        "worker_id": user_id,
        "coordinator_id": COORDINATOR_ID,
        "organization_id": ORG_ID,
        "training_module_id": module["id"],
        "title": module["title"],
        "recommended_at": (overdue_due_at - timedelta(days=7)).isoformat(),
        "due_at": overdue_due_at.isoformat(),
    }).execute()
    print(f"Seeded: {full_name} — mandatory training overdue (rostering should be blocked)")
    return user_id


def main():
    sb = get_supabase_admin()
    module = ensure_orientation_module(sb)

    for hire in HIRES:
        seed_hire(sb, hire)

    seed_screening_recheck_worker(sb)
    seed_training_overdue_worker(sb, module)

    print("\nDone.")
    print("MD login: director@sunshine-demo.com / Director123! (run seed_md_user.py first if not already)")
    print("Coordinator: use the existing dev coordinator account.")
    print(f"Dummy account password (Nadia Farrow, Declan Moss): {PASSWORD}")
    print("\nNext: visit /onboard-employee as the MD to see the four hires at each pipeline stage.")


if __name__ == "__main__":
    main()
