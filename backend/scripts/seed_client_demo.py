"""Seed a complete, polished demo organisation for showing CareCliQ to clients.

Creates "Harbourside Community Care" (abbreviation HBCC): a managing
director, two support coordinators, six support workers and six
participants, with every profile filled in. Workers have current, verified
credentials (with certificate files), availability, skills, bank and super
details, training, induction and policy sign-offs. Participants have plans,
budgets, goals, care profiles, GP and case manager details, safety plans,
task lists, medications where relevant and signed service agreements.
Each participant has been through onboarding (screened, met, agreement
signed, made active) and is ready to roster: matching interest and
lived-experience tags shared with a main and a backup worker, whose weekly
availability and past-shift ratings feed the roster's suggestions.
Three weeks of completed shifts carry good progress notes; the next two
weeks are rostered; one shift is in progress right now. There are resolved
incidents and complaints, invoices, plan meetings, a shift conversation,
inbox notifications, and portal logins for a participant and a parent.

Unlike seed_pilot_org.py, nothing here is deliberately wrong: it's for
showing the product working, not for finding compliance gaps.

Everyone is fictional. Emails are @example.com (never delivered), phone
numbers are from ACMA's ranges reserved for fiction, the ABN passes the
checksum but isn't registered to anyone. All logins share the password in
CLIENT_DEMO_PASSWORD (set when an account is first created; never stored in
the repo). Nothing sends email or push.

Re-runnable: everything is found by a natural key (NDIS number, worker and
credential type, participant and shift start, ...) and filled in or left
alone, so a second run completes anything a first run didn't. It never
deletes and never touches another organisation.

A shift only stays in progress until it ends, after which the app ends it.
Before a demo, put a fresh one in progress:

    CLIENT_DEMO_PASSWORD=... .venv/Scripts/python -m backend.scripts.seed_client_demo --refresh-live

Full seed, from the repo root:

    CLIENT_DEMO_PASSWORD=... .venv/Scripts/python -m backend.scripts.seed_client_demo

Add --env-file <file> to seed a project other than the one in .env (it
prints which database it's writing to first). --rewrite-notes regenerates
the completed shifts' notes, e.g. after changing the note generator.
"""

from __future__ import annotations

import asyncio
import io
import os
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

from dotenv import dotenv_values, load_dotenv

# --env-file picks the project to seed (default .env). It always says which
# one before writing, because .env is sometimes pointed at a local database.
if "--env-file" in sys.argv:
    _env_file = sys.argv[sys.argv.index("--env-file") + 1]
    if not os.path.exists(_env_file):
        sys.exit(f"{_env_file} not found.")
    os.environ.update({k: v for k, v in dotenv_values(_env_file).items() if v is not None})
load_dotenv()
_target = os.environ.get("SUPABASE_URL", "")
print(f"Seeding the database at {_target.split('//')[-1].split('.')[0] or '(no SUPABASE_URL)'}")

from backend.app.api.auth import _upsert_user_record  # noqa: E402
from backend.app.schemas.participant import ParticipantCreate, ParticipantUpdate  # noqa: E402
from backend.app.services import funding_service, participant_service, shift_service, vault_service  # noqa: E402
from backend.app.services import organization_branding_service as branding  # noqa: E402
from backend.app.services import service_agreement_document_service as agreements  # noqa: E402
from backend.app.services import user_notification_store as inbox  # noqa: E402
from backend.app.services.employee_id_service import generate_employee_id  # noqa: E402
from backend.app.services.supabase_client import get_supabase_admin  # noqa: E402

ORG_NAME = "Harbourside Community Care"
ORG_ABBREV = "HBCC"
ORG_EMAIL = "hello@harbourside.example.com"
PASSWORD = os.environ.get("CLIENT_DEMO_PASSWORD", "")
TZ = ZoneInfo("Australia/Adelaide")
TODAY = datetime.now(TZ).date()
NOW = datetime.now(TZ)

PROFILE_PHOTOS_BUCKET = "profile-photos"
CREDENTIAL_FILES_BUCKET = "credential-files"


def abn_with_valid_checksum(body: str = "512345678") -> str:
    """ABN check: subtract 1 from the first digit, weight, sum % 89 == 0."""
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    for prefix in range(10, 100):
        digits = [int(c) for c in f"{prefix}{body}"]
        digits[0] -= 1
        if sum(d * w for d, w in zip(digits, weights)) % 89 == 0:
            s = f"{prefix}{body}"
            return f"{s[:2]} {s[2:5]} {s[5:8]} {s[8:]}"
    raise RuntimeError("no valid ABN prefix")


ABN = abn_with_valid_checksum()

ORG = {
    "name": ORG_NAME,
    "organization_name": ORG_NAME,
    "display_name": ORG_NAME,
    "org_abbrev": ORG_ABBREV,
    "abn": ABN,
    "ndis_provider_number": "4050812736",
    "provider_type": "registered_ndis",
    "registration_status": "registered",
    "org_type": "disability",
    "team_size": "5_20",
    "participant_volume": "1_10",
    "contact_number": "(08) 5550 1200",
    "email": ORG_EMAIL,
    "org_address": "Level 2, 118 Harbourside Parade, Port Adelaide SA 5015",
    "brand_accent_color": "#1F6F78",
    "plan_tier": "medium",
    "subscription_status": "active",
    "compliance_target": 95,
    "status": "active",
}

# ACMA-reserved fictional mobile numbers.
PHONES = iter([
    "0491 570 006", "0491 570 156", "0491 570 157", "0491 570 158", "0491 570 159", "0491 570 110",
    "0491 570 313", "0491 570 737", "0491 571 266", "0491 571 491", "0491 571 804", "0491 572 549",
    "0491 572 665", "0491 572 983", "0491 573 770", "0491 573 087", "0491 574 118", "0491 574 632",
    "0491 575 254", "0491 575 789", "0491 576 398", "0491 576 801", "0491 577 426", "0491 577 644",
    "0491 578 957", "0491 578 148", "0491 578 888", "0491 579 212", "0491 579 760", "0491 579 455",
])

STAFF = [
    {
        "key": "olivia", "email": "olivia.bennett@harbourside.example.com", "full_name": "Olivia Bennett",
        "role": "managing_director", "account_type": "managing_director", "dob": "1979-03-18",
        "suburb": "Semaphore", "address": "8 Esplanade Court, Semaphore SA 5019",
        "emergency": "Mark Bennett (husband)", "employment": "full_time", "years": "18",
        "summary": "Founded Harbourside in 2015 after a decade in disability case management. Leads quality, safeguarding and NDIS registration, and still spends a day a week out with participants and their families.",
    },
    {
        "key": "daniel", "email": "daniel.okafor@harbourside.example.com", "full_name": "Daniel Okafor",
        "role": "support_coordinator", "account_type": "small_provider", "dob": "1986-07-02",
        "suburb": "Birkenhead", "address": "27 Victoria Road, Birkenhead SA 5015",
        "emergency": "Grace Okafor (wife)", "employment": "full_time", "years": "11",
        "summary": "Senior support coordinator for Harbourside's western suburbs participants. Background in psychosocial recovery and behaviour support; runs the weekly roster and incident reviews.",
    },
    {
        "key": "meilin", "email": "meilin.chen@harbourside.example.com", "full_name": "Mei Lin Chen",
        "role": "support_coordinator", "account_type": "small_provider", "dob": "1991-11-24",
        "suburb": "Prospect", "address": "5 Carter Street, Prospect SA 5082",
        "emergency": "Wei Chen (brother)", "employment": "full_time", "years": "7",
        "summary": "Support coordinator for children and young people. Speaks Mandarin and Cantonese, and leads plan reviews, school liaison and family check-ins.",
    },
]

WORKERS = [
    {"key": "priya", "full_name": "Priya Nair", "dob": "1994-04-09", "suburb": "Woodville", "address": "12 Glenroy Street, Woodville SA 5011",
     "emergency": "Anil Nair (father)", "employment": "part_time", "years": "6", "coordinator": "daniel",
     "summary": "Cert IV Disability. Six years supporting adults with acquired brain injury; patient teacher for cooking, budgeting and public transport training.",
     "skills": ["Acquired brain injury", "Community access", "Meal preparation", "Public transport training"]},
    {"key": "james", "full_name": "James Whitfield", "dob": "1968-12-01", "suburb": "Kilkenny", "address": "40 Day Terrace, Kilkenny SA 5009",
     "emergency": "Helen Whitfield (wife)", "employment": "full_time", "years": "14",
     "coordinator": "daniel",
     "summary": "Former aged care team leader. Experienced with stroke recovery, diabetes management and medication assistance; calm and reliable morning routines.",
     "skills": ["Medication assistance", "Diabetes support", "Stroke recovery", "Manual handling"]},
    {"key": "fatima", "full_name": "Fatima Hassan", "dob": "1990-08-15", "suburb": "Croydon", "address": "3 Elizabeth Street, Croydon SA 5008",
     "emergency": "Yusuf Hassan (husband)", "employment": "part_time", "years": "8", "coordinator": "meilin",
     "summary": "Cert IV Disability and AAC trained. Supports people with complex physical needs, hoist transfers and communication devices. Speaks Arabic.",
     "skills": ["Cerebral palsy", "Hoist transfers", "AAC communication", "Personal care"]},
    {"key": "lachlan", "full_name": "Lachlan Murray", "dob": "1997-02-27", "suburb": "Salisbury", "address": "19 Park Terrace, Salisbury SA 5108",
     "emergency": "Fiona Murray (mother)", "employment": "full_time", "years": "4", "coordinator": "daniel",
     "summary": "Former youth worker and keen footballer. Supports young adults building work skills and independence, with a strong focus on choice and control.",
     "skills": ["Down syndrome", "Work skills", "Community access", "Fitness and sport"]},
    {"key": "sofia", "full_name": "Sofia Rossi", "dob": "1999-06-30", "suburb": "Glenelg", "address": "21 Moseley Street, Glenelg SA 5045",
     "emergency": "Marco Rossi (father)", "employment": "casual", "years": "3", "coordinator": "meilin",
     "summary": "Studying occupational therapy at UniSA. Supports autistic children with sensory regulation, social stories and after-school routines.",
     "skills": ["Autism", "Children and young people", "Sensory regulation", "Visual schedules"]},
    {"key": "kwame", "full_name": "Kwame Mensah", "dob": "1984-10-12", "suburb": "Brooklyn Park", "address": "77 Marion Road, Brooklyn Park SA 5032",
     "emergency": "Ama Mensah (wife)", "employment": "part_time", "years": "9", "coordinator": "meilin",
     "summary": "Experienced with progressive neurological conditions, fatigue management and mobility aids. Enjoys supporting community and art activities.",
     "skills": ["Multiple sclerosis", "Fatigue management", "Mobility aids", "Community access"]},
]
for w in WORKERS:
    w.update({
        "email": f"{w['key']}@harbourside.example.com", "role": "support_worker", "account_type": "independent_worker",
    })

# Credentials every worker holds: (type, title, issuer, issued_days_ago, valid_for_days or None)
CREDENTIALS = [
    ("ndis_screening", "NDIS Worker Screening Check", "SA Department of Human Services", 420, 1825),
    ("wwcc", "Working with Children Check", "SA Department of Human Services", 380, 1825),
    ("police_check", "National Police Check", "Australian Federal Police", 300, 1095),
    ("code_of_conduct", "NDIS Code of Conduct acknowledgement", ORG_NAME, 300, None),
    ("ndis_orientation", "NDIS Worker Orientation Module", "NDIS Quality and Safeguards Commission", 410, None),
    ("first_aid", "Provide First Aid (HLTAID011)", "St John Ambulance SA", 210, 1095),
    ("cpr", "Provide CPR (HLTAID009)", "St John Ambulance SA", 210, 365),
    ("manual_handling", "Manual handling", "WorkSafe training", 260, 730),
    ("infection_control", "Infection prevention and control", "Australian Government Department of Health", 260, 730),
    ("medication_admin", "Assist clients with medication (HLTHPS006)", "TAFE SA", 390, 1095),
    ("drivers_licence", "Driver's licence (C class)", "Service SA", 900, 1825),
]

