"""Set up a pilot organisation with sample data for exploring compliance.

Creates "Provider Support SA (Pilot)" (abbreviation PSSA) with a support
coordinator, three support workers, five participants, plans, goals, signed
service agreements, shifts with progress notes, medications, incidents and a
complaint. Most of it is in order; a handful of things are deliberately not,
so the compliance views have something real to find:

  - Tom Walsh's First Aid has expired and his WWCC expires within 60 days,
    and he's rostered this week with Zoe, who is 12.
  - Grace Kim's NDIS Worker Screening is uploaded but not yet verified, and
    she has no medication administration certificate.
  - Harold Nguyen's plan ends in three weeks.
  - Priya Singh's service agreement was sent but isn't signed.
  - One shift note is too thin to meet documentation standards, and one
    completed shift has no note at all.
  - A reportable incident (Harold's fall) hasn't been notified to the NDIS
    Commission, so it's past the 24-hour deadline.
  - Zoe's mother has an open complaint with no response yet.

Every person is fictional. Demo logins use @example.com, which never
receives mail, and share one password taken from PILOT_DEMO_PASSWORD (kept
out of the repo; only used when an account is first created). The managing
director is the real pilot user: she's invited by email (--invite) and sets
her own password; nothing else in here emails anyone.

Re-runnable: finds or creates the organisation and logins, and only seeds
the sample records the first time (when the organisation has no
participants yet).

Usage, from the repo root:
    PILOT_DEMO_PASSWORD=... .venv/Scripts/python -m backend.scripts.seed_pilot_org
    PILOT_DEMO_PASSWORD=... .venv/Scripts/python -m backend.scripts.seed_pilot_org --invite
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import secrets
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

from backend.app.api.auth import _upsert_user_record  # noqa: E402
from backend.app.api.invitations import _generate_short_code  # noqa: E402
from backend.app.schemas.participant import ParticipantCreate, ParticipantUpdate  # noqa: E402
from backend.app.services import participant_intake_service, participant_service  # noqa: E402
from backend.app.services import service_agreement_document_service as agreements  # noqa: E402
from backend.app.services.email_service import send_founding_welcome_email  # noqa: E402
from backend.app.services.employee_id_service import generate_employee_id  # noqa: E402
from backend.app.services.supabase_client import get_supabase_admin  # noqa: E402

ORG_NAME = "Provider Support SA (Pilot)"
ORG_ABBREV = "PSSA"
DIRECTOR_EMAIL = "bonny@providersupportsa.com.au"
PILOT_URL = "https://carecliq-dev.pages.dev"
PASSWORD = os.environ.get("PILOT_DEMO_PASSWORD", "")
TZ = ZoneInfo("Australia/Adelaide")

COORDINATOR = {"key": "coordinator", "email": "pssa.coordinator@example.com", "full_name": "Jordan Ellis", "role": "support_coordinator", "account_type": "small_provider"}
WORKERS = [
    {"key": "aisha", "email": "pssa.worker.aisha@example.com", "full_name": "Aisha Rahman", "role": "support_worker", "account_type": "independent_worker"},
    {"key": "tom", "email": "pssa.worker.tom@example.com", "full_name": "Tom Walsh", "role": "support_worker", "account_type": "independent_worker"},
    {"key": "grace", "email": "pssa.worker.grace@example.com", "full_name": "Grace Kim", "role": "support_worker", "account_type": "independent_worker"},
]
PORTAL_LOGINS = [
    {"email": "pssa.participant.liam@example.com", "full_name": "Liam Carter", "participant": "Liam Carter", "relationship": "self", "notes": None},
    {"email": "pssa.family.mitchell@example.com", "full_name": "Karen Mitchell", "participant": "Zoe Mitchell", "relationship": "parent", "notes": "Mother and primary carer of Zoe (12)."},
]

TODAY = date.today()
AGREEMENTS_FROM = date(TODAY.year if TODAY.month >= 7 else TODAY.year - 1, 7, 1).isoformat()


def d(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def local(days: int, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(TODAY + timedelta(days=days), time(hour, minute), TZ)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def signature_png(name: str) -> str:
    """A handwritten-looking signature, or a blank 1x1 if Pillow isn't installed."""
    try:
        from PIL import Image, ImageDraw

        img = Image.new("RGBA", (360, 90), (255, 255, 255, 0))
        draw = ImageDraw.Draw(img)
        points = [(14 + i * 9, 50 + int(14 * ((-1) ** i) * (0.6 + (i % 3) / 4))) for i in range(36)]
        draw.line(points, fill=(26, 26, 46, 255), width=3, joint="curve")
        draw.text((16, 70), name, fill=(106, 106, 119, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        raw = buf.getvalue()
    except Exception:
        raw = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
    return "data:image/png;base64," + base64.b64encode(raw).decode()


# ── Organisation and logins ─────────────────────────────────────────────────

def find_or_create_org(db) -> str:
    existing = db.table("organizations").select("organization_id").eq("org_abbrev", ORG_ABBREV).limit(1).execute().data
    if existing:
        print(f"Organisation exists: {ORG_NAME}")
        return existing[0]["organization_id"]
    row = db.table("organizations").insert({
        "name": ORG_NAME,
        "organization_name": ORG_NAME,
        "org_abbrev": ORG_ABBREV,
        "email": DIRECTOR_EMAIL,
        "owner_user_id": None,
    }).execute().data[0]
    print(f"Created organisation: {ORG_NAME}")
    return row["organization_id"]


def find_auth_user_id(db, email: str) -> str | None:
    page = 1
    while True:
        listed = db.auth.admin.list_users(page=page, per_page=200)
        users = listed.users if hasattr(listed, "users") else listed
        if not users:
            return None
        for user in users:
            if (user.email or "").lower() == email.lower():
                return str(user.id)
        page += 1


def find_or_create_auth_user(db, email: str, full_name: str) -> str:
    user_id = find_auth_user_id(db, email)
    if user_id:
        return user_id
    result = db.auth.admin.create_user({
        "email": email, "password": PASSWORD,
        "user_metadata": {"full_name": full_name}, "email_confirm": True,
    })
    return str(result.user.id)


async def ensure_staff(db, org_id: str, spec: dict, coordinator_id: str | None) -> str:
    user_id = find_or_create_auth_user(db, spec["email"], spec["full_name"])
    await _upsert_user_record(
        user_id=user_id, email=spec["email"], role=spec["role"], full_name=spec["full_name"],
        account_type=spec["account_type"], onboarding_complete=True,
        extra={
            "organization_id": org_id, "email_verified": True, "profile_completed": True,
            "onboarding_completed": True, "role_specific_profile_completed": True,
        },
    )
    if coordinator_id and spec["role"] == "support_worker":
        db.table("users").update({"coordinator_id": coordinator_id}).eq("id", user_id).execute()
    member = db.table("organization_members").select("id").eq("organization_id", org_id).eq("user_id", user_id).execute().data
    if not member:
        db.table("organization_members").insert({
            "user_id": user_id, "organization_id": org_id, "role": spec["role"], "is_active": True,
            "employee_id": generate_employee_id(db, org_id, spec["role"]),
        }).execute()
    print(f"  {spec['role']:20s} {spec['full_name']:16s} {spec['email']}")
    return user_id


def ensure_portal_login(db, org_id: str, spec: dict, participant_id: str) -> None:
    user_id = find_or_create_auth_user(db, spec["email"], spec["full_name"])
    db.table("users").upsert({
        "id": user_id, "email": spec["email"], "role": "participant", "full_name": spec["full_name"],
        "is_active": True, "organization_id": org_id, "participant_id": None,
        "onboarding_complete": True, "email_verified": True, "profile_completed": True,
    }).execute()
    live = (
        db.table("participant_portal_access").select("id").eq("participant_id", participant_id)
        .ilike("email", spec["email"]).neq("status", "revoked").limit(1).execute().data
    )
    if not live:
        db.table("participant_portal_access").insert({
            "organization_id": org_id, "participant_id": participant_id, "user_id": user_id,
            "email": spec["email"], "full_name": spec["full_name"], "relationship": spec["relationship"],
            "authority_notes": spec["notes"], "status": "active", "granted_at": now(), "accepted_at": now(),
        }).execute()
    print(f"  participant portal     {spec['full_name']:16s} {spec['email']}  ({spec['relationship']} of {spec['participant']})")


# ── Sample records ───────────────────────────────────────────────────────────

PARTICIPANTS = [
    {
        "full_name": "Liam Carter", "ndis_number": "431990001", "date_of_birth": "1992-05-14", "biological_sex": "male",
        "phone": "0400 100 201", "primary_disability": "Acquired brain injury", "plan": (-150, 215, 68500),
        "plan_management_type": "plan-managed", "worker": "aisha",
        "goals": [
            ("Cook three meals a week independently", "daily_living", "core_daily_activities", "Liam wants to plan and cook his own dinners, starting with three simple recipes."),
            ("Catch the bus to TAFE on his own", "community", "core_social_community", "Build confidence using the Adelaide Metro bus to get to TAFE twice a week."),
        ],
        "agreement": "signed", "supports": [("01_011_0107_1_1", 208, "weekly", "home"), ("04_104_0125_6_1", 104, "weekly", "other")],
    },
    {
        "full_name": "Zoe Mitchell", "ndis_number": "431990002", "date_of_birth": "2014-02-03", "biological_sex": "female",
        "phone": "0400 100 202", "primary_disability": "Autism", "plan": (-90, 275, 54000),
        "plan_management_type": "NDIA-managed", "worker": "tom",
        "goals": [
            ("Join a weekend community activity", "social", "core_social_community", "Zoe wants to try a Saturday art class with support to manage noise and crowds."),
        ],
        "agreement": "signed", "supports": [("04_104_0125_6_1", 156, "weekly", "other")],
        "allergy": ("Peanuts", "anaphylactic", "EpiPen in the front pocket of her school bag."),
        "alert": "Anaphylactic peanut allergy. EpiPen in the front pocket of her school bag.",
    },
    {
        "full_name": "Harold Nguyen", "ndis_number": "431990003", "date_of_birth": "1968-09-22", "biological_sex": "male",
        "phone": "0400 100 203", "primary_disability": "Epilepsy and intellectual disability", "plan": (-344, 21, 92000),
        "plan_management_type": "self-managed", "worker": "aisha",
        "goals": [
            ("Keep his medication routine on track", "health", "core_daily_activities", "Harold takes his morning and evening medication with prompting and records it himself."),
            ("Walk to the local shops safely", "community", "core_social_community", "Short supported walks to build stamina and reduce his falls risk."),
        ],
        "agreement": "signed", "supports": [("01_011_0107_1_1", 312, "weekly", "home"), ("01_013_0107_1_1", 52, "weekly", "home")],
        "allergy": ("Penicillin", "moderate", "Rash and hives documented by his GP."),
        "alert": "Seizure management plan in his folder. Call 000 if a seizure lasts more than 5 minutes.",
        "medication": {"name": "Sodium valproate", "strength": "500 mg", "dosage": "1 tablet", "scheduled_times": ["08:00", "20:00"], "prescriber_name": "Dr Helen Park", "is_high_risk": True, "high_risk_category": "other"},
    },
    {
        "full_name": "Priya Singh", "ndis_number": "431990004", "date_of_birth": "1998-11-30", "biological_sex": "female",
        "phone": "0400 100 204", "primary_disability": "Cerebral palsy", "plan": (-20, 345, 47500),
        "plan_management_type": "plan-managed", "worker": "grace",
        "goals": [
            ("Find part-time work in retail", "employment", "cb_employment", "Priya wants support to prepare a resume and practise interviews."),
        ],
        "agreement": "sent", "supports": [("04_104_0125_6_1", 104, "weekly", "other")],
    },
]

ENQUIRY = {"full_name": "Ruby O'Connell", "ndis_number": "431990005", "date_of_birth": "1981-07-09", "phone": "0400 100 205"}

CREDENTIALS = {
    # key: list of (type, title, issuer, issued_days_ago, expires_in_days or None, status)
    "aisha": [
        ("ndis_screening", "NDIS Worker Screening Check", "SA Department of Human Services", 400, 1425, "valid"),
        ("wwcc", "Working with Children Check", "SA Department of Human Services", 400, 690, "valid"),
        ("code_of_conduct", "NDIS Code of Conduct acknowledgement", "Provider Support SA", 300, None, "valid"),
        ("first_aid", "Provide First Aid (HLTAID011)", "St John Ambulance", 200, 895, "valid"),
        ("cpr", "Provide CPR (HLTAID009)", "St John Ambulance", 200, 165, "valid"),
        ("manual_handling", "Manual handling", "WorkSafe training", 250, 480, "valid"),
        ("infection_control", "Infection prevention and control", "Australian Government", 250, 480, "valid"),
        ("medication_admin", "Assist clients with medication (HLTHPS006)", "TAFE SA", 380, 715, "valid"),
    ],
    "tom": [
        ("ndis_screening", "NDIS Worker Screening Check", "SA Department of Human Services", 900, 925, "valid"),
        ("wwcc", "Working with Children Check", "SA Department of Human Services", 1075, 20, "valid"),
        ("code_of_conduct", "NDIS Code of Conduct acknowledgement", "Provider Support SA", 300, None, "valid"),
        ("first_aid", "Provide First Aid (HLTAID011)", "Red Cross", 1105, -10, "valid"),
        ("cpr", "Provide CPR (HLTAID009)", "Red Cross", 375, -10, "valid"),
        ("manual_handling", "Manual handling", "WorkSafe training", 250, 480, "valid"),
        ("infection_control", "Infection prevention and control", "Australian Government", 250, 480, "valid"),
        ("medication_admin", "Assist clients with medication (HLTHPS006)", "TAFE SA", 500, 595, "valid"),
    ],
    "grace": [
        ("ndis_screening", "NDIS Worker Screening Check", "SA Department of Human Services", 6, 1820, "pending_review"),
        ("wwcc", "Working with Children Check", "SA Department of Human Services", 30, 1065, "valid"),
        ("code_of_conduct", "NDIS Code of Conduct acknowledgement", "Provider Support SA", 14, None, "valid"),
        ("first_aid", "Provide First Aid (HLTAID011)", "St John Ambulance", 40, 1055, "valid"),
        ("cpr", "Provide CPR (HLTAID009)", "St John Ambulance", 40, 325, "valid"),
        ("manual_handling", "Manual handling", "WorkSafe training", 20, 710, "valid"),
        ("infection_control", "Infection prevention and control", "Australian Government", 20, 710, "valid"),
    ],
}

GOOD_NOTES = {
    "Liam Carter": "Arrived 9:00. Liam chose to cook spaghetti bolognese for tonight. He read the recipe card, chopped the onion with hand-over-hand support for the first few cuts then independently, and browned the mince himself. He said he felt more confident than last week. We practised reading the bus timetable for Thursday's TAFE trip and he identified the right route without prompting. No concerns. Goal progress: cooking (3 of 4 steps independent), bus travel (route planning independent).",
    "Zoe Mitchell": "Picked Zoe up from home at 9:30 with her mother present. Checked EpiPen was in her bag before leaving. Attended the Saturday art class at the community centre for 90 minutes. Zoe used her noise-cancelling headphones for the first 20 minutes, then took them off and joined the group painting activity. She told the instructor her name and asked for more blue paint. Returned home 12:15, handed over to her mother and told her about the class. Goal progress: participated with one prompt, stayed for the full class.",
    "Harold Nguyen": "Arrived 8:00. Prompted Harold to take his 8:00 sodium valproate. He took it with water and recorded it on his chart himself. Supported a 15 minute walk to the corner shop using his walking stick; he stopped twice to rest and said his left knee was sore. Reported the knee pain to the coordinator. Prepared breakfast together. Harold was in good spirits. Goal progress: medication taken and recorded independently; walk completed with two rests.",
}
THIN_NOTE = "Shift was fine. Did the usual. No issues."


async def seed_records(db, org_id: str, staff: dict[str, str]) -> dict[str, str]:
    coordinator_id = staff["coordinator"]
    as_coordinator = {"id": coordinator_id, "sub": coordinator_id, "organization_id": org_id, "role": "support_coordinator"}
    participants: dict[str, str] = {}

    for p in PARTICIPANTS:
        start, end, budget = p["plan"]
        created = await participant_service.create_participant(ParticipantCreate(
            full_name=p["full_name"], ndis_number=p["ndis_number"], date_of_birth=p["date_of_birth"],
            phone=p["phone"], primary_disability=p["primary_disability"], biological_sex=p["biological_sex"],
            service_category="disability", plan_start_date=d(start), plan_end_date=d(end), total_budget=budget,
        ), as_coordinator)
        pid = created["id"]
        participants[p["full_name"]] = pid
        await participant_service.update_participant(pid, ParticipantUpdate(plan_management_type=p["plan_management_type"]), as_coordinator)

        db.table("practitioner_allocations").insert({
            "patient_id": pid, "user_id": staff[p["worker"]], "allocated_role": "support_worker",
            "is_active": True, "assigned_by": coordinator_id, "organization_id": org_id,
        }).execute()
        for name, area, category, description in p["goals"]:
            db.table("ndis_goals").insert({
                "participant_id": pid, "organization_id": org_id, "created_by": coordinator_id, "name": name,
                "goal_area": area, "support_category": category, "description": description,
                "target_date": d(end), "status": "active",
            }).execute()
        if p.get("allergy"):
            allergen, severity, notes = p["allergy"]
            db.table("participant_allergies").insert({
                "participant_id": pid, "organization_id": org_id, "allergen": allergen, "severity": severity, "notes": notes,
            }).execute()
        if p.get("alert"):
            db.table("participant_briefing_alerts").insert({
                "participant_id": pid, "organization_id": org_id, "alert_text": p["alert"], "sort_order": 0, "is_active": True,
            }).execute()
        if p.get("medication"):
            m = p["medication"]
            db.table("medications").insert({
                "participant_id": pid, "organization_id": org_id, "name": m["name"], "strength": m["strength"],
                "route": "oral", "dosage": m["dosage"], "frequency_type": "scheduled", "scheduled_times": m["scheduled_times"],
                "prescriber_name": m["prescriber_name"], "start_date": d(-400), "is_prn": False, "status": "active",
                "created_by": coordinator_id, "updated_by": coordinator_id, "verified_by": coordinator_id, "verified_at": now(),
                "is_high_risk": m["is_high_risk"], "high_risk_category": m["high_risk_category"],
            }).execute()

        # Agreements are re-signed at the 1 July NDIS price update; the catalogue
        # only prices items from the current financial year.
        draft = await agreements.create_draft(pid, org_id, coordinator_id, {
            "plan_management_type": p["plan_management_type"], "start_date": max(d(start), AGREEMENTS_FROM), "end_date": d(end),
            "includes_price_adjustment_clause": True, "cancellation_notice_hours": 48,
            "supports": [{"support_item_code": c, "quantity": q, "frequency": f, "location": loc} for c, q, f, loc in p["supports"]],
        })
        if p["agreement"] == "signed":
            await agreements.sign(
                org_id, draft["id"], coordinator_id,
                provider_name=COORDINATOR["full_name"], provider_signature_png=signature_png(COORDINATOR["full_name"]),
                participant_name=p["full_name"] if p["full_name"] != "Zoe Mitchell" else "Karen Mitchell",
                participant_signature_png=signature_png(p["full_name"]),
            )
        else:
            await agreements.send_for_signature(org_id, draft["id"], coordinator_id)
        print(f"  participant  {p['full_name']:16s} plan ends {d(end)}  agreement {p['agreement']}")

    participant_intake_service.create_intake(
        organization_id=org_id, created_by=coordinator_id, full_name=ENQUIRY["full_name"],
        ndis_number=ENQUIRY["ndis_number"], email="", phone=ENQUIRY["phone"], source="phone_call",
        service_category="disability", service_hours_required=6,
        web_intake={"date_of_birth": ENQUIRY["date_of_birth"]},
    )
    print(f"  enquiry      {ENQUIRY['full_name']} (on the onboarding board)")

    for key, creds in CREDENTIALS.items():
        for ctype, title, issuer, issued_ago, expires_in, status in creds:
            db.table("credentials").insert({
                "user_id": staff[key], "organization_id": org_id, "credential_type": ctype, "title": title,
                "issuer": issuer, "issue_date": d(-issued_ago), "expiry_date": d(expires_in) if expires_in is not None else None,
                "status": status, "verified_by": coordinator_id if status == "valid" else None,
                "verified_at": now() if status == "valid" else None,
                "screening_number": f"{4100000 + secrets.randbelow(899999)}" if ctype == "ndis_screening" else None,
            }).execute()
    print("  credentials  Aisha all current, Tom First Aid/CPR expired + WWCC expiring, Grace screening unverified")

    def shift(participant: str, worker: str, day: int, start_h: int, hours: int, status: str, **extra) -> dict:
        start_at, end_at = local(day, start_h), local(day, start_h + hours)
        return db.table("shifts").insert({
            "organization_id": org_id, "participant_id": participants[participant], "worker_id": staff[worker],
            "participant_name": participant, "scheduled_start": start_at.isoformat(), "scheduled_end": end_at.isoformat(),
            "duration_minutes": hours * 60, "status": status, "confirmation_status": "confirmed",
            "duty_type": "disability_services", "is_sleepover": False,
            **({"clocked_in_at": start_at.isoformat(), "clocked_out_at": end_at.isoformat()} if status == "completed" else {}),
            **extra,
        }).execute().data[0]

    def note(row: dict, worker: str, participant: str, text: str, score: float, status: str, goals: list[str]) -> None:
        start_at = datetime.fromisoformat(row["scheduled_start"])
        session = db.table("sessions").insert({
            "patient_id": participants[participant], "organization_id": org_id, "worker_id": staff[worker],
            "created_by": staff[worker], "owner_user_id": staff[worker], "shift_id": row["id"],
            "session_date": start_at.astimezone(TZ).date().isoformat(), "duration_minutes": row["duration_minutes"],
            "session_type": "support_work", "status": "completed", "notes": text,
            "original_language_input": text, "translated_english_note": text, "compliance_input_text": text,
            "detected_language": "en", "translation_status": "not_required", "translation_provider": "none",
            "compliance_score": score, "compliance_status": status, "compliance_checked_at": now(),
            "compliance_review_required": status != "compliant", "goals_addressed": goals,
            "support_category": "Core Supports", "activities_performed": "Support work",
            "start_time": row["scheduled_start"], "end_time": row["scheduled_end"],
        }).execute().data[0]
        db.table("shifts").update({"session_id": session["id"]}).eq("id", row["id"]).execute()

    goal_names = {p["full_name"]: [g[0] for g in p["goals"]] for p in PARTICIPANTS}
    for day in (-13, -6):
        note(shift("Liam Carter", "aisha", day, 9, 3, "completed"), "aisha", "Liam Carter", GOOD_NOTES["Liam Carter"], 93.5, "compliant", goal_names["Liam Carter"])
        note(shift("Harold Nguyen", "aisha", day + 1, 8, 2, "completed"), "aisha", "Harold Nguyen", GOOD_NOTES["Harold Nguyen"], 91.0, "compliant", goal_names["Harold Nguyen"])
    note(shift("Zoe Mitchell", "tom", -9, 9, 3, "completed"), "tom", "Zoe Mitchell", GOOD_NOTES["Zoe Mitchell"], 88.0, "compliant", goal_names["Zoe Mitchell"])
    note(shift("Zoe Mitchell", "tom", -2, 9, 3, "completed"), "tom", "Zoe Mitchell", THIN_NOTE, 35.0, "non_compliant", [])
    shift("Priya Singh", "grace", -3, 13, 2, "completed", documentation_pending=True, documentation_due_at=local(-3, 23, 59).isoformat())
    for day, participant, worker, start_h, hours in ((1, "Liam Carter", "aisha", 9, 3), (2, "Harold Nguyen", "aisha", 8, 2), (4, "Zoe Mitchell", "tom", 9, 3), (5, "Priya Singh", "grace", 13, 2)):
        shift(participant, worker, day, start_h, hours, "scheduled")
    print("  shifts       7 completed (1 thin note, 1 with no note), 4 this week (Tom with Zoe)")

    incident_at = local(-3, 10, 40)
    db.table("incidents").insert({
        "organization_id": org_id, "participant_id": participants["Harold Nguyen"],
        "title": "Fall on the front steps", "incident_type": "injury", "severity": "high", "status": "reported",
        "description": "Harold slipped on the wet front steps while we were leaving for his walk. He landed on his left side and hit his knee and hip. He was conscious and talking throughout.",
        "incident_date": incident_at.isoformat(), "reported_date": local(-3, 11, 15).isoformat(),
        "ndis_reportable": True, "ndis_reported_at": None, "participant_present": True, "participant_harmed": "yes",
        "practice_standard": "Standard 3.1 - Safe environment", "participant_impact": "Bruised left hip and knee, seen by GP the same day.",
        "worker_actions": "Kept Harold still, checked for injuries, called the coordinator and drove him to his GP. Steps reported to his landlord.",
        "injury_nature": "Bruising to left hip and knee", "injury_medical_attention": "gp", "location_type": "private_home",
        "follow_up_required": True, "created_by": staff["aisha"], "user_id": staff["aisha"],
        "reference_number": f"INC-{incident_at:%Y%m%d}-PS01",
    }).execute()
    closed_at = local(-21, 18, 5)
    db.table("incidents").insert({
        "organization_id": org_id, "participant_id": participants["Liam Carter"],
        "title": "Evening medication prompt missed", "incident_type": "medication_error", "severity": "low", "status": "closed",
        "description": "Liam's 6pm reminder was missed at handover. He realised himself at 7pm and took it then.",
        "incident_date": closed_at.isoformat(), "reported_date": local(-21, 19, 0).isoformat(), "resolved_date": local(-18, 10, 0).isoformat(),
        "ndis_reportable": False, "participant_present": True, "participant_harmed": "no",
        "worker_actions": "Confirmed with Liam he had taken it, recorded the time, told the coordinator.",
        "investigation_notes": "Handover checklist didn't include evening prompts.",
        "corrective_actions": "Evening medication prompts added to the shift handover checklist.",
        "follow_up_required": False, "created_by": staff["aisha"], "user_id": staff["aisha"],
        "reference_number": f"INC-{closed_at:%Y%m%d}-PS02",
    }).execute()
    print("  incidents    1 reportable, not yet notified (overdue); 1 closed with corrective action")

    db.table("participant_complaints").insert({
        "organization_id": org_id, "participant_id": participants["Zoe Mitchell"], "participant_name": "Zoe Mitchell",
        "raised_by": "Mother (Karen Mitchell)", "subject": "Support worker arrived late twice",
        "description": "Tom arrived 30 minutes late for the last two Saturday sessions and Zoe missed the start of her art class. Nobody called to let us know.",
        "status": "open", "filed_at": local(-9, 14, 20).isoformat(), "created_by": coordinator_id,
    }).execute()
    print("  complaints   1 open, no response yet")
    return participants


def sync_plan_agreement_status(db, org_id: str) -> None:
    """Signing marks the NDIS plan signed (migration 094), which the
    compliance centre reads. If 094 arrived after the agreements were
    signed, catch the plans up. Idempotent."""
    active = (
        db.table("service_agreements").select("participant_id, start_date, end_date, participant_signed_at")
        .eq("organization_id", org_id).eq("status", "active").not_.is_("participant_id", "null").execute().data
    )
    for a in active:
        agreements.mark_plan_agreement_signed(
            org_id, str(a["participant_id"]), str(a["start_date"]), a.get("end_date"),
            a.get("participant_signed_at") or now(),
        )


def invite_director(db, org_id: str) -> None:
    pending = (
        db.table("invitations").select("id").eq("organization_id", org_id).eq("role", "managing_director")
        .is_("accepted_at", "null").gt("expires_at", now()).execute().data
    )
    if pending:
        print(f"A director invite for {DIRECTOR_EMAIL} is already pending; not sending another.")
        return
    token = secrets.token_hex(32)
    db.table("invitations").insert({
        "organization_id": org_id, "invited_by": None, "email": DIRECTOR_EMAIL, "role": "managing_director",
        "token": token, "short_code": _generate_short_code(db),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }).execute()
    send_founding_welcome_email(
        to_email=DIRECTOR_EMAIL, setup_url=f"{PILOT_URL}/accept-invite?token={token}",
        organization_name=ORG_NAME, trial_days=None,
    )
    print(f"Invitation emailed to {DIRECTOR_EMAIL} (link valid 7 days).")


async def main() -> None:
    if len(PASSWORD) < 10:
        sys.exit("Set PILOT_DEMO_PASSWORD (10+ characters, an uppercase letter and a number) for the demo logins.")
    db = get_supabase_admin()
    org_id = find_or_create_org(db)
    print("Logins (all use the PILOT_DEMO_PASSWORD password):")
    staff = {"coordinator": await ensure_staff(db, org_id, COORDINATOR, None)}
    for worker in WORKERS:
        staff[worker["key"]] = await ensure_staff(db, org_id, worker, staff["coordinator"])

    has_data = db.table("participants").select("id").eq("organization_id", org_id).limit(1).execute().data
    if has_data:
        print("Sample records already seeded; leaving them as they are.")
        participants = {
            r["full_name"]: r["id"]
            for r in db.table("participants").select("id, full_name").eq("organization_id", org_id).execute().data
        }
    else:
        print("Seeding sample records:")
        participants = await seed_records(db, org_id, staff)

    for login in PORTAL_LOGINS:
        if login["participant"] in participants:
            ensure_portal_login(db, org_id, login, participants[login["participant"]])
    sync_plan_agreement_status(db, org_id)

    if "--invite" in sys.argv:
        invite_director(db, org_id)
    print(f"Done. Organisation id {org_id}")


if __name__ == "__main__":
    asyncio.run(main())
