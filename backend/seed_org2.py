"""
Seed a second demo organisation for multi-tenant testing.

Creates:
  - Org 2: "Harbor View Supports"  (org_id: 20000000-0000-4000-8000-000000000002)
  - lisa@harborview-demo.com   / Lisaharbor#2026   (support_coordinator)
  - james@harborview-demo.com  / Jamesharbor#2026  (support_worker)
  - priya@harborview-demo.com  / Priyaharbor#2026  (allied_health)
  - 2 patients, 2 sessions

Run from the project root (inside or outside Docker):

  docker compose exec backend python3 seed_org2.py

Or if running the backend locally:

  cd backend && python3 seed_org2.py
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.services.supabase_client import get_supabase_admin

# ── IDs (deterministic so re-runs are idempotent) ────────────────────────────

ORG_ID = "20000000-0000-4000-8000-000000000002"

USERS = [
    {
        "id":           "10000000-0000-4000-8000-000000000201",
        "email":        "lisa@harborview-demo.com",
        "password":     "Lisaharbor#2026",
        "full_name":    "Lisa Nguyen",
        "role":         "support_coordinator",
        "account_type": "small_provider",
    },
    {
        "id":           "10000000-0000-4000-8000-000000000202",
        "email":        "james@harborview-demo.com",
        "password":     "Jamesharbor#2026",
        "full_name":    "James Obi",
        "role":         "support_worker",
        "account_type": "independent_worker",
    },
    {
        "id":           "10000000-0000-4000-8000-000000000203",
        "email":        "priya@harborview-demo.com",
        "password":     "Priyaharbor#2026",
        "full_name":    "Priya Sharma",
        "role":         "allied_health",
        "account_type": "allied_health",
    },
]

COORDINATOR_ID = USERS[0]["id"]
WORKER_ID      = USERS[1]["id"]
ALLIED_ID      = USERS[2]["id"]

PATIENTS = [
    {
        "id":                "30000000-0000-4000-8000-000000000201",
        "full_name":         "Liam Torres",
        "ndis_number":       "NDIS-HBR-001",
        "date_of_birth":     "2009-03-14",
        "email":             "liam.torres@example.com",
        "phone":             "0411 100 200",
        "plan_status":       "active",
        "plan_start_date":   "2026-01-01",
        "plan_end_date":     "2026-12-31",
        "total_budget":      48000.00,
        "used_budget":       9200.00,
        "primary_disability":"Down Syndrome",
        "goals": [
            {"id": "goal_liam_1", "title": "Build numeracy skills", "status": "active"},
            {"id": "goal_liam_2", "title": "Increase social confidence", "status": "active"},
        ],
        "assigned_worker_id": WORKER_ID,
        "allied_health_id":   None,
    },
    {
        "id":                "30000000-0000-4000-8000-000000000202",
        "full_name":         "Amelia Park",
        "ndis_number":       "NDIS-HBR-002",
        "date_of_birth":     "1992-07-29",
        "email":             "amelia.park@example.com",
        "phone":             "0422 300 400",
        "plan_status":       "active",
        "plan_start_date":   "2026-03-01",
        "plan_end_date":     "2027-02-28",
        "total_budget":      62000.00,
        "used_budget":       15800.00,
        "primary_disability":"Multiple Sclerosis",
        "goals": [
            {"id": "goal_amelia_1", "title": "Maintain independent living skills", "status": "active"},
            {"id": "goal_amelia_2", "title": "Improve fatigue management", "status": "active"},
        ],
        "assigned_worker_id": None,
        "allied_health_id":   ALLIED_ID,
    },
]

SESSIONS = [
    {
        "id":             "40000000-0000-4000-8000-000000000201",
        "patient_id":     PATIENTS[0]["id"],
        "worker_id":      WORKER_ID,
        "practitioner_id":None,
        "session_type":   "community_access",
        "duration_minutes": 90,
        "notes":          "Liam practised counting change at the local shops and interacted with two unfamiliar adults. He used his communication card once and completed the task independently.",
        "status":         "completed",
        "compliance_score": 90,
        "goals_addressed": ["goal_liam_2"],
    },
    {
        "id":             "40000000-0000-4000-8000-000000000202",
        "patient_id":     PATIENTS[1]["id"],
        "worker_id":      None,
        "practitioner_id": ALLIED_ID,
        "session_type":   "occupational_therapy",
        "duration_minutes": 60,
        "notes":          "Amelia completed energy conservation strategies review and practised task pacing in the kitchen. She reported reduced fatigue after implementing rest breaks.",
        "status":         "completed",
        "compliance_score": 87,
        "goals_addressed": ["goal_amelia_2"],
    },
]


def _create_or_find_auth_user(sb, user: dict) -> str:
    """Create an auth user; return the user_id regardless of whether it already exists."""
    try:
        result = sb.auth.admin.create_user({
            "email":          user["email"],
            "password":       user["password"],
            "user_metadata":  {"full_name": user["full_name"]},
            "email_confirm":  True,
        })
        auth_user = result.user
        if not auth_user:
            print(f"  ERROR: no auth user returned for {user['email']}")
            sys.exit(1)
        uid = str(auth_user.id)
        print(f"  Created auth user: {uid}  ({user['email']})")
        return uid
    except Exception as e:
        err = str(e).lower()
        if "already" in err or "exists" in err:
            users = sb.auth.admin.list_users()
            match = next((u for u in users if u.email == user["email"]), None)
            if not match:
                print(f"  ERROR: existing auth user not found for {user['email']}: {e}")
                sys.exit(1)
            uid = str(match.id)
            print(f"  Reusing existing auth user: {uid}  ({user['email']})")
            return uid
        print(f"  ERROR creating auth user {user['email']}: {e}")
        sys.exit(1)


def main():
    sb = get_supabase_admin()

    # ── 1. Auth users ─────────────────────────────────────────────────────────
    print("\n[1/6] Creating auth users ...")
    for user in USERS:
        uid = _create_or_find_auth_user(sb, user)
        user["_resolved_id"] = uid

    # ── 2. Organisation ───────────────────────────────────────────────────────
    print("\n[2/6] Upserting organisation ...")
    sb.table("organizations").upsert({
        "id":                  ORG_ID,
        "owner_user_id":       COORDINATOR_ID,
        "organization_name":   "Harbor View Supports",
        "provider_type":       "support_coord",
        "registration_status": "registered_ndis",
        "team_size":           "2-10",
        "participant_volume":  "1-25",
        "contact_number":      "02 5550 2027",
    }, on_conflict="id").execute()
    print(f"  org_id: {ORG_ID}")

    # ── 3. public.users profiles ──────────────────────────────────────────────
    print("\n[3/6] Upserting public.users profiles ...")
    for user in USERS:
        sb.table("users").upsert({
            "id":                              user["id"],
            "email":                           user["email"],
            "full_name":                       user["full_name"],
            "role":                            user["role"],
            "account_type":                    user["account_type"],
            "onboarding_complete":             True,
            "email_verified":                  True,
            "profile_completed":               True,
            "onboarding_completed":            True,
            "role_specific_profile_completed": True,
            "organization_id":                 ORG_ID,
            "is_active":                       True,
        }, on_conflict="id").execute()
        print(f"  {user['full_name']}  ({user['role']})")

    # ── 4. organization_members ───────────────────────────────────────────────
    print("\n[4/6] Upserting organization_members ...")
    for user in USERS:
        sb.table("organization_members").upsert({
            "user_id":         user["id"],
            "organization_id": ORG_ID,
            "role":            user["role"],
            "is_active":       True,
            "invited_by":      COORDINATOR_ID,
        }, on_conflict="user_id,organization_id").execute()
        print(f"  member: {user['full_name']}")

    # ── 5. Patients ───────────────────────────────────────────────────────────
    print("\n[5/6] Upserting patients ...")
    import json
    for p in PATIENTS:
        sb.table("patients").upsert({
            "id":                p["id"],
            "organization_id":   ORG_ID,
            "full_name":         p["full_name"],
            "ndis_number":       p["ndis_number"],
            "date_of_birth":     p["date_of_birth"],
            "email":             p["email"],
            "phone":             p["phone"],
            "plan_status":       p["plan_status"],
            "plan_start_date":   p["plan_start_date"],
            "plan_end_date":     p["plan_end_date"],
            "total_budget":      p["total_budget"],
            "used_budget":       p["used_budget"],
            "primary_disability":p["primary_disability"],
            "goals":             p["goals"],
            "assigned_worker_id":p["assigned_worker_id"],
            "allied_health_id":  p["allied_health_id"],
            "created_by":        COORDINATOR_ID,
            "owner_user_id":     COORDINATOR_ID,
        }, on_conflict="id").execute()
        print(f"  {p['full_name']}  (NDIS: {p['ndis_number']})")

    # ── 5b. practitioner_allocations ─────────────────────────────────────────
    allocs = [
        {"patient_id": PATIENTS[0]["id"], "user_id": WORKER_ID, "allocated_role": "support_worker"},
        {"patient_id": PATIENTS[1]["id"], "user_id": ALLIED_ID, "allocated_role": "allied_health"},
    ]
    for a in allocs:
        sb.table("practitioner_allocations").upsert({
            **a,
            "organization_id": ORG_ID,
            "assigned_by":     COORDINATOR_ID,
            "is_active":       True,
        }, on_conflict="patient_id,user_id").execute()

    # ── 6. Sessions ───────────────────────────────────────────────────────────
    print("\n[6/6] Upserting sessions ...")
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    for i, s in enumerate(SESSIONS):
        session_date = (now - timedelta(days=i + 1)).isoformat()
        sb.table("sessions").upsert({
            "id":                       s["id"],
            "patient_id":               s["patient_id"],
            "organization_id":          ORG_ID,
            "worker_id":                s["worker_id"],
            "practitioner_id":          s["practitioner_id"],
            "session_date":             session_date,
            "session_type":             s["session_type"],
            "duration_minutes":         s["duration_minutes"],
            "notes":                    s["notes"],
            "translated_english_note":  s["notes"],
            "compliance_input_text":    s["notes"],
            "original_language_input":  s["notes"],
            "detected_language":        "en",
            "translation_status":       "not_required",
            "translation_provider":     "none",
            "translation_confidence":   1.0,
            "translation_metadata":     {"source": "demo_seed"},
            "translation_completed_at": now.isoformat(),
            "status":                   s["status"],
            "compliance_score":         s["compliance_score"],
            "goals_addressed":          s["goals_addressed"],
            "created_by":               s["worker_id"] or s["practitioner_id"],
            "owner_user_id":            s["worker_id"] or s["practitioner_id"],
        }, on_conflict="id").execute()
        patient_name = next(p["full_name"] for p in PATIENTS if p["id"] == s["patient_id"])
        print(f"  {s['session_type']} — {patient_name}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"""
{'='*56}
  Org 2 Seed Complete — Harbor View Supports
{'='*56}
  Org ID:   {ORG_ID}

  Coordinator:   {USERS[0]['email']}  /  {USERS[0]['password']}
  Worker:        {USERS[1]['email']}  /  {USERS[1]['password']}
  Allied Health: {USERS[2]['email']}  /  {USERS[2]['password']}

  Patients: Liam Torres, Amelia Park
  Sessions: 2 completed
{'='*56}
""")


if __name__ == "__main__":
    main()
