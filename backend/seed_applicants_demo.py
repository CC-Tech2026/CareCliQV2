"""
Seed dummy Applicants Board data for visually testing the Kanban pipeline
on /md/worker-pipeline (Applicants section): one candidate at each stage —
Applied, Interview, Offer extended, Hired, Rejected.

Offer extended / Hired rows are given a matching employee_onboarding record
so the "jump to hire record" / "signature marks Hired" behaviour has
something real to point at, same as seed_employee_onboarding_demo.py does
for the Hires view.

Run: python backend/seed_applicants_demo.py
"""
import sys, os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

sys.path.insert(0, os.path.dirname(__file__))

from app.services.supabase_client import get_supabase_admin

ORG_ID = "a1111111-1111-1111-1111-111111111111"
COORDINATOR_ID = "e704e016-689d-4d93-9577-691a5ba5879b"  # Sarah Coordinator


def _now_minus(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


APPLICANTS = [
    {
        "full_name": "Priya Nandan",
        "email": "priya.nandan@applicant-demo.com",
        "phone": "0401 111 222",
        "role": "support_worker",
        "stage": "applied",
        "stage_days_ago": 1,
        "notes": "Applied via the careers page. Has a Cert III in Individual Support.",
    },
    {
        "full_name": "Marcus Webb",
        "email": "marcus.webb@applicant-demo.com",
        "phone": "0401 222 333",
        "role": "support_worker",
        "stage": "interview",
        "stage_days_ago": 4,
        "notes": "Phone screen done, on-site interview booked for next week.",
    },
    {
        "full_name": "Aisha Rahman",
        "email": "aisha.rahman@applicant-demo.com",
        "phone": "0401 333 444",
        "role": "support_coordinator",
        "stage": "offer_extended",
        "stage_days_ago": 2,
        "notes": "Strong interview. Offer letter drafted, awaiting attachment + signature.",
    },
    {
        "full_name": "Declan Moss",
        "email": "declan.moss@applicant-demo.com",
        "phone": "0401 444 555",
        "role": "support_worker",
        "stage": "hired",
        "stage_days_ago": 10,
        "notes": "Signed and invited — see seed_employee_onboarding_demo.py for the matching hire record.",
    },
    {
        "full_name": "Tom Ferris",
        "email": "tom.ferris@applicant-demo.com",
        "phone": "0401 555 666",
        "role": "support_worker",
        "stage": "rejected",
        "stage_days_ago": 6,
        "notes": None,
        "rejected_reason": "Not enough NDIS sector experience for this intake.",
    },
]


def seed_applicant(sb, data: dict) -> None:
    existing = sb.table("applicants").select("id").eq("organization_id", ORG_ID).eq("email", data["email"]).execute()
    if existing.data:
        applicant_id = existing.data[0]["id"]
        sb.table("applicants").delete().eq("id", applicant_id).execute()

    applicant_id = str(uuid4())
    stage_entered_at = _now_minus(data["stage_days_ago"])
    record = {
        "id": applicant_id,
        "organization_id": ORG_ID,
        "full_name": data["full_name"],
        "email": data["email"],
        "phone": data.get("phone"),
        "role": data["role"],
        "stage": data["stage"],
        "notes": data.get("notes"),
        "stage_entered_at": stage_entered_at,
        "rejected_reason": data.get("rejected_reason"),
        "created_by": COORDINATOR_ID,
    }

    if data["stage"] in ("offer_extended", "hired"):
        hire_resp = sb.table("employee_onboarding").insert({
            "id": str(uuid4()),
            "organization_id": ORG_ID,
            "created_by": COORDINATOR_ID,
            "full_name": data["full_name"],
            "email": data["email"],
            "phone": data.get("phone"),
            "role": data["role"],
            "status": "invited" if data["stage"] == "hired" else "draft",
        }).execute()
        record["employee_onboarding_id"] = hire_resp.data[0]["id"]

    sb.table("applicants").insert(record).execute()
    print(f"Seeded applicant: {data['full_name']} — {data['stage']}")


def main():
    sb = get_supabase_admin()
    for applicant in APPLICANTS:
        seed_applicant(sb, applicant)
    print("\nDone. Visit /md/worker-pipeline (Applicants section) to see one candidate at each stage.")


if __name__ == "__main__":
    main()