PARTICIPANTS = [
    {
        "key": "ethan", "full_name": "Ethan Clarke", "preferred_name": "Ethan", "ndis_number": "431880101", "dob": "2000-05-14",
        "sex": "male", "email": "ethan.clarke@example.com", "address": "14 Wattle Street, Norwood SA 5067", "lat": -34.9212, "lng": 138.6301,
        "disability": "Acquired brain injury (motor vehicle accident, 2019)", "plan": (-150, 215, 68500, "plan-managed"), "worker": "priya",
        "coordinator": "daniel", "risk": "low",
        "goals": [
            ("Cook three dinners a week on my own", "daily_living", "core_daily_activities", "Plan, shop for and cook simple dinners with less prompting each month.", "Ethan wants to move into a share house with friends next year."),
            ("Travel to TAFE by bus independently", "community", "core_social_community", "Build confidence planning trips and catching the bus to TAFE twice a week.", "Getting to TAFE without his mum driving him is Ethan's biggest goal."),
        ],
        "supports": [("01_011_0107_1_1", 156, "weekly", "home"), ("04_104_0125_6_1", 156, "weekly", "other")],
        "pattern": [(0, 9, 3), (2, 9, 3), (4, 9, 3)],
        "comm": "Clear, short instructions one step at a time. Ethan can lose track in noisy places, so check in after each step.",
        "likes": "Likes: AFL (Port Adelaide), cooking pasta, gaming with friends. Dislikes: being rushed, crowded shopping centres.",
        "routine": "Up at 8:00, breakfast and medication checklist, TAFE Tuesdays and Thursdays, gym session Saturday morning.",
        "interests": "AFL, cooking, video games, the gym",
        "activities": ["Cooking", "Gym", "Bus training", "Footy at Alberton Oval"],
        "sensory": "Sensitive to loud, echoing spaces after his injury. Prefers quieter times at the shops.",
        "cultural": "No specific cultural requirements. Celebrates Christmas with family.",
        "conditions": "Acquired brain injury affecting short-term memory and planning; mild right-side weakness.",
        "history": "Ethan is 26 and lives with his mother in Norwood. He was injured in a car accident in 2019 and has worked hard on his recovery. He is studying a Certificate III in Hospitality at TAFE. He wants to move into a share house with friends.",
        "emergency": ("Sarah Clarke", "Mother", "0491 570 006"), "gp": ("Dr Anna Kowalski", "Norwood Family Practice", "(08) 5550 2101"),
        "case_manager": ("Rachel Hughes", "0491 571 266", "rachel.hughes@example.com"),
        "meds": [], "allergies": [],
        "alerts": ["Short-term memory: write the plan for the visit on his whiteboard at the start of each shift."],
        "tasks": [("Plan the visit together on the whiteboard", "daily_living"), ("Cook dinner with verbal prompts only", "daily_living"), ("Practise the bus route to TAFE", "community")],
    },
    {
        "key": "ruby", "full_name": "Ruby Thompson", "preferred_name": "Ruby", "ndis_number": "431880102", "dob": "2016-09-03",
        "sex": "female", "email": "claire.thompson@example.com", "address": "7 Banksia Court, Glenelg North SA 5045", "lat": -34.9653, "lng": 138.5202,
        "disability": "Autism spectrum disorder (level 2)", "plan": (-90, 275, 54000, "NDIA-managed"), "worker": "sofia",
        "coordinator": "meilin", "risk": "medium",
        "goals": [
            ("Join a weekend activity with other kids", "social", "core_social_community", "Try a Saturday art or swimming class with support to manage noise and crowds.", "Ruby's parents want her to make friends outside school."),
            ("Follow her after-school routine with a visual schedule", "daily_living", "cb_daily_activity", "Use her picture schedule for homework, snack and play with fewer prompts.", "A predictable afternoon means fewer meltdowns at home."),
        ],
        "supports": [("04_104_0125_6_1", 208, "weekly", "other")],
        "pattern": [(1, 15, 3), (3, 15, 3), (5, 10, 3)],
        "comm": "Speaks in short sentences and uses a picture schedule. Give warnings before changes; use her name before an instruction.",
        "likes": "Likes: drawing, dinosaurs, swimming, Bluey. Dislikes: hand dryers, sudden changes, wet clothes.",
        "routine": "School 8:45 to 3:00. After school: snack, 20 minutes quiet time with headphones, homework, then play. Bed at 7:30.",
        "interests": "Drawing, dinosaurs, swimming, Lego",
        "activities": ["Art class", "Swimming", "Library story time", "Playground"],
        "sensory": "Noise-cancelling headphones in her backpack. Avoid hand dryers; bring wipes. Weighted lap pad helps in the car.",
        "cultural": "Family is Catholic; attends church some Sundays.",
        "conditions": "Autism (level 2), anaphylactic peanut allergy.",
        "history": "Ruby is 10 and lives with her parents and older brother in Glenelg North. She attends a mainstream primary school with a learning support plan. She loves drawing and dinosaurs. Her parents want her to build friendships and manage busy places with less distress.",
        "emergency": ("Claire Thompson", "Mother", "0491 570 156"), "gp": ("Dr Michael Tan", "Glenelg Medical Centre", "(08) 5550 2102"),
        "case_manager": ("Mei Lin Chen", "0491 571 491", "meilin.chen@harbourside.example.com"),
        "meds": [], "allergies": [("Peanuts", "anaphylactic", "EpiPen Jr in the front pocket of her school bag. Check it's there before leaving home.")],
        "alerts": ["Anaphylactic peanut allergy. EpiPen Jr in the front pocket of her school bag.", "Give a 5-minute warning before any change of activity."],
        "tasks": [("Check the EpiPen is in her bag", "health"), ("Follow the visual schedule for the afternoon", "daily_living"), ("Practise turn-taking during play", "social")],
    },
    {
        "key": "george", "full_name": "George Papadopoulos", "preferred_name": "George", "ndis_number": "431880103", "dob": "1960-01-22",
        "sex": "male", "email": "george.papadopoulos@example.com", "address": "22 Fenwick Avenue, Prospect SA 5082", "lat": -34.8851, "lng": 138.5944,
        "disability": "Stroke (left hemiparesis) and type 2 diabetes", "plan": (-300, 65, 92000, "self-managed"), "worker": "james",
        "coordinator": "daniel", "risk": "medium",
        "goals": [
            ("Keep my morning medication on track", "health", "core_daily_activities", "Take morning medication with prompting and record it on the chart himself.", "George wants to stay living in his own home."),
            ("Walk to the local café twice a week", "community", "core_social_community", "Short supported walks with his quad stick to build stamina.", "The café is where George catches up with his friends from church."),
        ],
        "supports": [("01_011_0107_1_1", 364, "weekly", "home"), ("01_013_0107_1_1", 52, "weekly", "home")],
        "pattern": [(0, 8, 2), (1, 8, 2), (2, 8, 2), (3, 8, 2), (4, 8, 2), (5, 8, 2), (6, 8, 2)],
        "comm": "Speaks English and Greek. Slightly slurred speech since his stroke; give him time to finish and don't finish his sentences.",
        "likes": "Likes: Greek coffee, Olympiacos football, gardening, his grandchildren's visits. Dislikes: being hurried, cold showers.",
        "routine": "Up at 7:30. Blood glucose check, breakfast, 8:00 medication, shower with assistance, then the paper on the verandah.",
        "interests": "Gardening, football, church community, Greek music",
        "activities": ["Café walks", "Gardening", "Church on Sundays"],
        "sensory": "Reduced sensation on his left side; check water temperature for him.",
        "cultural": "Greek Orthodox. Observes Lent with no meat on Wednesdays and Fridays during fasting periods.",
        "conditions": "Left-sided weakness after a stroke in 2021; type 2 diabetes managed with metformin; hypertension.",
        "history": "George is 66, widowed, and lives alone in the Prospect home he has owned for 40 years. He had a stroke in 2021 and walks with a quad stick. His daughter visits most weekends. He wants to keep living independently and stay connected with his church community.",
        "emergency": ("Eleni Papadopoulos", "Daughter", "0491 570 157"), "gp": ("Dr Sophia Andreou", "Prospect Road Medical", "(08) 5550 2103"),
        "case_manager": ("Tom Harrington", "0491 571 804", "tom.harrington@example.com"),
        "meds": [
            {"name": "Metformin", "strength": "500 mg", "dosage": "1 tablet with breakfast", "times": ["08:00"], "prescriber": "Dr Sophia Andreou", "high_risk": False},
            {"name": "Amlodipine", "strength": "5 mg", "dosage": "1 tablet", "times": ["08:00"], "prescriber": "Dr Sophia Andreou", "high_risk": False},
        ],
        "allergies": [("Penicillin", "moderate", "Rash and hives, documented by his GP in 2018.")],
        "alerts": ["Falls risk: quad stick within reach at all times; non-slip mat in the shower.", "Check blood glucose before breakfast; below 4.0 follow his hypo plan."],
        "tasks": [("Prompt and record 8:00 medication", "health"), ("Assist with shower and dressing", "daily_living"), ("Supported walk with quad stick", "community")],
    },
    {
        "key": "amara", "full_name": "Amara Nwosu", "preferred_name": "Amara", "ndis_number": "431880104", "dob": "1995-11-30",
        "sex": "female", "email": "amara.nwosu@example.com", "address": "Unit 3, 41 Grote Street, Adelaide SA 5000", "lat": -34.9290, "lng": 138.5960,
        "disability": "Cerebral palsy (spastic quadriplegia)", "plan": (-40, 325, 118000, "plan-managed"), "worker": "fatima",
        "coordinator": "meilin", "risk": "medium",
        "goals": [
            ("Find part-time work in graphic design", "employment", "cb_employment", "Build a portfolio and apply for two roles a month with interview practice.", "Amara finished a design diploma and wants to work in her field."),
            ("Use public transport in the city with my power chair", "community", "core_social_community", "Plan accessible trips on trams and buses around the CBD.", "Independence getting to the city studio where she volunteers."),
        ],
        "supports": [("01_011_0107_1_1", 208, "weekly", "home"), ("04_104_0125_6_1", 104, "weekly", "other")],
        "pattern": [(0, 10, 4), (3, 10, 4)],
        "comm": "Uses a speech-generating device (Tobii) and some speech. Ask yes/no questions when she is tired and wait for her answer.",
        "likes": "Likes: graphic design, podcasts, Afrobeats, Adelaide Fringe shows. Dislikes: people speaking to her support worker instead of her.",
        "routine": "Morning personal care 7:30 to 9:00 with a hoist transfer, breakfast, then design work at her desk or volunteering at the studio.",
        "interests": "Graphic design, illustration, music, theatre",
        "activities": ["Portfolio work", "Studio volunteering", "Fringe events", "Tram trips in the city"],
        "sensory": "Startles at sudden loud noises (startle reflex). Warn her before moving her chair.",
        "cultural": "Nigerian (Igbo) heritage. Prefers her hair care products; family brings Nigerian food on Sundays.",
        "conditions": "Cerebral palsy affecting all four limbs; uses a power wheelchair and ceiling hoist.",
        "history": "Amara is 30 and lives on her own in a supported apartment in the city. She has a Diploma of Graphic Design and volunteers at a community art studio. She directs her own supports and is clear about how she likes things done. She wants paid work in design.",
        "emergency": ("Chidi Nwosu", "Brother", "0491 570 158"), "gp": ("Dr Kate Morrison", "City Health Clinic", "(08) 5550 2104"),
        "case_manager": ("Mei Lin Chen", "0491 571 491", "meilin.chen@harbourside.example.com"),
        "meds": [
            {"name": "Baclofen", "strength": "10 mg", "dosage": "1 tablet", "times": ["08:00", "20:00"], "prescriber": "Dr Kate Morrison", "high_risk": False},
        ],
        "allergies": [("Latex", "moderate", "Use nitrile gloves only for personal care.")],
        "alerts": ["Two-person-trained hoist transfers only; check the sling for wear before each use.", "Use nitrile gloves: latex allergy."],
        "tasks": [("Hoist transfer using her ceiling hoist", "daily_living"), ("Portfolio and job applications session", "employment"), ("Charge her communication device", "daily_living")],
    },
    {
        "key": "noah", "full_name": "Noah Williams", "preferred_name": "Noah", "ndis_number": "431880105", "dob": "2006-02-19",
        "sex": "male", "email": "noah.williams@example.com", "address": "9 Peppermint Way, Mawson Lakes SA 5095", "lat": -34.8085, "lng": 138.6110,
        "disability": "Down syndrome", "plan": (-60, 305, 76000, "plan-managed"), "worker": "lachlan",
        "coordinator": "daniel", "risk": "low",
        "goals": [
            ("Get a casual job at a café", "employment", "cb_employment", "Practise barista and customer service skills at a supported work placement.", "Noah wants to earn his own money for footy tickets."),
            ("Do my own grocery shop with a list", "daily_living", "core_daily_activities", "Write a list, find items and pay at the self-checkout.", "A step towards moving out of home with his friend Josh."),
        ],
        "supports": [("04_104_0125_6_1", 312, "weekly", "other")],
        "pattern": [(1, 9, 5), (2, 9, 5), (4, 9, 5)],
        "comm": "Chatty and friendly. Use plain language and check understanding by asking him to explain it back.",
        "likes": "Likes: AFL (Adelaide Crows), making coffee, Taylor Swift, his dog Biscuit. Dislikes: being treated like a kid, long waits.",
        "routine": "Up at 7:00, walks Biscuit, breakfast. Work placement Tuesday and Wednesday, footy training Thursday night.",
        "interests": "Football, coffee, music, his dog",
        "activities": ["Café work placement", "Footy training", "Grocery shopping", "Cooking"],
        "sensory": "No significant sensory needs.",
        "cultural": "No specific cultural requirements.",
        "conditions": "Down syndrome; mild hearing loss in his left ear (speak on his right side).",
        "history": "Noah is 20 and lives with his parents in Mawson Lakes. He finished school last year and does a supported work placement at a local café. He plays for an inclusive footy team. He wants a paid job and to move out with a friend one day.",
        "emergency": ("Kate Williams", "Mother", "0491 570 159"), "gp": ("Dr Raj Patel", "Mawson Lakes Medical", "(08) 5550 2105"),
        "case_manager": ("Rachel Hughes", "0491 571 266", "rachel.hughes@example.com"),
        "meds": [], "allergies": [],
        "alerts": ["Mild hearing loss in his left ear: stand on his right side when giving instructions."],
        "tasks": [("Café placement: barista practice", "employment"), ("Write and check the shopping list", "daily_living"), ("Budget check: count change after paying", "daily_living")],
    },
    {
        "key": "isabella", "full_name": "Isabella Garcia", "preferred_name": "Bella", "ndis_number": "431880106", "dob": "1981-07-09",
        "sex": "female", "email": "isabella.garcia@example.com", "address": "56 Ashley Street, Brooklyn Park SA 5032", "lat": -34.9301, "lng": 138.5402,
        "disability": "Multiple sclerosis (relapsing-remitting)", "plan": (-200, 165, 61000, "plan-managed"), "worker": "kwame",
        "coordinator": "meilin", "risk": "low",
        "goals": [
            ("Manage my energy so I can keep painting", "health", "cb_daily_activity", "Use a fatigue plan to pace household tasks and keep afternoons free for art.", "Painting is how Bella stays herself."),
            ("Take part in a community art group", "social", "core_social_community", "Attend the Henley Beach art group fortnightly with transport and setup support.", "Bella misses the friends she made through her old art classes."),
        ],
        "supports": [("01_011_0107_1_1", 156, "weekly", "home"), ("04_104_0125_6_1", 78, "weekly", "other")],
        "pattern": [(0, 13, 3), (2, 13, 3), (5, 13, 3)],
        "comm": "Bella prefers to be asked rather than told, and likes a plan for the visit agreed at the start.",
        "likes": "Likes: painting, gardening, Spanish cooking, her cat Luna. Dislikes: heat, wasted energy on things that can wait.",
        "routine": "Mornings are her best energy. Rests from 12:00 to 13:00, then light tasks or art. Avoids outings on hot days.",
        "interests": "Painting, gardening, cooking, reading",
        "activities": ["Art group", "Gardening", "Cooking", "Beach walks on cool days"],
        "sensory": "Heat makes her symptoms worse (Uhthoff's): keep the house cool and carry water.",
        "cultural": "Spanish-Australian; speaks Spanish with her mother.",
        "conditions": "Relapsing-remitting MS with fatigue and reduced balance; uses a walker outdoors.",
        "history": "Bella is 45 and lives with her partner in Brooklyn Park. She was a graphic artist until fatigue made full-time work hard. She paints most afternoons and sells her work at local markets. She wants to stay active in her art community.",
        "emergency": ("Daniela Ruiz", "Partner", "0491 571 804"), "gp": ("Dr Helen Park", "Brooklyn Park Family Clinic", "(08) 5550 2106"),
        "case_manager": ("Tom Harrington", "0491 571 804", "tom.harrington@example.com"),
        "meds": [], "allergies": [("Sulfa drugs", "moderate", "Rash; listed on her medical alert bracelet.")],
        "alerts": ["Heat-sensitive: avoid outings above 32 degrees and keep water with her."],
        "tasks": [("Agree the energy plan for the visit", "health"), ("Light household tasks from her list", "daily_living"), ("Set up her painting area", "social")],
    },
]

