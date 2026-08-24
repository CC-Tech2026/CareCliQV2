"""
Expand the Harbor View Supports demo organisation (seed_org2.py) with a
managing director, 4 more support workers (5 total incl. James Obi), and
6 more participants (8 total incl. Liam Torres and Amelia Park) — plus
WWCC + NDIS Worker Screening credentials for every support worker, so the
org has a realistic MD-level view (staff compliance, workforce, financial).

Idempotent — safe to re-run. Continues the deterministic ID scheme from
seed_org2.py (10000000-...-02XX for users, 30000000-...-02XX for patients).

Run from the project root:

  cd backend && python3 seed_org2_expansion.py
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import date, datetime, timezone, timedelta
from app.services.supabase_client import get_supabase_admin

ORG_ID = "20000000-0000-4000-8000-000000000002"
EXISTING_COORDINATOR_ID = "10000000-0000-4000-8000-000000000201"  # Lisa Nguyen
EXISTING_WORKER_ID = "10000000-0000-4000-8000-000000000202"       # James Obi
EXISTING_ALLIED_ID = "10000000-0000-4000-8000-000000000203"       # Priya Sharma

NEW_USERS = [
    {
        "id":           "10000000-0000-4000-8000-000000000204",
        "email":        "morgan@harborview-demo.com",
        "password":     "MorganHarbor#2026",
        "full_name":    "Morgan Reid",
        "role":         "managing_director",
        "account_type": "managing_director",
        "phone":        "0433 512 800",
        "address":      "8 Esplanade, Glenelg SA",
        "date_of_birth": "1978-11-02",
    },
    {
        "id":           "10000000-0000-4000-8000-000000000205",
        "email":        "tara@harborview-demo.com",
        "password":     "TaraHarbor#2026",
        "full_name":    "Tara Fields",
        "role":         "support_worker",
        "account_type": "independent_worker",
        "phone":        "0412 774 210",
        "address":      "15 Jetty Road, Brighton SA",
        "date_of_birth": "1994-05-19",
    },
    {
        "id":           "10000000-0000-4000-8000-000000000206",
        "email":        "ben@harborview-demo.com",
        "password":     "BenHarbor#2026",
        "full_name":    "Ben Okoye",
        "role":         "support_worker",
        "account_type": "independent_worker",
        "phone":        "0421 663 517",
        "address":      "3 Anzac Highway, Plympton SA",
        "date_of_birth": "1989-02-08",
    },
    {
        "id":           "10000000-0000-4000-8000-000000000207",
        "email":        "chloe@harborview-demo.com",
        "password":     "ChloeHarbor#2026",
        "full_name":    "Chloe Winters",
        "role":         "support_worker",
        "account_type": "independent_worker",
        "phone":        "0455 209 344",
        "address":      "41 Diagonal Road, Warradale SA",
        "date_of_birth": "1997-09-27",
    },
    {
        "id":           "10000000-0000-4000-8000-000000000208",
        "email":        "diego@harborview-demo.com",
        "password":     "DiegoHarbor#2026",
        "full_name":    "Diego Alvarez",
        "role":         "support_worker",
        "account_type": "independent_worker",
        "phone":        "0466 981 023",
        "address":      "27 Marion Road, Marion SA",
        "date_of_birth": "1991-12-15",
    },
]

MD_ID = NEW_USERS[0]["id"]
ALL_WORKER_IDS = [EXISTING_WORKER_ID] + [u["id"] for u in NEW_USERS[1:]]

NEW_PATIENTS = [
    {
        "id":                 "30000000-0000-4000-8000-000000000203",
        "full_name":          "Noah Fitzgerald",
        "ndis_number":        "NDIS-HBR-003",
        "date_of_birth":      "2011-06-04",
        "email":              "noah.fitzgerald@example.com",
        "phone":              "0433 100 203",
        "address":            "12 Seaview Road, Henley Beach SA",
        "biological_sex":     "male",
        "plan_status":        "active",
        "plan_start_date":    "2026-02-01",
        "plan_end_date":      "2027-01-31",
        "total_budget":       39500.00,
        "used_budget":        11200.00,
        "primary_disability": "Autism Spectrum Disorder",
        "risk_level":         "low",
        "allergies":          "Peanuts",
        "emergency_contact_name": "Karen Fitzgerald",
        "emergency_contact_relationship": "Mother",
        "emergency_contact_number": "0433 100 999",
        "gp_name":  "Dr. Alan Ng",
        "gp_phone": "08 8351 4400",
        "gp_practice": "Henley Beach Medical Centre",
        "goals": [
            {"id": "goal_noah_1", "title": "Develop turn-taking in group activities", "status": "active"},
            {"id": "goal_noah_2", "title": "Reduce reliance on visual prompts for daily routine", "status": "active"},
        ],
        "assigned_worker_id": EXISTING_WORKER_ID,
        "allied_health_id":   None,
    },
    {
        "id":                 "30000000-0000-4000-8000-000000000204",
        "full_name":          "Grace Okonkwo",
        "ndis_number":        "NDIS-HBR-004",
        "date_of_birth":      "1985-10-22",
        "email":              "grace.okonkwo@example.com",
        "phone":              "0410 220 118",
        "address":            "56 South Road, Ascot Park SA",
        "biological_sex":     "female",
        "plan_status":        "active",
        "plan_start_date":    "2026-04-15",
        "plan_end_date":      "2027-04-14",
        "total_budget":       71000.00,
        "used_budget":        22400.00,
        "primary_disability": "Spinal Cord Injury",
        "risk_level":         "medium",
        "allergies":          None,
        "emergency_contact_name": "Emeka Okonkwo",
        "emergency_contact_relationship": "Husband",
        "emergency_contact_number": "0410 220 900",
        "gp_name":  "Dr. Priya Raman",
        "gp_phone": "08 8277 1200",
        "gp_practice": "Ascot Park Family Practice",
        "goals": [
            {"id": "goal_grace_1", "title": "Maintain upper-body strength via weekly physio", "status": "active"},
            {"id": "goal_grace_2", "title": "Increase community access confidence", "status": "active"},
        ],
        "assigned_worker_id": "10000000-0000-4000-8000-000000000205",
        "allied_health_id":   EXISTING_ALLIED_ID,
    },
    {
        "id":                 "30000000-0000-4000-8000-000000000205",
        "full_name":          "Ethan Marsh",
        "ndis_number":        "NDIS-HBR-005",
        "date_of_birth":      "2003-01-30",
        "email":              "ethan.marsh@example.com",
        "phone":              "0421 337 508",
        "address":            "9 Grange Road, Grange SA",
        "biological_sex":     "male",
        "plan_status":        "review",
        "plan_start_date":    "2025-09-01",
        "plan_end_date":      "2026-08-31",
        "total_budget":       53000.00,
        "used_budget":        41800.00,
        "primary_disability": "Cerebral Palsy",
        "risk_level":         "medium",
        "allergies":          "Latex",
        "emergency_contact_name": "Denise Marsh",
        "emergency_contact_relationship": "Mother",
        "emergency_contact_number": "0421 337 909",
        "gp_name":  "Dr. Alan Ng",
        "gp_phone": "08 8351 4400",
        "gp_practice": "Henley Beach Medical Centre",
        "goals": [
            {"id": "goal_ethan_1", "title": "Improve transfer technique for wheelchair mobility", "status": "active"},
            {"id": "goal_ethan_2", "title": "Build vocational skills toward supported employment", "status": "active"},
        ],
        "assigned_worker_id": "10000000-0000-4000-8000-000000000206",
        "allied_health_id":   None,
    },
    {
        "id":                 "30000000-0000-4000-8000-000000000206",
        "full_name":          "Ruby Delacroix",
        "ndis_number":        "NDIS-HBR-006",
        "date_of_birth":      "1998-07-11",
        "email":              "ruby.delacroix@example.com",
        "phone":              "0455 662 040",
        "address":            "3 Military Road, Semaphore SA",
        "biological_sex":     "female",
        "plan_status":        "active",
        "plan_start_date":    "2026-01-15",
        "plan_end_date":      "2027-01-14",
        "total_budget":       46500.00,
        "used_budget":        9800.00,
        "primary_disability": "Vision Impairment",
        "risk_level":         "low",
        "allergies":          None,
        "emergency_contact_name": "Paul Delacroix",
        "emergency_contact_relationship": "Father",
        "emergency_contact_number": "0455 662 700",
        "gp_name":  "Dr. Priya Raman",
        "gp_phone": "08 8277 1200",
        "gp_practice": "Ascot Park Family Practice",
        "goals": [
            {"id": "goal_ruby_1", "title": "Master orientation and mobility training route to campus", "status": "active"},
            {"id": "goal_ruby_2", "title": "Set up assistive screen-reading software at home", "status": "active"},
        ],
        "assigned_worker_id": "10000000-0000-4000-8000-000000000207",
        "allied_health_id":   None,
    },
    {
        "id":                 "30000000-0000-4000-8000-000000000207",
        "full_name":          "Oscar Whitfield",
        "ndis_number":        "NDIS-HBR-007",
        "date_of_birth":      "1975-04-03",
        "email":              "oscar.whitfield@example.com",
        "phone":              "0466 118 250",
        "address":            "72 Anzac Highway, Kurralta Park SA",
        "biological_sex":     "male",
        "plan_status":        "active",
        "plan_start_date":    "2026-05-01",
        "plan_end_date":      "2027-04-30",
        "total_budget":       58000.00,
        "used_budget":        14300.00,
        "primary_disability": "Acquired Brain Injury",
        "risk_level":         "high",
        "allergies":          "Penicillin",
        "emergency_contact_name": "Marion Whitfield",
        "emergency_contact_relationship": "Sister",
        "emergency_contact_number": "0466 118 600",
        "gp_name":  "Dr. Alan Ng",
        "gp_phone": "08 8351 4400",
        "gp_practice": "Henley Beach Medical Centre",
        "goals": [
            {"id": "goal_oscar_1", "title": "Follow structured daily routine with prompting cards", "status": "active"},
            {"id": "goal_oscar_2", "title": "Reduce fall risk with supervised mobility practice", "status": "active"},
        ],
        "assigned_worker_id": "10000000-0000-4000-8000-000000000208",
        "allied_health_id":   EXISTING_ALLIED_ID,
    },
    {
        "id":                 "30000000-0000-4000-8000-000000000208",
        "full_name":          "Ivy Chen",
        "ndis_number":        "NDIS-HBR-008",
        "date_of_birth":      "2014-08-19",
        "email":              None,
        "phone":              None,
        "address":            "18 Military Road, Largs Bay SA",
        "biological_sex":     "female",
        "plan_status":        "active",
        "plan_start_date":    "2026-03-01",
        "plan_end_date":      "2027-02-28",
        "total_budget":       32000.00,
        "used_budget":        6100.00,
        "primary_disability": "Intellectual Disability",
        "risk_level":         "low",
        "allergies":          "Dairy",
        "emergency_contact_name": "Wei Chen",
        "emergency_contact_relationship": "Father",
        "emergency_contact_number": "0499 210 330",
        "gp_name":  "Dr. Priya Raman",
        "gp_phone": "08 8277 1200",
        "gp_practice": "Ascot Park Family Practice",
        "goals": [
            {"id": "goal_ivy_1", "title": "Build independent self-care routine (dressing, hygiene)", "status": "active"},
            {"id": "goal_ivy_2", "title": "Participate in peer play sessions weekly", "status": "active"},
        ],
        "assigned_worker_id": EXISTING_WORKER_ID,
        "allied_health_id":   None,
    },
]


def _create_or_find_auth_user(sb, user: dict) -> str:
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

    # ── 1. Auth + public.users + organization_members ──────────────────────
    print("\n[1/4] Creating managing director + 4 support workers ...")
    id_map: dict[str, str] = {}
    for user in NEW_USERS:
        uid = _create_or_find_auth_user(sb, user)
        id_map[user["id"]] = uid
        sb.table("users").upsert({
            "id":                              uid,
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
            "phone":                           user["phone"],
            "address":                         user["address"],
            "date_of_birth":                   user["date_of_birth"],
        }, on_conflict="id").execute()
        sb.table("organization_members").upsert({
            "user_id":         uid,
            "organization_id": ORG_ID,
            "role":            user["role"],
            "is_active":       True,
            "invited_by":      EXISTING_COORDINATOR_ID,
        }, on_conflict="user_id,organization_id").execute()
        print(f"  {user['full_name']}  ({user['role']})")

    def resolve(placeholder_or_real_id):
        """New users are keyed by an id_map (placeholder -> real auth uid);
        existing users (EXISTING_WORKER_ID etc.) already are the real id."""
        if placeholder_or_real_id is None:
            return None
        return id_map.get(placeholder_or_real_id, placeholder_or_real_id)

    resolved_worker_ids = [resolve(w) for w in ALL_WORKER_IDS]

    # ── 2. Credentials for every support worker ─────────────────────────────
    print("\n[2/4] Upserting WWCC + NDIS Worker Screening credentials ...")
    today = date.today()
    for worker_id in resolved_worker_ids:
        creds = [
            {
                "credential_type": "wwcc",
                "title": "Working with Children Check",
                "credential_number": f"WWC{worker_id[-6:].upper()}",
                "issuer": "SA DHS Screening Unit",
                "issue_date": (today - timedelta(days=400)).isoformat(),
                "expiry_date": (today + timedelta(days=700)).isoformat(),
                "status": "valid",
            },
            {
                "credential_type": "ndis_screening",
                "title": "NDIS Worker Screening Check",
                "credential_number": f"NWS{worker_id[-6:].upper()}",
                "issuer": "NDIS Quality and Safeguards Commission",
                "issue_date": (today - timedelta(days=250)).isoformat(),
                "expiry_date": (today + timedelta(days=1450)).isoformat(),
                "status": "valid",
            },
        ]
        for c in creds:
            existing = (
                sb.table("credentials")
                .select("id")
                .eq("user_id", worker_id)
                .eq("credential_type", c["credential_type"])
                .limit(1)
                .execute()
            )
            if existing.data:
                continue
            sb.table("credentials").insert({
                "user_id": worker_id,
                "organization_id": ORG_ID,
                **c,
            }).execute()
        print(f"  credentials ensured for worker {worker_id}")

    # ── 3. Patients ───────────────────────────────────────────────────────
    print("\n[3/4] Upserting 6 more participants (8 total) ...")
    for p in NEW_PATIENTS:
        sb.table("patients").upsert({
            "id":                 p["id"],
            "organization_id":    ORG_ID,
            "full_name":          p["full_name"],
            "ndis_number":        p["ndis_number"],
            "date_of_birth":      p["date_of_birth"],
            "email":              p["email"],
            "phone":              p["phone"],
            "address":            p["address"],
            "biological_sex":     p["biological_sex"],
            "plan_status":        p["plan_status"],
            "plan_start_date":    p["plan_start_date"],
            "plan_end_date":      p["plan_end_date"],
            "total_budget":       p["total_budget"],
            "primary_disability": p["primary_disability"],
            "risk_level":         p["risk_level"],
            "allergies":          p["allergies"],
            "emergency_contact_name":         p["emergency_contact_name"],
            "emergency_contact_relationship": p["emergency_contact_relationship"],
            "emergency_contact_number":       p["emergency_contact_number"],
            "gp_name":     p["gp_name"],
            "gp_phone":    p["gp_phone"],
            "gp_practice": p["gp_practice"],
            "assigned_worker_id": resolve(p["assigned_worker_id"]),
            "allied_health_id":   resolve(p["allied_health_id"]),
            "created_by":         EXISTING_COORDINATOR_ID,
            "owner_user_id":      EXISTING_COORDINATOR_ID,
        }, on_conflict="id").execute()
        print(f"  {p['full_name']}  (NDIS: {p['ndis_number']})")

        # Goals live in the dedicated ndis_goals table now (replaces the old
        # patients.goals JSONB column) — one row per goal, keyed by name so
        # re-running this script doesn't create duplicates.
        for g in p["goals"]:
            existing_goal = (
                sb.table("ndis_goals")
                .select("id")
                .eq("participant_id", p["id"])
                .eq("name", g["title"])
                .limit(1)
                .execute()
            )
            if existing_goal.data:
                continue
            now_iso = datetime.now(timezone.utc).isoformat()
            sb.table("ndis_goals").insert({
                "participant_id": p["id"],
                "organization_id": ORG_ID,
                "name": g["title"],
                "goal_area": "daily_living",
                "description": g["title"],
                "priority": 1,
                "status": g.get("status", "active"),
                "created_at": now_iso,
                "updated_at": now_iso,
            }).execute()

    # ── 4. practitioner_allocations for the new patients ────────────────────
    print("\n[4/4] Upserting practitioner allocations ...")
    for p in NEW_PATIENTS:
        if p["assigned_worker_id"]:
            sb.table("practitioner_allocations").upsert({
                "patient_id": p["id"],
                "user_id": resolve(p["assigned_worker_id"]),
                "allocated_role": "support_worker",
                "organization_id": ORG_ID,
                "assigned_by": EXISTING_COORDINATOR_ID,
                "is_active": True,
            }, on_conflict="patient_id,user_id").execute()
        if p["allied_health_id"]:
            sb.table("practitioner_allocations").upsert({
                "patient_id": p["id"],
                "user_id": resolve(p["allied_health_id"]),
                "allocated_role": "allied_health",
                "organization_id": ORG_ID,
                "assigned_by": EXISTING_COORDINATOR_ID,
                "is_active": True,
            }, on_conflict="patient_id,user_id").execute()

    print(f"""
{'='*56}
  Org 2 Expansion Complete — Harbor View Supports
{'='*56}
  Org ID: {ORG_ID}

  Managing Director: {NEW_USERS[0]['email']}  /  {NEW_USERS[0]['password']}
  Support Workers (5 total):
    {EXISTING_WORKER_ID[-3:]}  james@harborview-demo.com  /  Jamesharbor#2026
    {NEW_USERS[1]['email']}  /  {NEW_USERS[1]['password']}
    {NEW_USERS[2]['email']}  /  {NEW_USERS[2]['password']}
    {NEW_USERS[3]['email']}  /  {NEW_USERS[3]['password']}
    {NEW_USERS[4]['email']}  /  {NEW_USERS[4]['password']}

  Participants (8 total): Liam Torres, Amelia Park, Noah Fitzgerald,
    Grace Okonkwo, Ethan Marsh, Ruby Delacroix, Oscar Whitfield, Ivy Chen
{'='*56}
""")


if __name__ == "__main__":
    main()
