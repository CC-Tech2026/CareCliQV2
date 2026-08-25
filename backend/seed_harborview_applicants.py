"""Seed sample Staff Onboarding pipeline data (applicants + employee_onboarding
hires) for Harbor View Supports, which had zero pipeline records because its
workers were seeded directly as active accounts rather than run through the
interview -> offer -> hire flow. Idempotent: skips rows that already exist
by (organization_id, email).
"""

from datetime import datetime, timedelta, timezone

from app.services.supabase_client import get_supabase_admin

ORG_ID = "20000000-0000-4000-8000-000000000002"
CREATED_BY = "10000000-0000-4000-8000-000000000201"  # Lisa Nguyen, support_coordinator

NOW = datetime.now(timezone.utc)


def iso(days_ago: int) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


APPLICANTS = [
    {
        "full_name": "Rosalind Carter",
        "email": "rosalind.carter@applicant-demo.com",
        "phone": "0402 111 222",
        "role": "support_worker",
        "stage": "interview",
        "notes": "Applied via careers page. 3 years disability support experience, Cert III in Individual Support.",
        "stage_entered_at": iso(2),
        "created_at": iso(4),
    },
    {
        "full_name": "Nathan Pryce",
        "email": "nathan.pryce@applicant-demo.com",
        "phone": "0402 222 333",
        "role": "support_worker",
        "stage": "interview",
        "notes": "Referred by James Obi. Strong manual handling background, First Aid current.",
        "stage_entered_at": iso(1),
        "created_at": iso(3),
    },
    {
        "full_name": "Imani Osei",
        "email": "imani.osei@applicant-demo.com",
        "phone": "0402 333 444",
        "role": "support_coordinator",
        "stage": "interview",
        "notes": "5 years NDIS coordination experience, currently at another provider.",
        "stage_entered_at": iso(1),
        "created_at": iso(2),
    },
]

HIRES = [
    {
        "full_name": "Callum Fitzroy",
        "email": "callum.fitzroy@harborview-demo.com",
        "phone": "0402 444 555",
        "role": "support_worker",
        "status": "draft",
        "created_at": iso(5),
    },
    {
        "full_name": "Priyanka Bose",
        "email": "priyanka.bose@harborview-demo.com",
        "phone": "0402 555 666",
        "role": "support_worker",
        "status": "awaiting_signatures",
        "employer_signed_by": CREATED_BY,
        "employer_signed_name": "Lisa Nguyen",
        "employer_signed_at": iso(2),
        "created_at": iso(6),
    },
    {
        "full_name": "Owen Blackwood",
        "email": "owen.blackwood@harborview-demo.com",
        "phone": "0402 666 777",
        "role": "support_worker",
        "status": "invited",
        "employer_signed_by": CREATED_BY,
        "employer_signed_name": "Lisa Nguyen",
        "employer_signed_at": iso(4),
        "worker_signed_name": "Owen Blackwood",
        "worker_signed_at": iso(3),
        "created_at": iso(7),
    },
    {
        "full_name": "Freya Lindqvist",
        "email": "freya.lindqvist@harborview-demo.com",
        "phone": "0402 777 888",
        "role": "support_worker",
        "status": "invited",
        "employer_signed_by": CREATED_BY,
        "employer_signed_name": "Lisa Nguyen",
        "employer_signed_at": iso(3),
        "worker_signed_name": "Freya Lindqvist",
        "worker_signed_at": iso(2),
        "created_at": iso(5),
    },
]


def main():
    sb = get_supabase_admin()

    print("=== Applicants ===")
    for a in APPLICANTS:
        existing = (
            sb.table("applicants")
            .select("id")
            .eq("organization_id", ORG_ID)
            .eq("email", a["email"])
            .limit(1)
            .execute()
        )
        if existing.data:
            print(f"skip (exists): {a['full_name']}")
            continue
        now_iso = NOW.isoformat()
        row = {
            **a,
            "organization_id": ORG_ID,
            "created_by": CREATED_BY,
            "updated_at": now_iso,
        }
        sb.table("applicants").insert(row).execute()
        print(f"created: {a['full_name']} ({a['stage']})")

    print()
    print("=== Employee onboarding (hires) ===")
    for h in HIRES:
        existing = (
            sb.table("employee_onboarding")
            .select("id")
            .eq("organization_id", ORG_ID)
            .eq("email", h["email"])
            .limit(1)
            .execute()
        )
        if existing.data:
            print(f"skip (exists): {h['full_name']}")
            continue
        now_iso = NOW.isoformat()
        row = {
            **h,
            "organization_id": ORG_ID,
            "created_by": CREATED_BY,
            "updated_at": now_iso,
        }
        sb.table("employee_onboarding").insert(row).execute()
        print(f"created: {h['full_name']} ({h['status']})")


if __name__ == "__main__":
    main()