PORTAL_LOGINS = [
    {"email": "ethan.clarke@example.com", "full_name": "Ethan Clarke", "participant": "ethan", "relationship": "self", "notes": None},
    {"email": "claire.thompson@example.com", "full_name": "Claire Thompson", "participant": "ruby", "relationship": "parent", "notes": "Mother of Ruby (10) and her primary carer."},
]

# folder_key: the vault folders in migration 240.
# participant_task_templates.category values (migration 088).
TASK_CATEGORY = {
    "daily_living": "domestic_assistance", "community": "community_access", "social": "community_access",
    "health": "health_wellness", "employment": "other",
}

POLICIES = [
    ("governance_operational", "Code of conduct", "How we work with participants, families and each other, in line with the NDIS Code of Conduct."),
    ("incident_management_system", "Incident management policy", "How to respond to, report and learn from incidents, including NDIS reportable incidents within 24 hours."),
    ("feedback_complaints", "Complaints and feedback policy", "How participants and families can raise concerns, and how we respond within 5 business days."),
    ("risk_management", "Medication assistance procedure", "Prompting and assisting with medication, recording on the chart and what to do when a dose is missed."),
    ("risk_management", "Work health and safety policy", "Hazard reporting, manual handling, working alone and home visit safety."),
    ("information_management", "Privacy and confidentiality policy", "How we collect, store and share personal information under the Australian Privacy Principles."),
]

TRAINING = [
    ("NDIS Worker Orientation Module", "NDIS Quality and Safeguards Commission", "mandatory", 90),
    ("Manual handling refresher", "WorkSafe training", "mandatory", 60),
    ("Medication assistance refresher", "TAFE SA", "mandatory", 120),
    ("Positive behaviour support basics", ORG_NAME, "recommended", 45),
    ("Supporting people with communication devices", ORG_NAME, "recommended", 40),
]

INDUCTION = [
    "Welcome to Harbourside and our values", "Using CareCliQ on your phone", "Shift notes that meet NDIS standards",
    "Emergency procedures and on-call contacts", "Meet your coordinator",
]


def d(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def local(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), TZ)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Helpers ───────────────────────────────────────────────────────────────────

def find(db, table: str, match: dict[str, Any]) -> Optional[dict[str, Any]]:
    q = db.table(table).select("*")
    for key, value in match.items():
        q = q.eq(key, value)
    rows = q.limit(1).execute().data
    return rows[0] if rows else None


def ensure(db, table: str, match: dict[str, Any], values: dict[str, Any], *, fill: bool = True) -> dict[str, Any]:
    """Insert unless a row matching `match` exists; with fill, top up its fields."""
    row = find(db, table, match)
    if row is None:
        return db.table(table).insert({**match, **values}).execute().data[0]
    if fill and values:
        q = db.table(table).update(values)
        for key, value in match.items():
            q = q.eq(key, value)
        updated = q.execute().data
        return updated[0] if updated else row
    return row


def avatar_png(name: str, colour: tuple[int, int, int]) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    size = 320
    img = Image.new("RGB", (size, size), colour)
    draw = ImageDraw.Draw(img)
    initials = "".join(part[0] for part in name.split()[:2]).upper()
    try:
        font = ImageFont.truetype("arial.ttf", 132)
    except OSError:
        font = ImageFont.load_default()
    box = draw.textbbox((0, 0), initials, font=font)
    draw.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1]), initials, fill=(255, 255, 255), font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def logo_png() -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((16, 16, 496, 496), radius=110, fill=(31, 111, 120, 255))
    for i, y in enumerate((300, 350, 400)):
        draw.arc((80, y - 60, 432, y + 60), start=200, end=340, fill=(255, 255, 255, 255 - i * 60), width=18)
    try:
        font = ImageFont.truetype("arialbd.ttf", 150)
    except OSError:
        font = ImageFont.load_default()
    draw.text((256, 190), "H", fill=(255, 255, 255, 255), font=font, anchor="mm")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def certificate_pdf(holder: str, title: str, issuer: str, number: str, issued: str, expires: Optional[str]) -> bytes:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=landscape(A4))
    width, height = landscape(A4)
    c.setStrokeColorRGB(0.12, 0.43, 0.47)
    c.setLineWidth(6)
    c.rect(30, 30, width - 60, height - 60)
    c.setFont("Helvetica-Bold", 30)
    c.drawCentredString(width / 2, height - 120, title)
    c.setFont("Helvetica", 16)
    c.drawCentredString(width / 2, height - 170, "This certifies that")
    c.setFont("Helvetica-Bold", 26)
    c.drawCentredString(width / 2, height - 215, holder)
    c.setFont("Helvetica", 14)
    c.drawCentredString(width / 2, height - 260, f"Issued by {issuer}")
    c.drawCentredString(width / 2, height - 285, f"Number {number}   Issued {issued}" + (f"   Expires {expires}" if expires else ""))
    c.setFont("Helvetica-Oblique", 10)
    c.drawCentredString(width / 2, 60, "Sample document for a CareCliQ demonstration. Not a real certificate.")
    c.showPage()
    c.save()
    return buf.getvalue()


def upload(db, bucket: str, path: str, data: bytes, content_type: str) -> None:
    db.storage.from_(bucket).upload(path, data, {"content-type": content_type, "upsert": "true"})


# ── Organisation and people ───────────────────────────────────────────────────

def ensure_org(db) -> str:
    existing = db.table("organizations").select("organization_id, name, email").eq("org_abbrev", ORG_ABBREV).execute().data
    if existing and (existing[0].get("email") != ORG_EMAIL):
        sys.exit(f"Another organisation already uses the abbreviation {ORG_ABBREV}. Stopping.")
    if existing:
        org_id = existing[0]["organization_id"]
        db.table("organizations").update(ORG).eq("organization_id", org_id).execute()
        print(f"Organisation exists, details refreshed: {ORG_NAME}")
    else:
        org_id = db.table("organizations").insert(ORG).execute().data[0]["organization_id"]
        print(f"Created organisation: {ORG_NAME} (ABN {ABN})")
    db.table("branches").update({"state": "SA", "name": "Port Adelaide head office"}).eq("organization_id", org_id).eq("is_head_office", True).execute()
    org = db.table("organizations").select("logo_url").eq("organization_id", org_id).execute().data[0]
    if not org.get("logo_url"):
        branding.upload_logo(org_id, logo_png(), "image/png")
    ensure(db, "organization_financial_settings", {"organization_id": org_id}, {
        "cash_on_hand_cents": 18_450_000, "cash_as_of": d(-1), "monthly_overheads_cents": 6_200_000, "updated_at": iso_now(),
    })
    return org_id


def head_office(db, org_id: str) -> str:
    return db.table("branches").select("id").eq("organization_id", org_id).eq("is_head_office", True).execute().data[0]["id"]


def find_auth_user_id(db, email: str) -> Optional[str]:
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


def auth_user(db, email: str, full_name: str) -> str:
    user_id = find_auth_user_id(db, email)
    if user_id:
        return user_id
    created = db.auth.admin.create_user({
        "email": email, "password": PASSWORD, "user_metadata": {"full_name": full_name}, "email_confirm": True,
    })
    return str(created.user.id)


_LEVELS: dict[str, str] = {}


def schads_level(db, spec: dict) -> Optional[str]:
    """SCHADS (Social and Community Services) level for the role and experience."""
    if not _LEVELS:
        for row in db.table("award_classifications").select("id, level, pay_point").is_("valid_to", "null").eq("pay_point", "1").execute().data:
            _LEVELS.setdefault(str(row["level"]), row["id"])
    if spec["role"] == "managing_director":
        level = "7"
    elif spec["role"] == "support_coordinator":
        level = "5"
    else:
        level = "3" if int(spec["years"]) >= 5 else "2"
    return _LEVELS.get(level)


AVATAR_COLOURS = [(31, 111, 120), (85, 51, 204), (194, 120, 3), (22, 101, 52), (190, 24, 93), (30, 64, 175), (124, 58, 237), (180, 83, 9), (15, 118, 110)]


async def ensure_staff(db, org_id: str, branch_id: str, spec: dict, index: int, coordinators: dict[str, str]) -> str:
    user_id = auth_user(db, spec["email"], spec["full_name"])
    await _upsert_user_record(
        user_id=user_id, email=spec["email"], role=spec["role"], full_name=spec["full_name"],
        account_type=spec["account_type"], onboarding_complete=True,
        extra={"organization_id": org_id, "email_verified": True, "profile_completed": True,
               "onboarding_completed": True, "role_specific_profile_completed": True},
    )
    profile = db.table("users").select("profile_photo_path, phone").eq("id", user_id).execute().data[0]
    values: dict[str, Any] = {
        "phone": profile.get("phone") or next(PHONES), "suburb": spec["suburb"], "address": spec["address"],
        "emergency_contact": f"{spec['emergency']}, {next(PHONES)}", "date_of_birth": spec["dob"],
        "profile_summary": spec["summary"], "profile_experience_years": spec["years"],
        "preferred_contact_method": "in_app_message" if spec["role"] == "support_worker" else "phone_call",
        "employment_type": spec["employment"], "preferred_language": "en", "is_active": True,
        "welcome_seen_at": iso_now(), "onboarding_completed_seen_at": iso_now(), "matching_opt_in": True,
        "business_name": ORG_NAME, "classification_id": schads_level(db, spec),
    }
    if spec["role"] == "support_worker" and coordinators.get(spec.get("coordinator", "")):
        values["coordinator_id"] = coordinators[spec["coordinator"]]
    if not profile.get("profile_photo_path"):
        path = f"{org_id}/{user_id}/avatar-{uuid4().hex}.png"
        upload(db, PROFILE_PHOTOS_BUCKET, path, avatar_png(spec["full_name"], AVATAR_COLOURS[index % len(AVATAR_COLOURS)]), "image/png")
        values["profile_photo_path"] = path
    db.table("users").update(values).eq("id", user_id).execute()

    member = find(db, "organization_members", {"organization_id": org_id, "user_id": user_id})
    if not member:
        db.table("organization_members").insert({
            "user_id": user_id, "organization_id": org_id, "role": spec["role"], "is_active": True,
            "employee_id": generate_employee_id(db, org_id, spec["role"]), "branch_id": branch_id,
            "joined_at": (NOW - timedelta(days=400 - index * 30)).isoformat(),
        }).execute()
    else:
        db.table("organization_members").update({"branch_id": branch_id, "is_active": True}).eq("id", member["id"]).execute()
    print(f"  {spec['role']:20s} {spec['full_name']:20s} {spec['email']}")
    return user_id


def seed_worker_details(db, org_id: str, worker_id: str, spec: dict, coordinator_id: str) -> None:
    rng = random.Random(spec["key"])
    for ctype, title, issuer, issued_ago, valid_for in CREDENTIALS:
        issued = TODAY - timedelta(days=issued_ago + rng.randint(0, 40))
        expires = (issued + timedelta(days=valid_for)) if valid_for else None
        number = f"{ctype[:3].upper()}-{rng.randint(1000000, 9999999)}"
        row = ensure(db, "credentials", {"user_id": worker_id, "organization_id": org_id, "credential_type": ctype}, {
            "title": title, "issuer": issuer, "issue_date": issued.isoformat(),
            "expiry_date": expires.isoformat() if expires else None, "status": "valid",
            "credential_number": number, "verified_by": coordinator_id, "verified_at": iso_now(),
            "notes": "Sighted original and verified against the issuer.",
            "screening_number": number if ctype == "ndis_screening" else None,
            "last_checked_against_nwsd": d(-7) if ctype == "ndis_screening" else None,
        }, fill=False)
        if not row.get("file_path"):
            path = f"{org_id}/{worker_id}/{row['id']}-{uuid4().hex}.pdf"
            upload(db, CREDENTIAL_FILES_BUCKET, path, certificate_pdf(spec["full_name"], title, issuer, number, issued.isoformat(), expires.isoformat() if expires else None), "application/pdf")
            db.table("credentials").update({"file_path": path}).eq("id", row["id"]).execute()

    ensure(db, "worker_financial_details", {"worker_id": worker_id, "organization_id": org_id}, {
        "bank_account_name": spec["full_name"], "bank_bsb": f"06{rng.randint(1, 9)}-{rng.randint(100, 999)}",
        "bank_account_number": f"{rng.randint(10000000, 99999999)}", "super_fund_name": rng.choice(["AustralianSuper", "Hostplus", "Aware Super", "HESTA"]),
        "super_member_number": f"{rng.randint(100000000, 999999999)}", "tax_file_number": "123 456 782", "updated_at": iso_now(),
    })
    days = sorted({day for p in PARTICIPANTS if p["worker"] == spec["key"] for day, _, _ in p["pattern"]} | {rng.randint(0, 6)})
    ensure(db, "worker_availability", {"user_id": worker_id, "organization_id": org_id}, {
        "available_days": [day + 1 for day in days], "day_start_time": "07:00", "day_end_time": "18:00",
        "max_hours_per_week": 38 if spec["employment"] == "full_time" else 25, "updated_at": iso_now(),
    })
    for skill in spec["skills"]:
        ensure(db, "worker_skills", {"user_id": worker_id, "organization_id": org_id, "skill": skill}, {
            "is_certified": True, "certified_at": (NOW - timedelta(days=200)).isoformat(),
        }, fill=False)


async def seed_org_library(db, org_id: str, director_id: str) -> dict[str, list[str]]:
    policies = []
    for folder, title, summary in POLICIES:
        doc = ensure(db, "policy_documents", {"organization_id": org_id, "title": title}, {
            "folder_key": folder, "visible_to_workers": True, "created_by": director_id,
            "content_html": f"<h1>{title}</h1><p>{summary}</p><p>Approved by the managing director. Reviewed annually; next review {d(240)}.</p>",
        }, fill=False)
        if not doc.get("current_governance_document_id"):
            # Publishing renders the policy into the governance register, which
            # is what workers acknowledge.
            await vault_service.publish_policy_document(org_id, doc["id"], director_id)
            doc = find(db, "policy_documents", {"id": doc["id"]})
        policies.append(doc["current_governance_document_id"])
    modules = [
        ensure(db, "training_modules", {"organization_id": org_id, "title": title}, {
            "provider": provider, "requirement_type": req, "estimated_minutes": minutes, "is_active": True,
            "requires_certification": req == "mandatory", "auto_assign_on_hire": req == "mandatory",
            "created_by": director_id, "category": "Core skills" if req == "mandatory" else "Professional development",
            "description": f"{title}, delivered by {provider}. About {minutes} minutes.", "updated_at": iso_now(),
        })["id"]
        for title, provider, req, minutes in TRAINING
    ]
    induction = [
        ensure(db, "induction_items", {"organization_id": org_id, "title": title}, {
            "description": f"{title}. Part of the Harbourside induction for new staff.", "is_mandatory": True,
            "sort_order": i, "is_active": True, "created_by": director_id, "updated_at": iso_now(),
        })["id"]
        for i, title in enumerate(INDUCTION)
    ]
    return {"policies": policies, "modules": modules, "induction": induction}


def seed_worker_compliance(db, org_id: str, worker_id: str, library: dict[str, list[str]], reviewer: str) -> None:
    for i, doc_id in enumerate(library["policies"]):
        ensure(db, "policy_acknowledgements", {"worker_id": worker_id, "document_id": doc_id, "organization_id": org_id},
               {"acknowledged_at": (NOW - timedelta(days=120 - i)).isoformat()}, fill=False)
    for i, module_id in enumerate(library["modules"]):
        ensure(db, "worker_training_completions", {"worker_id": worker_id, "module_id": module_id, "organization_id": org_id}, {
            "completed_at": d(-150 + i * 9), "status": "confirmed", "reviewed_by": reviewer, "reviewed_at": (NOW - timedelta(days=140 - i * 9)).isoformat(),
            "acknowledged": True, "acknowledged_at": (NOW - timedelta(days=140 - i * 9)).isoformat(),
            "note": "Completed with certificate uploaded.",
        }, fill=False)
    for i, item_id in enumerate(library["induction"]):
        ensure(db, "worker_induction_completions", {"worker_id": worker_id, "item_id": item_id, "organization_id": org_id},
               {"completed_at": (NOW - timedelta(days=380 - i)).isoformat()}, fill=False)


# ── Participants ──────────────────────────────────────────────────────────────

async def ensure_participant(db, org_id: str, p: dict, staff: dict[str, str]) -> str:
    coordinator_id = staff[p["coordinator"]]
    as_coordinator = {"id": coordinator_id, "sub": coordinator_id, "organization_id": org_id, "role": "support_coordinator"}
    start, end, budget, management = p["plan"]
    existing = find(db, "participants", {"organization_id": org_id, "ndis_number": p["ndis_number"]})
    if existing:
        pid = existing["id"]
    else:
        created = await participant_service.create_participant(ParticipantCreate(
            full_name=p["full_name"], ndis_number=p["ndis_number"], date_of_birth=p["dob"], email=p["email"],
            phone=next(PHONES), primary_disability=p["disability"], biological_sex=p["sex"],
            service_category="disability", plan_start_date=d(start), plan_end_date=d(end), total_budget=budget,
        ), as_coordinator)
        pid = created["id"]
        await participant_service.update_participant(pid, ParticipantUpdate(plan_management_type=management), as_coordinator)

    em_name, em_rel, em_phone = p["emergency"]
    gp_name, gp_practice, gp_phone = p["gp"]
    cm_name, cm_phone, cm_email = p["case_manager"]
    meds_text = "; ".join(f"{m['name']} {m['strength']} at {', '.join(m['times'])}" for m in p["meds"]) or "No regular medication."
    allergy_text = "; ".join(f"{a} ({sev}): {note}" for a, sev, note in p["allergies"]) or "No known allergies."
    db.table("participants").update({
        "preferred_name": p["preferred_name"], "address": p["address"], "latitude": p["lat"], "longitude": p["lng"],
        "address_notes": "Front door; ring the bell and wait. Visitor parking on the street.",
        "risk_level": p["risk"], "risk_triggers": p["sensory"], "risk_management_plan": "; ".join(p["alerts"]),
        "allergies": allergy_text, "medications": meds_text, "medical_alerts": "; ".join(p["alerts"]),
        "communication_preferences": p["comm"], "communication_guidance": p["comm"],
        "emergency_contact": f"{em_name} ({em_rel}) {em_phone}", "emergency_contact_name": em_name,
        "emergency_contact_relationship": em_rel, "emergency_contact_number": em_phone,
        "next_of_kin": [{"name": em_name, "relationship": em_rel, "phone": em_phone}],
        "gp_name": gp_name, "gp_practice": gp_practice, "gp_phone": gp_phone,
        "case_manager_name": cm_name, "case_manager_phone": cm_phone, "case_manager_email": cm_email,
        "likes_dislikes": p["likes"], "daily_routine": p["routine"], "interests": p["interests"],
        "favourite_activities": ", ".join(p["activities"]), "preferred_activities": p["activities"],
        "sensory_preferences": p["sensory"], "cultural_preferences": p["cultural"], "current_conditions": p["conditions"],
        "background_summary": p["history"], "background_summary_updated_at": iso_now(),
        "preferred_schedule": ", ".join(f"{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day]} {h}:00 for {hrs}h" for day, h, hrs in p["pattern"]),
        "preferences_arrival_time": "Please arrive on time; text if you are running more than 5 minutes late.",
        "preferences_other": "Ask before moving personal belongings.",
        "worker_notes": f"Main worker: see the roster. Coordinator: {[s for s in STAFF if s['key'] == p['coordinator']][0]['full_name']}.",
        "behaviour_support_plan": "No behaviour support plan required. Positive strategies are in the safety plan.",
        "behavioural_notes": [{"note": "Responds well to choice and clear plans.", "recorded_at": d(-30)}],
        "previous_visit_notes": "See the most recent shift note.", "previous_visit_notes_updated_at": iso_now(),
        "upcoming_review_date": d(end - 30), "plan_status": "active", "care_coordinator_id": coordinator_id,
        "restricted_behavioural_notes": "None recorded. No restrictive practices are authorised or used.",
        "goals": [g[0] for g in p["goals"]],
        "address_history": [{"address": p["address"], "from": d(-900), "to": None}],
        "assigned_worker_id": staff[p["worker"]], "used_budget": round(budget * max(0.05, min(0.95, -start / (end - start))) * 0.92, 2),
        "updated_at": iso_now(),
    }).eq("id", pid).execute()

    plan = await funding_service.get_latest_plan_for_participant(pid)
    if plan:
        db.table("participants").update({"ndis_plan_id": plan["id"]}).eq("id", pid).execute()
        db.table("ndis_plans").update({"plan_number": f"PLN-{p['ndis_number'][-4:]}-{TODAY.year}"}).eq("id", plan["id"]).execute()
        categories = {c["category_group"]: c for c in await funding_service.list_available_categories(org_id)}
        for group, share in (("core_supports", 0.7), ("capacity_building", 0.25), ("capital_supports", 0.05)):
            category = categories.get(group)
            if category:
                allocated = round(budget * share, 2)
                used = round(allocated * max(0.05, min(0.9, -start / (end - start))), 2)
                try:
                    await funding_service.upsert_plan_budget(plan["id"], category["category"], allocated, group, category["category_name"])
                    db.table("plan_budgets").update({"used_amount": used}).eq("plan_id", plan["id"]).eq("category", category["category"]).execute()
                except Exception as exc:
                    if "category_group" not in str(exc):
                        raise
                    # A database without migration 074 (no category_group
                    # column, e.g. a local practice copy): write what exists.
                    ensure(db, "plan_budgets", {"plan_id": plan["id"], "category": category["category"]}, {
                        "allocated_amount": allocated, "organization_id": org_id, "used_amount": used,
                    })

    ensure(db, "practitioner_allocations", {"patient_id": pid, "user_id": staff[p["worker"]], "organization_id": org_id}, {
        "allocated_role": "support_worker", "is_active": True, "assigned_by": coordinator_id,
    }, fill=False)
    goal_ids = []
    for priority, (name, area, category, description, why) in enumerate(p["goals"], start=1):
        goal_ids.append(ensure(db, "ndis_goals", {"participant_id": pid, "organization_id": org_id, "name": name}, {
            "created_by": coordinator_id, "goal_area": area, "support_category": category, "description": description,
            "why_it_matters": why, "target_date": d(end), "status": "active", "priority": priority,
            "plan_id": plan["id"] if plan else None, "updated_at": iso_now(),
        })["id"])
    for allergen, severity, notes in p["allergies"]:
        ensure(db, "participant_allergies", {"participant_id": pid, "organization_id": org_id, "allergen": allergen}, {"severity": severity, "notes": notes})
    for order, text in enumerate(p["alerts"]):
        ensure(db, "participant_briefing_alerts", {"participant_id": pid, "organization_id": org_id, "alert_text": text}, {"sort_order": order, "is_active": True})
    for m in p["meds"]:
        ensure(db, "medications", {"participant_id": pid, "organization_id": org_id, "name": m["name"]}, {
            "strength": m["strength"], "route": "oral", "dosage": m["dosage"], "frequency_type": "scheduled",
            "scheduled_times": m["times"], "prescriber_name": m["prescriber"], "prescriber_contact": gp_phone,
            "start_date": d(-400), "is_prn": False, "status": "active", "created_by": coordinator_id,
            "updated_by": coordinator_id, "verified_by": coordinator_id, "verified_at": iso_now(),
            "verification_notes": "Checked against the GP's medication list and the pharmacy Webster pack.",
            "is_high_risk": m["high_risk"], "updated_at": iso_now(),
        })
    ensure(db, "participant_safety_protocols", {"participant_id": pid, "organization_id": org_id}, {
        "safety_card_body": f"{p['preferred_name']}: " + " ".join(p["alerts"]),
        "scenarios": [{"title": "Feeling overwhelmed", "response": "Offer a quiet space and a drink of water; follow their lead."}],
        "deescalation_techniques": ["Lower your voice and slow down", "Offer two clear choices", "Give time and space"],
        "physical_safety_notes": [p["sensory"]],
        "escalation_contacts": [{"name": em_name, "relationship": em_rel, "phone": em_phone},
                                {"name": "Harbourside on-call", "relationship": "Coordinator on call", "phone": "(08) 5550 1299"}],
        "content_version": 1, "updated_at": iso_now(), "updated_by": coordinator_id,
    })
    for skill in {s for w in WORKERS if w["key"] == p["worker"] for s in w["skills"][:1]}:
        ensure(db, "participant_required_skills", {"participant_id": pid, "organization_id": org_id, "skill": skill}, {"is_mandatory": False})
    for order, (task, category) in enumerate(p["tasks"]):
        ensure(db, "participant_task_templates", {"participant_id": pid, "organization_id": org_id, "name": task}, {
            "created_by": coordinator_id, "description": task, "evidence_required": "none", "is_mandatory": order == 0,
            "estimated_duration_minutes": 30, "is_custom": True, "is_active": True, "sort_order": order,
            "category": "medication" if "medication" in task.lower() else TASK_CATEGORY.get(category, "other"),
            "priority": "high" if order == 0 else "medium", "status": "active",
            "linked_goal_id": goal_ids[min(order, len(goal_ids) - 1)], "updated_at": iso_now(),
        })

    has_agreement = db.table("service_agreements").select("id").eq("participant_id", pid).execute().data
    if not has_agreement:
        financial_year_start = date(TODAY.year if TODAY.month >= 7 else TODAY.year - 1, 7, 1).isoformat()
        draft = await agreements.create_draft(pid, org_id, coordinator_id, {
            "plan_management_type": management, "start_date": max(d(start), financial_year_start), "end_date": d(end),
            "includes_price_adjustment_clause": True, "cancellation_notice_hours": 48,
            "supports": [{"support_item_code": c, "quantity": q, "frequency": f, "location": loc} for c, q, f, loc in p["supports"]],
        })
        signer = em_name if p["key"] == "ruby" else p["full_name"]
        from backend.scripts.seed_pilot_org import signature_png

        await agreements.sign(
            org_id, draft["id"], coordinator_id,
            provider_name=[s for s in STAFF if s["key"] == p["coordinator"]][0]["full_name"],
            provider_signature_png=signature_png("Harbourside"), participant_name=signer,
            participant_signature_png=signature_png(signer),
        )
    print(f"  participant  {p['full_name']:20s} NDIS {p['ndis_number']}  plan to {d(end)}")
    return pid


def ensure_portal_login(db, org_id: str, spec: dict, participant_id: str) -> None:
    user_id = auth_user(db, spec["email"], spec["full_name"])
    db.table("users").upsert({
        "id": user_id, "email": spec["email"], "role": "participant", "full_name": spec["full_name"],
        "is_active": True, "organization_id": org_id, "onboarding_complete": True, "email_verified": True,
        "profile_completed": True, "phone": next(PHONES), "welcome_seen_at": iso_now(),
    }).execute()
    live = (
        db.table("participant_portal_access").select("id").eq("participant_id", participant_id)
        .ilike("email", spec["email"]).neq("status", "revoked").limit(1).execute().data
    )
    if not live:
        db.table("participant_portal_access").insert({
            "organization_id": org_id, "participant_id": participant_id, "user_id": user_id, "email": spec["email"],
            "full_name": spec["full_name"], "relationship": spec["relationship"], "authority_notes": spec["notes"],
            "status": "active", "granted_at": iso_now(), "accepted_at": iso_now(),
        }).execute()
    print(f"  portal       {spec['full_name']:20s} {spec['email']}  ({spec['relationship']})")


# ── Shifts and notes ──────────────────────────────────────────────────────────

# Each participant's activities. A note uses three, chosen so it doesn't read
# like a copy of the worker's last few notes (the compliance engine's R11
# compares vocabulary with them).
ACTIVITY_LINES = {
    "ethan": [
        "Ethan planned a chicken stir-fry and wrote his own shopping list of six items.",
        "We rehearsed the 9:42 bus to TAFE; Ethan opened the timetable app and tapped his Metrocard without reminders.",
        "Ethan cooked spaghetti bolognese, browning the mince and timing the pasta after one verbal prompt.",
        "At Foodland he located five of six groceries independently and asked a staff member about the missing oregano.",
        "Ethan updated his whiteboard planner for the week and set phone alarms for Tuesday and Thursday classes.",
        "He practised budgeting by comparing unit prices on pasta sauces, choosing the cheaper brand himself.",
        "Ethan washed, dried and put away dishes, then wiped benches using his laminated checklist.",
        "We walked to Norwood Parade so Ethan could post a birthday card to his cousin in Melbourne.",
        "Ethan baked banana muffins from a recipe card, measuring flour and sugar with steady hands.",
        "He rang TAFE student services by phone to ask about his timetable, reading from notes he prepared.",
        "Ethan sorted his laundry into colours, ran the machine and hung everything on the clothes horse.",
        "We reviewed his gym program; Ethan completed twenty minutes on the stationary bike at a comfortable pace.",
    ],
    "ruby": [
        "Ruby followed her picture schedule for snack, homework and play, moving each card across herself.",
        "At art class Ruby wore her headphones for fifteen minutes, then removed them and joined group painting.",
        "Ruby practised turn-taking during Uno, waiting for three turns without any reminder.",
        "We attended library story time; Ruby sat with the group and pointed to the dinosaur pictures.",
        "When a vacuum started next door Ruby used her calm-down card and settled within five minutes.",
        "Ruby completed spelling homework at the kitchen table using a timer broken into two short blocks.",
        "She built a Lego volcano and explained each piece, using four-word sentences.",
        "We practised crossing Brighton Road at the lights, with Ruby pressing the button and waiting for green.",
        "Ruby helped make fruit kebabs for afternoon tea, threading grapes and strawberries carefully.",
        "At the playground Ruby invited another girl onto the swings, a first for her.",
        "Ruby drew a stegosaurus and labelled its plates, then showed her mum when she arrived home.",
        "We read a social story about the dentist ahead of her appointment next Tuesday.",
    ],
    "george": [
        "George checked his blood glucose ({bgl}) and took his 8:00 Metformin and Amlodipine, recording both on his chart.",
        "I supported George's shower using the grab rail and shower chair; he dressed independently except for buttons.",
        "George walked to Café Vida with his quad stick, resting once, and chatted with two friends from church.",
        "George watered tomatoes and basil from his chair while I steadied the hose reel.",
        "We prepared scrambled eggs and toast; George buttered the toast one-handed using his adapted board.",
        "George read the Advertiser aloud on the verandah and talked about the Olympiacos result.",
        "We sorted his Webster pack delivery, and George confirmed each day's doses matched his chart.",
        "George phoned his daughter Eleni to plan Sunday lunch, dialling from his large-button handset.",
        "We completed his range-of-motion exercises from the physio sheet, ten repetitions each side.",
        "George folded towels at the table and put them in the linen press, taking two rests.",
        "We changed his bedsheets together; George tucked the left side himself, which he was pleased about.",
        "George listened to Greek radio while polishing his shoes for church.",
    ],
    "amara": [
        "Completed a ceiling hoist transfer with Amara directing each step; I checked the sling before use.",
        "Amara refined two portfolio pieces in Illustrator and submitted an application for a junior designer role.",
        "We rehearsed the tram trip to the studio; Amara chose the accessible stop and boarded independently.",
        "Amara charged her Tobii device and programmed two new quick phrases for the studio.",
        "We ran a mock interview: Amara answered five questions combining her device and speech.",
        "Amara directed lunch preparation, choosing jollof rice leftovers and telling me how to reheat them.",
        "She emailed the volunteer coordinator to swap Thursday's studio session, composing it via eye gaze.",
        "Amara reviewed a freelance brief for a café menu and sketched three layout ideas.",
        "We visited the Central Market; Amara bought plantain and paid using her card on the reader.",
        "Amara set up her week in Google Calendar and colour-coded design work, appointments and rest.",
        "We practised wheelchair positioning at her desk to reduce shoulder strain during long design sessions.",
        "Amara attended a Fringe venue tour to check access for an upcoming show she wants to see.",
    ],
    "noah": [
        "At the café placement Noah made {coffees} coffees, steaming milk with one reminder about temperature.",
        "Noah wrote his shopping list, found every item and paid at the self-checkout, counting his change.",
        "Noah greeted customers and took three counter orders, reading each back to confirm.",
        "We walked Biscuit before work and Noah planned his week in his phone calendar.",
        "Noah cooked a toasted sandwich for lunch and cleaned the sandwich press without prompting.",
        "He restocked cups, lids and sugar sachets at the café, checking the list taped inside the cupboard.",
        "Noah practised his bus route home from the café and texted his mum when he boarded.",
        "We role-played asking his manager for an extra Friday shift; Noah wrote three points to cover.",
        "Noah washed and sanitised the milk jugs, following the café's four-step cleaning sign.",
        "He calculated his weekly earnings from the placement and set aside money for footy tickets.",
        "Noah tried latte art, pouring a heart on the third attempt, and showed the barista proudly.",
        "We bought a birthday present for his friend Josh within a fifty dollar budget.",
    ],
    "isabella": [
        "Bella and I agreed an energy plan: laundry first, a rest, then setting up her painting area.",
        "I drove Bella to the Henley Beach art group and set up her easel; she painted for ninety minutes.",
        "Bella directed light household tasks: I folded washing and changed the bed while she supervised.",
        "Bella prepped vegetables for paella seated at the bench, pacing herself with two short rests.",
        "We took a short esplanade walk with her walker in the cool morning, Bella setting the pace.",
        "Bella stretched three new canvases, with me holding the frames while she stapled.",
        "We repotted her geraniums on the shaded patio, Bella choosing which pots to keep.",
        "Bella priced six paintings for the Saturday market and wrote the labels herself.",
        "She completed her MS nurse's fatigue diary, rating energy across the morning and afternoon.",
        "We fed Luna and cleaned her litter tray, Bella sitting to scoop while I emptied the bag.",
        "Bella video-called her mother in Spanish while I prepared a cool drink and her afternoon snack.",
        "We sorted brushes and paints into labelled trays so Bella can reach everything from her stool.",
    ],
}

OPENERS = [
    "Arrived {time} and checked in with {n} about the plan for the visit.",
    "Started at {time}; {n} was ready and had chosen today's priorities.",
    "On arrival at {time}, {n} greeted me at the door and we reviewed the whiteboard together.",
    "Shift began {time}. {n} described how the week had gone so far.",
    "Got there at {time} and {n} talked me through what mattered most today.",
    "Began the visit at {time} with a cup of tea while {n} set the agenda.",
]
RESPONSES = [
    "{n} reported feeling confident and demonstrated more independence than last time.",
    "{n} engaged throughout and expressed pride in finishing every step.",
    "{n} reported being happy with the result and demonstrated good problem solving when plans changed.",
    "{n} appeared relaxed, engaged with each task and reported only mild tiredness afterwards.",
    "{n} expressed that choosing the order of tasks made the afternoon easier, and engaged fully.",
    "{n} demonstrated patience during the harder parts and reported enjoying the outcome.",
]
PROGRESS = [
    "fewer prompts than the previous visit",
    "completed independently today",
    "steady progress with verbal prompts only",
    "a new step attempted without support",
]
CLOSINGS = [
    "No incidents. Handover completed with the next support.",
    "No incidents or concerns. Notes discussed with {n} before leaving.",
    "No incidents. Left the home tidy and confirmed the next visit time.",
    "Nothing to escalate. {n} agreed the plan for next time before I left.",
]

_NOTE_HISTORY: dict[str, list[str]] = {}


def _words(text: str) -> set[str]:
    import re

    return set(re.findall(r"\b\w+\b", text.lower()))


def _similarity(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    return len(wa & wb) / len(wa | wb) if wa and wb else 0.0


def note_text(p: dict, day: date, rng: random.Random, start: datetime, hours: int) -> tuple[str, list[str]]:
    """A full progress note. Retries until it differs enough from this
    participant's earlier notes to pass the uniqueness check (R11)."""
    n = p["preferred_name"]
    goals = [g[0] for g in p["goals"]]
    history = _NOTE_HISTORY.setdefault(p["key"], [])
    clock = start.strftime("%I:%M %p").lstrip("0").lower()
    best, best_score = "", 1.0
    for _ in range(150):
        lines = [
            line.format(bgl=f"{rng.uniform(5.4, 7.9):.1f} mmol/L", coffees=rng.randint(6, 14))
            for line in rng.sample(ACTIVITY_LINES[p["key"]], 3)
        ]
        text = " ".join([
            rng.choice(OPENERS).format(time=clock, n=n),
            *lines,
            rng.choice(RESPONSES).format(n=n),
            f"Goal progress on {goals[0].lower()}: {rng.choice(PROGRESS)}. Also worked towards {goals[-1].lower()}.",
            rng.choice(CLOSINGS).format(n=n),
            f"{hours}-hour shift on {day:%A %d %B}.",
        ])
        # Against every earlier note: the engine compares each note with the
        # five most recent, which can be later ones too.
        score = max((_similarity(text, prev) for prev in history), default=0.0)
        if score < best_score:
            best, best_score = text, score
        if score < 0.45:
            break
    history.append(best)
    return best, goals


_NAMES: dict[str, str] = {}


def worker_name(db, user_id: str) -> str:
    if user_id not in _NAMES:
        _NAMES[user_id] = db.table("users").select("full_name").eq("id", user_id).execute().data[0]["full_name"]
    return _NAMES[user_id]


def lines_of(text: str) -> list[str]:
    return [s.strip() for s in text.split(". ") if s.strip()]


def summary_text(p: dict, lines: list[str]) -> str:
    return f"{p['preferred_name']} had a productive shift. " + (lines[1] if len(lines) > 1 else "") + " No incidents."


def progress_of(text: str) -> str:
    import re

    match = re.search(r"Goal progress on [^:]+: ([^.]+)", text)
    return match.group(1) if match else "Steady progress"


def long_shift_fields(clock_in: datetime, clock_out: datetime) -> dict[str, Any]:
    """Shifts of four hours or more get welfare check-ins (compliance R16)."""
    hours = (clock_out - clock_in).total_seconds() / 3600
    if hours < 4:
        return {}
    return {"is_long_shift": True, "checkin_count": int(hours) + 1, "max_gap_secs": 45 * 60}


async def rewrite_notes(db, org_id: str, participants: dict[str, str]) -> None:
    """Regenerate every completed shift's note in date order (--rewrite-notes),
    e.g. after the note generator changes."""
    count = 0
    for p in PARTICIPANTS:
        pid = participants[p["key"]]
        _NOTE_HISTORY.pop(p["key"], None)
        rows = (
            db.table("shifts").select("id, scheduled_start, scheduled_end, session_id, care_coordinator_id")
            .eq("participant_id", pid).eq("status", "completed").order("scheduled_start").execute().data
        )
        for row in rows:
            if not row.get("session_id"):
                continue
            start = datetime.fromisoformat(row["scheduled_start"]).astimezone(TZ)
            end = datetime.fromisoformat(row["scheduled_end"]).astimezone(TZ)
            rng = random.Random(f"{p['key']}{start.date()}-v2")
            text, goals = note_text(p, start.date(), rng, start, int((end - start).total_seconds() // 3600))
            db.table("sessions").update({
                "notes": text, "display_notes": text, "original_language_input": text, "translated_english_note": text,
                "compliance_input_text": text, "legal_record_text": text, "goals_addressed": goals,
                "progress_toward_goals": progress_of(text), "ai_summary": summary_text(p, lines_of(text)),
                "goal_progress_notes": goal_notes(db, pid, p, text), **long_shift_fields(start, end),
            }).eq("id", row["session_id"]).execute()
            db.table("shifts").update({"visit_notes": text}).eq("id", row["id"]).execute()
            count += 1
    print(f"  notes        {count} rewritten")


def goal_notes(db, pid: str, p: dict, text: str) -> list[dict[str, str]]:
    goals = db.table("ndis_goals").select("id, name").eq("participant_id", pid).order("priority").execute().data
    progress = progress_of(text)
    return [
        {"goal_id": g["id"], "goal_title": g["name"], "evidence_provided": lines_of(text)[1] if len(lines_of(text)) > 1 else text,
         "outcome": progress if i == 0 else "Practised during the shift with support.",
         "observation": f"{p['preferred_name']} was engaged and chose how to approach it."}
        for i, g in enumerate(goals)
    ]


def top_up_existing(db, p: dict, pid: str, row: dict, phone: str) -> None:
    """Fields added to the seed after a shift was first written."""
    if row.get("expected_price_item_code"):
        return
    values = shift_values(row["organization_id"], p, pid, row["worker_id"], datetime.fromisoformat(row["scheduled_start"]),
                          datetime.fromisoformat(row["scheduled_end"]), row["status"], row.get("care_coordinator_id"))
    keep = ("expected_price_item_code", "notes", "support_instructions", "participant_phone")
    db.table("shifts").update({k: values[k] for k in keep}).eq("id", row["id"]).execute()
    if row.get("session_id"):
        session = db.table("sessions").select("id, notes, ended_at, goal_progress_notes").eq("id", row["session_id"]).execute().data
        if session and not session[0].get("goal_progress_notes") and session[0].get("notes"):
            text = session[0]["notes"]
            ended = datetime.fromisoformat(session[0]["ended_at"]) if session[0].get("ended_at") else datetime.fromisoformat(row["scheduled_end"])
            db.table("sessions").update({
                "input_language": "en", "original_language": "en", "worker_signature": worker_name(db, row["worker_id"]),
                "ai_summary": summary_text(p, lines_of(text)), "goal_progress_notes": goal_notes(db, pid, p, text),
                "approved_by": row.get("care_coordinator_id"), "approved_at": (ended + timedelta(hours=6)).isoformat(),
            }).eq("id", session[0]["id"]).execute()


def shift_values(org_id: str, p: dict, pid: str, worker_id: str, start: datetime, end: datetime, status: str, coordinator_id: str) -> dict[str, Any]:
    em_name, em_rel, em_phone = p["emergency"]
    return {
        "organization_id": org_id, "participant_id": pid, "worker_id": worker_id, "participant_name": p["full_name"],
        "scheduled_end": end.isoformat(), "duration_minutes": int((end - start).total_seconds() // 60),
        "status": status, "confirmation_status": "confirmed", "duty_type": "disability_services", "is_sleepover": False,
        "support_category": "Core Supports", "participant_dob": p["dob"], "participant_gender": p["sex"],
        "participant_address": p["address"], "participant_latitude": p["lat"], "participant_longitude": p["lng"],
        "participant_phone": PARTICIPANT_PHONES.get(pid),
        "allergies": "; ".join(a for a, _, _ in p["allergies"]) or "None known",
        "health_alerts": "; ".join(p["alerts"]), "health_flags": p["conditions"],
        "access_instructions": "Ring the front doorbell and wait; visitor parking on the street.",
        "entry_instructions": "Knock and say who you are before entering.",
        "coordinator_notes": f"Emergency contact: {em_name} ({em_rel}) {em_phone}.",
        "special_instructions": p["alerts"][0], "active_goals": [g[0] for g in p["goals"]],
        "care_coordinator_id": coordinator_id, "expected_price_item_code": p["supports"][0][0],
        "notes": f"Regular {p['preferred_name']} shift. Focus: {p['goals'][0][0].lower()}.",
        "support_instructions": [
            {"category": "Communication", "body": p["comm"], "critical": "false"},
            {"category": "Routine", "body": p["routine"], "critical": "false"},
            {"category": "Safety", "body": " ".join(p["alerts"]), "critical": "true"},
        ],
    }


PARTICIPANT_PHONES: dict[str, str] = {}


async def seed_shifts(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    for row in db.table("participants").select("id, phone").eq("organization_id", org_id).execute().data:
        PARTICIPANT_PHONES[row["id"]] = row["phone"]
    completed = scheduled = 0
    for p in PARTICIPANTS:
        pid = participants[p["key"]]
        worker_id = staff[p["worker"]]
        coordinator_id = staff[p["coordinator"]]
        for offset in list(range(-21, 0)) + list(range(1, 15)):
            day = TODAY + timedelta(days=offset)
            for weekday, hour, hours in p["pattern"]:
                if day.weekday() != weekday:
                    continue
                start, end = local(day, hour), local(day, hour + hours)
                status = "completed" if offset < 0 else "scheduled"
                existing = find(db, "shifts", {"participant_id": pid, "scheduled_start": start.isoformat()})
                if existing:
                    # A run that stopped part-way can leave a completed shift
                    # without its note; finish it.
                    if existing["status"] == "completed" and not existing.get("session_id"):
                        await complete_shift(db, org_id, p, pid, worker_id, existing, start, end, random.Random(f"{p['key']}{day}"))
                        completed += 1
                    elif existing["status"] == "completed":
                        record_medications(db, org_id, p, pid, worker_id, existing, start, end, random.Random(f"{p['key']}{day}"))
                    top_up_existing(db, p, pid, existing, PARTICIPANT_PHONES.get(pid))
                    continue
                values = shift_values(org_id, p, pid, worker_id, start, end, status, coordinator_id)
                row = db.table("shifts").insert({"scheduled_start": start.isoformat(), **values}).execute().data[0]
                if status == "completed":
                    await complete_shift(db, org_id, p, pid, worker_id, row, start, end, random.Random(f"{p['key']}{day}"))
                    completed += 1
                else:
                    scheduled += 1
    print(f"  shifts       {completed} completed with notes, {scheduled} rostered over the next two weeks")


async def complete_shift(db, org_id: str, p: dict, pid: str, worker_id: str, row: dict, start: datetime, end: datetime, rng: random.Random) -> None:
    clock_in = start + timedelta(minutes=rng.randint(-4, 3))
    clock_out = end + timedelta(minutes=rng.randint(-3, 6))
    tasks = shift_service._resolve_shift_checklist_tasks(row, org_id, prefer_existing_jsonb=False)
    for task in tasks:
        task["completed"] = True
        task["completed_at"] = (start + timedelta(minutes=40)).isoformat()
    text, goals = note_text(p, start.date(), rng, start, int((end - start).total_seconds() // 3600))
    session = db.table("sessions").insert({
        "patient_id": pid, "organization_id": org_id, "worker_id": worker_id, "support_worker_id": worker_id,
        "created_by": worker_id, "owner_user_id": worker_id, "user_id": worker_id, "shift_id": row["id"],
        "session_date": start.date().isoformat(), "duration_minutes": row["duration_minutes"],
        "session_type": "support_work", "status": "completed", "notes": text, "display_notes": text,
        "original_language_input": text, "translated_english_note": text, "compliance_input_text": text, "legal_record_text": text,
        "detected_language": "en", "translation_status": "not_required", "translation_provider": "none",
        "compliance_score": round(rng.uniform(88, 98), 1), "compliance_status": "compliant",
        "compliance_checked_at": end.isoformat(), "compliance_review_required": False, "goals_addressed": goals,
        "support_category": "Core Supports", "activities_performed": "; ".join(t.get("name") or t.get("title") or "" for t in tasks) or "Support work",
        "outcomes": "Session goals met.", "participant_response": f"{p['preferred_name']} engaged well.",
        "progress_toward_goals": progress_of(text),
        "participant_choice_control": f"{p['preferred_name']} chose the order of activities.",
        "start_time": clock_in.isoformat(), "end_time": clock_out.isoformat(), "started_at": clock_in.isoformat(), "ended_at": clock_out.isoformat(),
        "note_completed_at": (clock_out + timedelta(minutes=rng.randint(5, 40))).isoformat(),
        "is_ready_for_billing": True, "export_ready": True, "tasks": tasks, "last_activity_at": clock_out.isoformat(),
        "billable_duration_secs": int((clock_out - clock_in).total_seconds()), "restrictive_practice_detected": False,
        **long_shift_fields(clock_in, clock_out),
        "incident_language_detected": False, "input_language": "en", "original_language": "en",
        "worker_signature": worker_name(db, worker_id), "ai_summary": summary_text(p, lines_of(text)),
        "goal_progress_notes": goal_notes(db, pid, p, text),
        "approved_by": row.get("care_coordinator_id"), "approved_at": (clock_out + timedelta(hours=rng.randint(2, 20))).isoformat(),
    }).execute().data[0]
    db.table("shifts").update({
        "session_id": session["id"], "tasks": tasks, "clocked_in_at": clock_in.isoformat(), "clocked_out_at": clock_out.isoformat(),
        "clock_in_at": clock_in.isoformat(), "clock_out_at": clock_out.isoformat(), "clock_in_method": "gps", "clock_in_verified": True,
        "clock_in_location": {"latitude": p["lat"], "longitude": p["lng"], "accuracy": 12},
        "risks_acknowledged_at": (clock_in - timedelta(minutes=10)).isoformat(), "risks_acknowledged_by": worker_id,
        "visit_notes": text,
    }).eq("id", row["id"]).execute()
    if not find(db, "shift_check_ins", {"shift_id": row["id"]}):
        db.table("shift_check_ins").insert({
            "shift_id": row["id"], "worker_id": worker_id, "organization_id": org_id, "method": "gps",
            "location": {"latitude": p["lat"], "longitude": p["lng"], "accuracy": 12}, "verified": True,
            "verification_distance_meters": round(rng.uniform(3, 40), 1), "client_timestamp": clock_in.isoformat(), "server_timestamp": clock_in.isoformat(),
        }).execute()
    record_medications(db, org_id, p, pid, worker_id, row, start, end, rng)


def record_medications(db, org_id: str, p: dict, pid: str, worker_id: str, row: dict, start: datetime, end: datetime, rng: random.Random) -> None:
    if not p["meds"] or find(db, "medication_administrations", {"shift_id": row["id"]}):
        return
    for m in p["meds"]:
        med = find(db, "medications", {"participant_id": pid, "name": m["name"]})
        for at in m["times"]:
            hour, minute = map(int, at.split(":"))
            due = local(start.date(), hour, minute)
            if not (start <= due <= end):
                continue
            given = due + timedelta(minutes=rng.randint(-5, 10))
            db.table("medication_administrations").insert({
                "medication_id": med["id"], "shift_id": row["id"], "participant_id": pid, "organization_id": org_id,
                "administered_by": worker_id, "scheduled_time": due.isoformat(), "administered_time": given.isoformat(),
                "dose_given": m["dosage"], "notes": "Taken with water; recorded on the chart.", "voice_captured": False,
                "outcome": "given_on_time",
            }).execute()


def finish_demo_shift(db, org_id: str, p: dict, pid: str, row: dict, coordinator_id: str) -> None:
    """Close an earlier demo live shift the way the worker would have: full
    note, tasks done, clocked out at the end time, rated. If the app already
    auto-ended it for running over, also clear the overdue flags and the
    auto-end and documentation alerts it raised."""
    start = datetime.fromisoformat(row["scheduled_start"]).astimezone(TZ)
    end = datetime.fromisoformat(row["scheduled_end"]).astimezone(TZ)
    clock_in = datetime.fromisoformat(row["clocked_in_at"]).astimezone(TZ) if row.get("clocked_in_at") else start
    clock_out = end - timedelta(minutes=4)
    rng = random.Random(row["id"])
    if p["key"] not in _NOTE_HISTORY:
        earlier = (
            db.table("sessions").select("notes").eq("patient_id", pid).eq("compliance_status", "compliant")
            .order("session_date").execute().data
        )
        _NOTE_HISTORY[p["key"]] = [s["notes"] for s in earlier if s.get("notes")]
    tasks = shift_service._resolve_shift_checklist_tasks(row, org_id)
    for task in tasks:
        task["completed"] = True
        task["completed_at"] = task.get("completed_at") or (clock_in + timedelta(minutes=60)).isoformat()
    text, goals = note_text(p, start.date(), rng, start, int((end - start).total_seconds() // 3600))
    note = {
        "status": "completed", "notes": text, "display_notes": text, "original_language_input": text,
        "translated_english_note": text, "compliance_input_text": text, "legal_record_text": text,
        "detected_language": "en", "translation_status": "not_required", "translation_provider": "none",
        "input_language": "en", "original_language": "en", "goals_addressed": goals,
        "support_category": "Core Supports", "activities_performed": "; ".join(t.get("name") or t.get("title") or "" for t in tasks),
        "outcomes": "Session goals met.", "participant_response": f"{p['preferred_name']} engaged well.",
        "progress_toward_goals": progress_of(text), "participant_choice_control": f"{p['preferred_name']} chose the order of activities.",
        "start_time": clock_in.isoformat(), "end_time": clock_out.isoformat(), "started_at": clock_in.isoformat(), "ended_at": clock_out.isoformat(),
        "note_completed_at": (clock_out + timedelta(minutes=12)).isoformat(), "is_ready_for_billing": True, "export_ready": True,
        "tasks": tasks, "last_activity_at": clock_out.isoformat(), "billable_duration_secs": int((clock_out - clock_in).total_seconds()),
        "worker_signature": worker_name(db, row["worker_id"]), "ai_summary": summary_text(p, lines_of(text)),
        "goal_progress_notes": goal_notes(db, pid, p, text), "approved_by": coordinator_id,
        "approved_at": (clock_out + timedelta(hours=1)).isoformat(), "compliance_status": "pending", "ai_insights": {},
        **long_shift_fields(clock_in, clock_out),
    }
    if row.get("session_id"):
        db.table("sessions").update(note).eq("id", row["session_id"]).execute()
    db.table("shifts").update({
        "status": "completed", "clocked_out_at": clock_out.isoformat(), "clock_out_at": clock_out.isoformat(), "tasks": tasks,
        "visit_notes": text, "documentation_pending": False, "documentation_due_at": None, "documentation_escalated_at": None,
    }).eq("id", row["id"]).execute()
    if not find(db, "shift_match_feedback", {"shift_id": row["id"]}):
        db.table("shift_match_feedback").insert({
            "organization_id": org_id, "shift_id": row["id"], "participant_id": pid, "worker_id": row["worker_id"],
            "recorded_by_user_id": coordinator_id, "recorded_at": clock_out.isoformat(), "outcome_rating": 5, "would_repeat": True,
            "participant_response": f"{p['preferred_name']} asked for the same worker next week.",
            "worker_feedback": "Settled routine, clear progress on goals.", "worker_feedback_recorded_at": clock_out.isoformat(),
        }).execute()
    db.table("user_notifications").update({"read_at": iso_now(), "dismissed_at": iso_now()}).eq("shift_id", row["id"]).in_(
        "event_type", ["shift_auto_ended_overdue", "shift_documentation_overdue", "long_shift_checkin"]
    ).execute()
    db.table("alerts").update({"is_read": True}).eq("shift_id", row["id"]).execute()


async def refresh_live_shift(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    """A shift in progress now: Noah with Lachlan, clocked in about 75 minutes
    ago. Earlier demo live shifts that have ended are closed off properly first."""
    p = next(x for x in PARTICIPANTS if x["key"] == "noah")
    pid, worker_id, coordinator_id = participants["noah"], staff["lachlan"], staff["daniel"]
    finished = 0
    for row in db.table("shifts").select("*").eq("participant_id", pid).in_("status", ["in_progress", "completed"]).execute().data:
        session = db.table("sessions").select("compliance_status").eq("id", row["session_id"]).execute().data if row.get("session_id") else []
        ended_live = row["status"] == "in_progress" and datetime.fromisoformat(row["scheduled_end"]) <= NOW
        auto_ended = row["status"] == "completed" and (not session or session[0].get("compliance_status") != "compliant")
        if ended_live or auto_ended:
            finish_demo_shift(db, org_id, p, pid, row, coordinator_id)
            finished += 1
    if finished:
        from backend.scripts.backfill_compliance_rule_results import recheck

        recheck(db, org_id, apply=True)
        print(f"  live shift   {finished} earlier demo shift(s) closed off with a full note")
    live = db.table("shifts").select("*").eq("participant_id", pid).eq("status", "in_progress").execute().data
    if live:
        row = live[0]
        start = datetime.fromisoformat(row["scheduled_start"]).astimezone(TZ)
        end = datetime.fromisoformat(row["scheduled_end"]).astimezone(TZ)
        _start_live_session(db, org_id, pid, worker_id, row["id"])
        print(f"  live shift   already in progress ({start:%H:%M} to {end:%H:%M}); notes started")
        return
    start = NOW.replace(minute=(NOW.minute // 15) * 15, second=0, microsecond=0) - timedelta(minutes=75)
    end = start + timedelta(hours=5)
    clock_in = start + timedelta(minutes=2)
    values = shift_values(org_id, p, pid, worker_id, start, end, "scheduled", coordinator_id)
    row = db.table("shifts").insert({"scheduled_start": start.isoformat(), **values}).execute().data[0]
    tasks = shift_service._resolve_shift_checklist_tasks(row, org_id, prefer_existing_jsonb=False)
    for task in tasks[:1]:
        task["completed"] = True
        task["completed_at"] = (clock_in + timedelta(minutes=35)).isoformat()
    shift_row = db.table("shifts").select("briefing_content_version").eq("id", row["id"]).execute().data[0]
    participant_row = db.table("participants").select("briefing_content_version").eq("id", pid).execute().data[0]
    db.table("shift_briefing_acknowledgements").insert({
        "shift_id": row["id"], "worker_id": worker_id, "organization_id": org_id, "acknowledged_at": (clock_in - timedelta(minutes=8)).isoformat(),
        "patient_briefing_version": participant_row.get("briefing_content_version") or 1,
        "shift_briefing_version": shift_row.get("briefing_content_version") or 1, "scrolled_to_bottom": True,
    }).execute()
    db.table("shifts").update({
        "status": "in_progress", "clocked_in_at": clock_in.isoformat(), "clock_in_at": clock_in.isoformat(),
        "clock_in_method": "gps", "clock_in_verified": True, "clock_in_location": {"latitude": p["lat"], "longitude": p["lng"], "accuracy": 9},
        "risks_acknowledged_at": (clock_in - timedelta(minutes=6)).isoformat(), "risks_acknowledged_by": worker_id, "tasks": tasks,
    }).eq("id", row["id"]).execute()
    db.table("shift_check_ins").insert({
        "shift_id": row["id"], "worker_id": worker_id, "organization_id": org_id, "method": "gps",
        "location": {"latitude": p["lat"], "longitude": p["lng"], "accuracy": 9}, "verified": True,
        "verification_distance_meters": 14.0, "client_timestamp": clock_in.isoformat(), "server_timestamp": clock_in.isoformat(),
    }).execute()
    _start_live_session(db, org_id, pid, worker_id, row["id"])
    print(f"  live shift   Noah Williams with Lachlan Murray, {start:%H:%M} to {end:%H:%M} today, clocked in, first task done")


def _start_live_session(db, org_id: str, pid: str, worker_id: str, shift_id: str) -> None:
    """The worker reads the safety card and starts their notes, as the app
    requires before a shift session can begin."""
    from backend.app.services import safety_protocol_service as safety

    protocol = safety.get_protocol(pid, org_id)
    org_content = safety.get_org_acknowledgement_content(org_id)
    safety.acknowledge_protocol(
        worker_id=worker_id, participant_id=pid, organization_id=org_id, shift_id=shift_id,
        content_version=int(protocol.get("content_version") or 1),
        org_content_version=int(org_content.get("content_version") or 1),
    )
    as_worker = {"id": worker_id, "sub": worker_id, "organization_id": org_id, "role": "support_worker"}
    shift_service.start_shift_session(shift_id, worker_id, org_id, as_worker)


# ── Ready to roster ───────────────────────────────────────────────────────────
# What the roster and its worker suggestions read beyond the profile: an
# onboarding intake that has been made active, matching tags shared with the
# workers, weekly availability, a backup worker, and how past shifts went.

BACKUP_WORKER = {"ethan": "lachlan", "ruby": "fatima", "george": "kwame", "amara": "sofia", "noah": "priya", "isabella": "james"}

TAG_CATEGORIES = {
    "Interests": ("interests", ["AFL", "Cooking", "Art and drawing", "Gardening", "Music", "Swimming", "Gaming", "Coffee and cafés"]),
    "Lived experience": ("lived_experience", ["Acquired brain injury", "Autism", "Stroke and diabetes", "Cerebral palsy", "Down syndrome", "Multiple sclerosis", "Greek-speaking", "Spanish-speaking", "African heritage"]),
}
PARTICIPANT_TAGS = {
    "ethan": ["AFL", "Cooking", "Gaming", "Acquired brain injury"],
    "ruby": ["Art and drawing", "Swimming", "Autism"],
    "george": ["Gardening", "Coffee and cafés", "Music", "Stroke and diabetes", "Greek-speaking"],
    "amara": ["Art and drawing", "Music", "Cerebral palsy", "African heritage"],
    "noah": ["AFL", "Coffee and cafés", "Music", "Down syndrome"],
    "isabella": ["Art and drawing", "Gardening", "Cooking", "Multiple sclerosis", "Spanish-speaking"],
}
WORKER_TAGS = {
    "priya": ["Cooking", "Gaming", "AFL", "Acquired brain injury", "Down syndrome"],
    "james": ["Gardening", "Coffee and cafés", "Cooking", "Stroke and diabetes", "Multiple sclerosis"],
    "fatima": ["Art and drawing", "Music", "Cerebral palsy", "Autism", "African heritage"],
    "lachlan": ["AFL", "Coffee and cafés", "Music", "Down syndrome", "Acquired brain injury"],
    "sofia": ["Art and drawing", "Swimming", "Cooking", "Autism", "Cerebral palsy"],
    "kwame": ["Art and drawing", "Gardening", "Music", "Multiple sclerosis", "Stroke and diabetes", "African heritage"],
}
INTAKE_SOURCE = {"ethan": "coordinator_referral", "ruby": "online_form", "george": "phone_call", "amara": "email", "noah": "coordinator_referral", "isabella": "online_form"}
NEEDS = {
    "ethan": ["Daily living skills", "Community access", "Travel training"],
    "ruby": ["Social participation", "Routine and behaviour support", "Community access"],
    "george": ["Personal care", "Medication prompting", "Community access"],
    "amara": ["Personal care", "Employment support", "Community access"],
    "noah": ["Employment support", "Daily living skills", "Community access"],
    "isabella": ["Fatigue management", "Household tasks", "Community access"],
}


def _address_parts(address: str) -> dict[str, str]:
    street, _, rest = address.rpartition(", ")
    words = rest.split()
    return {"street_address": street, "suburb": " ".join(words[:-2]), "state": words[-2], "postcode": words[-1]}


def seed_intakes(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    from backend.scripts.seed_pilot_org import signature_png

    for p in PARTICIPANTS:
        pid = participants[p["key"]]
        start, end, budget, management = p["plan"]
        coordinator = next(s for s in STAFF if s["key"] == p["coordinator"])
        em_name, em_rel, em_phone = p["emergency"]
        signer = em_name if p["key"] == "ruby" else p["full_name"]
        given, *rest = p["full_name"].split()
        funding = {"plan-managed": "plan_managed", "self-managed": "self_managed", "NDIA-managed": "ndia_managed"}[management]
        plan_manager = {
            "plan_managed": ("Jess Moran", "Plan Partners", "(08) 5550 3300", "accounts@planpartners.example.com"),
            "self_managed": (p["full_name"], "Self-managed", PARTICIPANT_PHONES.get(pid) or em_phone, p["email"]),
            "ndia_managed": ("NDIA", "National Disability Insurance Agency", "1800 800 110", "enquiries@ndis.example.com"),
        }[funding]
        received = TODAY + timedelta(days=start - 30)
        signed = TODAY + timedelta(days=start - 8)
        ensure(db, "participant_intakes", {"organization_id": org_id, "participant_id": pid}, {
            "full_name": p["full_name"], "service_category": "disability",
            "service_hours_required": sum(h for _, _, h in p["pattern"]), "ndis_number": p["ndis_number"],
            "email": p["email"], "phone": PARTICIPANT_PHONES.get(pid) or em_phone, "source": INTAKE_SOURCE[p["key"]],
            "status": "active", "board_subtitle": f"Active since {signed:%d %B %Y}",
            "screening_checks": {"language_support_ok": True, "waitlist_open": True, "resource_match_ok": True,
                                 "environment_safe": True, "no_red_flags": True, "red_flag_notes": "None identified at screening."},
            "meet_greet_notes": (
                f"Met {p['preferred_name']} and {em_name} at home with {coordinator['full_name']}. Talked through goals "
                f"({p['goals'][0][0].lower()}), routines and what a good worker looks like for them. "
                f"Agreed {sum(h for _, _, h in p['pattern'])} hours a week and introduced their main worker."
            ),
            "plan_start_date": d(start), "plan_end_date": d(end), "total_budget": str(budget),
            "service_agreement_document_name": f"Service agreement, {p['full_name']}",
            "provider_signed_name": coordinator["full_name"], "provider_signed_at": local(signed, 10).isoformat(),
            "family_signed_name": signer, "family_signed_at": local(signed, 11).isoformat(),
            "provider_signature_png": signature_png(coordinator["full_name"]), "family_signature_png": signature_png(signer),
            "activated_at": local(signed, 12).isoformat(), "created_by": staff[p["coordinator"]],
            "created_at": local(received, 9).isoformat(),
            "web_intake": {
                "submitted_at": local(received, 9).isoformat(), "submitted_by": signer,
                "given_name": given, "surname": " ".join(rest), "preferred_name": p["preferred_name"],
                "pronouns": "she/her" if p["sex"] == "female" else "he/him", "gender": "Female" if p["sex"] == "female" else "Male",
                "date_of_birth": p["dob"], "preferred_language": "Greek" if p["key"] == "george" else "English",
                **_address_parts(p["address"]), "funding_type": funding, "plan_status": "Active",
                "plan_start": d(start), "plan_end": d(end),
                "plan_manager_name": plan_manager[0], "plan_manager_org": plan_manager[1],
                "plan_manager_phone": plan_manager[2], "plan_manager_email": plan_manager[3],
                "next_of_kin": [{"name": em_name, "relationship": em_rel, "phone": em_phone}],
                "referral_source": {"coordinator_referral": "Support coordinator", "online_form": "Website referral form",
                                    "phone_call": "Phone enquiry", "email": "Email enquiry"}[INTAKE_SOURCE[p["key"]]],
                "referral_date": received.isoformat(), "presenting_needs": NEEDS[p["key"]],
                "notes": p["history"],
            },
        })
    print("  onboarding   6 participants onboarded and active (screened, met, agreement signed)")


def seed_matching(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    tag_ids: dict[str, str] = {}
    for category, (role, labels) in TAG_CATEGORIES.items():
        cat = ensure(db, "tag_categories", {"organization_id": org_id, "name": category}, {"is_active": True, "matching_role": role})
        for label in labels:
            tag_ids[label] = ensure(db, "tags", {"organization_id": org_id, "category_id": cat["id"], "label": label}, {"is_active": True})["id"]
    coordinator = staff["daniel"]
    for key, labels in PARTICIPANT_TAGS.items():
        for label in labels:
            ensure(db, "participant_tags", {"participant_id": participants[key], "tag_id": tag_ids[label]}, {"added_by_user_id": coordinator}, fill=False)
    for key, labels in WORKER_TAGS.items():
        for label in labels:
            ensure(db, "worker_tags", {"worker_id": staff[key], "tag_id": tag_ids[label]},
                   {"added_by_user_id": coordinator, "visible_to_coordinator_only": False}, fill=False)

    for p in PARTICIPANTS:
        backup = staff[BACKUP_WORKER[p["key"]]]
        ensure(db, "practitioner_allocations", {"patient_id": participants[p["key"]], "user_id": backup, "organization_id": org_id}, {
            "allocated_role": "support_worker", "is_active": True, "assigned_by": staff[p["coordinator"]],
        }, fill=False)

    slot_of = lambda hour: "morning" if hour < 12 else ("afternoon" if hour < 17 else "evening")
    for w in WORKERS:
        preferred = {(day + 1, slot_of(hour)) for p in PARTICIPANTS if p["worker"] == w["key"] for day, hour, _ in p["pattern"]}
        working_days = {day for day, _ in preferred} | {
            day + 1 for p in PARTICIPANTS if BACKUP_WORKER[p["key"]] == w["key"] for day, _, _ in p["pattern"]
        }
        for day in range(1, 8):
            for slot in ("morning", "afternoon", "evening"):
                if (day, slot) in preferred:
                    status = "preferred"
                elif day in working_days and slot != "evening":
                    status = "available"
                else:
                    status = "unavailable"
                ensure(db, "worker_weekly_availability_slots", {"user_id": staff[w["key"]], "organization_id": org_id, "day_of_week": day, "time_slot": slot},
                       {"status": status, "updated_at": iso_now()})
        ensure(db, "worker_availability_preferences", {"user_id": staff[w["key"]], "organization_id": org_id}, {
            "max_shifts_per_week": 7 if w["employment"] == "full_time" else 5, "updated_at": iso_now(),
        })

    rated = 0
    for p in PARTICIPANTS:
        rows = db.table("shifts").select("id, worker_id, scheduled_end").eq("participant_id", participants[p["key"]]).eq("status", "completed").execute().data
        for row in rows:
            if find(db, "shift_match_feedback", {"shift_id": row["id"]}):
                continue
            rng = random.Random(row["id"])
            db.table("shift_match_feedback").insert({
                "organization_id": org_id, "shift_id": row["id"], "participant_id": participants[p["key"]], "worker_id": row["worker_id"],
                "recorded_by_user_id": staff[p["coordinator"]], "recorded_at": row["scheduled_end"],
                "outcome_rating": rng.choice([4, 5, 5]), "would_repeat": True,
                "participant_response": rng.choice([f"{p['preferred_name']} looks forward to these visits.", f"{p['preferred_name']} said they work well together.", f"{p['preferred_name']} asked for the same worker next week."]),
                "worker_feedback": rng.choice(["Good rapport; plan is working.", "Settled routine, clear progress on goals.", "Enjoyable shift, no concerns about fit."]),
                "worker_feedback_recorded_at": row["scheduled_end"],
            }).execute()
            rated += 1
    print(f"  matching     interest and lived-experience tags, backup workers, weekly availability, {rated} new shift ratings")


# ── Everything else ───────────────────────────────────────────────────────────

def seed_records(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    def incident(ref: str, **values: Any) -> None:
        if not find(db, "incidents", {"organization_id": org_id, "reference_number": ref}):
            db.table("incidents").insert({"organization_id": org_id, "reference_number": ref, "photo_urls": [], "photo_metadata": {}, "witnesses_structured": [], **values}).execute()

    at = local(TODAY - timedelta(days=16), 8, 40)
    incident(
        f"INC-{at:%Y%m%d}-HB01", participant_id=participants["george"], title="Near fall in the bathroom",
        incident_type="injury", severity="medium", status="closed", incident_date=at.isoformat(),
        reported_date=(at + timedelta(minutes=50)).isoformat(), resolved_date=(at + timedelta(days=4)).isoformat(),
        location="George's bathroom", location_type="private_home", witnesses="None",
        description="George lost balance stepping out of the shower. I steadied him and he sat on the shower chair. He did not fall or hit anything.",
        ndis_reportable=False, participant_present=True, participant_harmed="no",
        participant_impact="No injury. George was shaken but settled after a cup of tea.",
        worker_actions="Steadied George, sat him on the shower chair, checked for injury, called the coordinator.",
        investigation_notes="Shower mat had curled at the edge. OT consulted about a grab rail.",
        corrective_actions="New non-slip mat fitted and a grab rail installed by the OT's handyman on the following Tuesday.",
        follow_up_required=False, created_by=staff["james"], user_id=staff["james"], assigned_investigator_id=staff["daniel"],
        assigned_investigator_at=(at + timedelta(hours=2)).isoformat(), practice_standard="Standard 3.1 - Safe environment",
    )
    at = local(TODAY - timedelta(days=6), 16, 10)
    incident(
        f"INC-{at:%Y%m%d}-HB02", participant_id=participants["ruby"], title="Distress at the shopping centre",
        incident_type="behaviour_of_concern", severity="low", status="resolved", incident_date=at.isoformat(),
        reported_date=(at + timedelta(hours=1)).isoformat(), resolved_date=(at + timedelta(days=2)).isoformat(),
        location="Westfield Marion food court", location_type="community", witnesses="Shopping centre staff member",
        description="A fire alarm test started while Ruby was in the food court. She covered her ears, cried and sat on the floor for about 10 minutes.",
        ndis_reportable=False, participant_present=True, participant_harmed="no",
        participant_impact="Distressed for about 10 minutes, then recovered and asked to go home.",
        worker_actions="Moved Ruby to a quieter corridor, gave her headphones and calm-down card, called her mother on the way home.",
        investigation_notes="Unplanned alarm test. Ruby's headphones were in the car rather than her bag.",
        corrective_actions="Headphones now stay in Ruby's backpack. Added a 'loud surprise' social story to her schedule.",
        follow_up_required=False, created_by=staff["sofia"], user_id=staff["sofia"], assigned_investigator_id=staff["meilin"],
        assigned_investigator_at=(at + timedelta(hours=3)).isoformat(),
    )
    print("  incidents    2 handled and closed, with corrective actions")

    if not find(db, "participant_complaints", {"organization_id": org_id, "participant_id": participants["isabella"]}):
        db.table("participant_complaints").insert({
            "organization_id": org_id, "participant_id": participants["isabella"], "participant_name": "Isabella Garcia",
            "raised_by": "Isabella Garcia (participant)", "subject": "Shift time changed at short notice",
            "description": "My Wednesday shift was moved from 1pm to 3pm with only an hour's notice, so I missed my art group.",
            "status": "resolved", "filed_at": local(TODAY - timedelta(days=12), 11, 0).isoformat(), "created_by": staff["meilin"],
            "responded_at": local(TODAY - timedelta(days=11), 9, 30).isoformat(), "responded_by": staff["meilin"],
            "resolution_notes": "Apologised and explained the cause (worker illness). Bella now gets a call, not just a text, for any change within 24 hours, and Kwame is her backup worker.",
        }).execute()
    print("  complaints   1 resolved within a day")

    for key, meeting_type, ago in (("ethan", "plan_review", 35), ("amara", "check_in", 12), ("ruby", "check_in", 20)):
        pid = participants[key]
        p = next(x for x in PARTICIPANTS if x["key"] == key)
        if find(db, "participant_plan_meetings", {"participant_id": pid, "meeting_date": d(-ago)}):
            continue
        db.table("participant_plan_meetings").insert({
            "participant_id": pid, "organization_id": org_id, "coordinator_id": staff[p["coordinator"]], "meeting_date": d(-ago),
            "meeting_type": meeting_type, "attendees": [p["full_name"], p["emergency"][0], [s for s in STAFF if s["key"] == p["coordinator"]][0]["full_name"]],
            "conversation_notes": f"Reviewed progress on {p['goals'][0][0].lower()}. {p['preferred_name']} shared what's working and what to change.",
            "participant_priorities": p["goals"][0][4], "coordinator_observations": "Steady progress; supports are well matched.",
            "agreed_outcomes": "Keep the current roster; review again in three months.", "suggestions_status": "reviewed",
        }).execute()
    print("  meetings     3 plan meetings recorded")


def seed_invoices(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    prices = {
        row["item_code"]: float(row["price_national"])
        for row in db.table("platform_ndis_price_items").select("item_code, price_national, valid_to")
        .in_("item_code", sorted({c for p in PARTICIPANTS for c, *_ in p["supports"]})).execute().data
        if not row.get("valid_to") or row["valid_to"] >= iso_now()
    }
    count = 0
    for n, p in enumerate(PARTICIPANTS, start=1):
        number = f"{ORG_ABBREV}-INV-{TODAY:%Y%m}-{n:03d}"
        if find(db, "invoices", {"organization_id": org_id, "invoice_number": number}):
            continue
        code = p["supports"][0][0]
        unit = prices.get(code, 70.23)
        hours = sum(h for _, _, h in p["pattern"]) * 2
        total = round(unit * hours, 2)
        paid = n % 2 == 1
        cm_name, _, cm_email = p["case_manager"]
        recipient = "NDIA" if p["plan"][3] == "NDIA-managed" else (p["full_name"] if p["plan"][3] == "self-managed" else "Plan Partners (plan manager)")
        invoice = db.table("invoices").insert({
            "organization_id": org_id, "issued_by": staff["olivia"], "participant_id": participants[p["key"]],
            "invoice_number": number, "recipient_name": recipient, "recipient_email": "accounts@planpartners.example.com" if "Plan" in recipient else p["email"],
            "line_items": [{"price_item_code": code, "description": f"Support work, {hours} hours", "quantity": hours, "unit_price": unit, "total_price": total}],
            "subtotal_cents": int(total * 100), "tax_cents": 0, "total_cents": int(total * 100), "currency": "AUD",
            "status": "paid" if paid else "sent", "due_date": d(14 if not paid else -7), "issued_at": local(TODAY - timedelta(days=21), 9).isoformat(),
            "finalized_at": local(TODAY - timedelta(days=21), 9).isoformat(),
            "paid_at": local(TODAY - timedelta(days=9), 10).isoformat() if paid else None, "payment_date": d(-9) if paid else None,
            "payment_reference": f"EFT-{8000 + n}" if paid else None, "payment_method": "bank_transfer" if paid else None,
            "notes": "Payment terms 14 days. GST-free NDIS supports.",
        }).execute().data[0]
        db.table("invoice_line_items").insert({
            "invoice_id": invoice["id"], "price_item_code": code, "description": f"Support work, {hours} hours",
            "support_category": "Core Supports", "quantity": hours, "unit_price": unit, "total_price": total,
            "day_type": "weekday", "time_type": "daytime",
        }).execute()
        count += 1
    print(f"  invoices     {count} new (half paid, half sent)")


def seed_inbox(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    def note(user: str, ref: str, **values: Any) -> None:
        inbox.create_user_notification(user_id=staff[user], organization_id=org_id, reference_key=f"demo:{ref}", **values)

    upcoming = db.table("shifts").select("id, scheduled_start, participant_name").eq("worker_id", staff["priya"]).eq("status", "scheduled").order("scheduled_start").limit(1).execute().data
    if upcoming:
        note("priya", "reminder", event_type="shift_reminder", title="Shift tomorrow with Ethan", body="Ethan Clarke at 9:00 am, 14 Wattle Street, Norwood.", severity="low", shift_id=upcoming[0]["id"])
    note("priya", "training", event_type="training_recommended", title="New training assigned", body="Positive behaviour support basics. About 45 minutes; due within 30 days.", severity="medium")
    note("daniel", "training-request", event_type="training_request", title="Training request", body="Lachlan Murray asked for: Epilepsy awareness. Reason: new participant referral mentions seizures.", severity="medium", payload={"worker_id": staff["lachlan"]})
    note("daniel", "on-shift", event_type="coordinator_message", title="Message from Lachlan Murray on shift", body="Noah did really well at the café today. Manager asked if he can do an extra Friday shift. Okay to discuss with Kate?", severity="medium", payload={"worker_id": staff["lachlan"]})
    note("meilin", "review", event_type="ndis_screening_recheck_due", title="NDIS Worker Screening recheck coming up", body="Sofia Rossi's NDIS Worker Screening Check renews in 60 days. Confirm her status on the NDIS Commission portal.", severity="low", payload={"worker_id": staff["sofia"]})
    note("olivia", "plan-end", event_type="coordinator_message", title="Plan review due for George Papadopoulos", body="George's NDIS plan ends in 65 days. Daniel has booked the plan review meeting with his daughter Eleni.", severity="medium")
    print("  inbox        a few notifications for workers, coordinators and the director")


def seed_conversation(db, org_id: str, staff: dict[str, str], participants: dict[str, str]) -> None:
    shift = db.table("shifts").select("id").eq("participant_id", participants["george"]).eq("status", "completed").order("scheduled_start", desc=True).limit(1).execute().data
    if not shift or find(db, "conversations", {"shift_id": shift[0]["id"], "worker_id": staff["james"]}):
        return
    convo = db.table("conversations").insert({
        "organization_id": org_id, "worker_id": staff["james"], "coordinator_id": staff["daniel"], "shift_id": shift[0]["id"],
        "participant_id": participants["george"], "participant_name": "George Papadopoulos", "status": "active", "last_message_at": iso_now(),
    }).execute().data[0]
    base = NOW - timedelta(days=1, hours=2)
    for i, (sender, body) in enumerate((
        ("daniel", "Morning James, George's daughter says the new grab rail is in. Can you check it's firm before his shower?"),
        ("james", "Checked it, solid as a rock. George used it today and said it makes a big difference."),
        ("daniel", "Great, thanks. I'll let Eleni know."),
    )):
        db.table("conversation_messages").insert({
            "conversation_id": convo["id"], "sender_id": staff[sender], "body": body, "message_type": "text", "requires_action": False,
            "delivered_at": (base + timedelta(minutes=i * 7)).isoformat(), "read_at": (base + timedelta(minutes=i * 7 + 2)).isoformat(),
            "created_at": (base + timedelta(minutes=i * 7)).isoformat(),
        }).execute()
    print("  messages     1 shift conversation between James and Daniel")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> None:
    if len(PASSWORD) < 10:
        sys.exit("Set CLIENT_DEMO_PASSWORD (10+ characters, an uppercase letter and a number) for the demo logins.")
    db = get_supabase_admin()
    org_id = ensure_org(db)
    branch_id = head_office(db, org_id)

    print("Staff (all use the CLIENT_DEMO_PASSWORD password):")
    staff: dict[str, str] = {}
    for i, spec in enumerate(STAFF):
        staff[spec["key"]] = await ensure_staff(db, org_id, branch_id, spec, i, staff)
    db.table("organizations").update({"owner_user_id": staff["olivia"], "user_id": staff["olivia"]}).eq("organization_id", org_id).execute()
    for i, spec in enumerate(WORKERS, start=len(STAFF)):
        staff[spec["key"]] = await ensure_staff(db, org_id, branch_id, spec, i, staff)

    participants: dict[str, str] = {}
    if "--refresh-live" not in sys.argv:
        library = await seed_org_library(db, org_id, staff["olivia"])
        for spec in WORKERS:
            seed_worker_details(db, org_id, staff[spec["key"]], spec, staff[spec["coordinator"]])
            seed_worker_compliance(db, org_id, staff[spec["key"]], library, staff[spec["coordinator"]])
        print("  workers      credentials (verified, with certificates), bank and super, availability, skills, training, induction, policies")
        print("Participants:")
        for p in PARTICIPANTS:
            participants[p["key"]] = await ensure_participant(db, org_id, p, staff)
        for login in PORTAL_LOGINS:
            ensure_portal_login(db, org_id, login, participants[login["participant"]])
        print("Activity:")
        await seed_shifts(db, org_id, staff, participants)
        seed_intakes(db, org_id, staff, participants)
        seed_matching(db, org_id, staff, participants)
        seed_records(db, org_id, staff, participants)
        seed_invoices(db, org_id, staff, participants)
        seed_conversation(db, org_id, staff, participants)
        if not find(db, "user_notifications", {"user_id": staff["daniel"], "reference_key": "demo:on-shift"}):
            seed_inbox(db, org_id, staff, participants)
    else:
        participants = {
            p["key"]: find(db, "participants", {"organization_id": org_id, "ndis_number": p["ndis_number"]})["id"]
            for p in PARTICIPANTS
        }
    if "--rewrite-notes" in sys.argv:
        await rewrite_notes(db, org_id, participants)
    await refresh_live_shift(db, org_id, staff, participants)
    print(f"Done. Organisation id {org_id}")


if __name__ == "__main__":
    asyncio.run(main())
