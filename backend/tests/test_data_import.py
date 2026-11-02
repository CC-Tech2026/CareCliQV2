from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import data_import_service as svc


def test_dates_are_read_day_first_like_australian_exports():
    assert svc.parse_date("12/03/1985") == date(1985, 3, 12)
    assert svc.parse_date("1985-03-12") == date(1985, 3, 12)
    assert svc.parse_date("12 Mar 1985") == date(1985, 3, 12)
    assert svc.parse_date("12/03/1985 0:00") == date(1985, 3, 12)
    assert svc.parse_date("31118") == date(1985, 3, 12)  # Excel serial
    assert svc.parse_date("not a date") is None
    assert svc.parse_date("") is None


def test_two_digit_birth_years_never_land_in_the_future():
    assert svc.parse_date("12/03/85", birth=True) == date(1985, 3, 12)
    assert svc.parse_date("12/03/68", birth=True).year == 1968


def test_money_and_plan_management():
    assert svc.parse_money("$85,000.50") == 85000.5
    assert svc.parse_money("AUD 1200") == 1200
    assert svc.parse_money("lots") is None
    assert svc.parse_plan_management("Plan Managed") == "plan-managed"
    assert svc.parse_plan_management("Self-managed") == "self-managed"
    assert svc.parse_plan_management("NDIA Managed") == "NDIA-managed"
    assert svc.parse_plan_management("Agency") == "NDIA-managed"
    assert svc.parse_plan_management("mixed") is None


def test_roles():
    assert svc.parse_role("Support Worker") == "support_worker"
    assert svc.parse_role("Disability Support Worker") == "support_worker"
    assert svc.parse_role("Team Leader") == "support_coordinator"
    assert svc.parse_role("Rostering Coordinator") == "support_coordinator"
    assert svc.parse_role("") == "support_worker"
    assert svc.parse_role("Chef") is None


def test_parse_csv_suggests_columns_and_reads_semicolons_and_bom():
    raw = "﻿Client Name;NDIS No.;DOB;Mobile;Plan Start;Plan End;Funding\nMia Thompson;430 123 456;12/03/1985;0412 345 678;1/07/2026;30/06/2027;$85,000\n".encode("utf-8")
    parsed = svc.parse_csv(raw, "participants")
    assert parsed["headers"][0] == "Client Name"
    m = parsed["suggested_mapping"]
    assert m["full_name"] == "Client Name" and m["ndis_number"] == "NDIS No." and m["date_of_birth"] == "DOB"
    assert m["phone"] == "Mobile" and m["plan_start_date"] == "Plan Start" and m["total_budget"] == "Funding"
    assert parsed["rows"] == [["Mia Thompson", "430 123 456", "12/03/1985", "0412 345 678", "1/07/2026", "30/06/2027", "$85,000"]]


def test_parse_csv_prefers_first_and_last_only_without_a_full_name_column():
    m = svc.parse_csv(b"First Name,Surname,Email\nAva,Lee,ava@example.com\n", "staff")["suggested_mapping"]
    assert m["first_name"] == "First Name" and m["last_name"] == "Surname" and m["full_name"] is None


def test_parse_csv_rejects_excel_workbooks_with_a_clear_next_step():
    with pytest.raises(ValueError, match="Save As, CSV"):
        svc.parse_csv(b"PK\x03\x04rest-of-zip", "participants")


def _db(participants=(), intakes=()):
    db = MagicMock()

    def table(name):
        t = MagicMock()
        data = {"participants": list(participants), "participant_intakes": list(intakes)}.get(name, [])
        t.select.return_value.eq.return_value.execute.return_value.data = data
        return t

    db.table.side_effect = table
    return db


ROW = {"first_name": "Mia", "last_name": "Thompson", "ndis_number": "430 123 456", "date_of_birth": "12/03/1985",
       "plan_start_date": "01/07/2026", "plan_end_date": "30/06/2027", "total_budget": "$85,000",
       "plan_management_type": "Plan managed", "email": "mia@example"}


def test_preview_validates_and_flags_duplicates():
    rows = [
        ROW,
        {**ROW, "first_name": "Copy"},
        {"full_name": "Jack Nguyen", "ndis_number": "12345", "date_of_birth": "31/02/1990"},
        {"full_name": "Olivia Brown", "ndis_number": "430999999", "date_of_birth": "01/01/1990"},
    ]
    with patch.object(svc, "get_supabase_admin", return_value=_db(intakes=[{"ndis_number": "430999999", "status": "enquiry"}])):
        results = svc.preview_participants("org-1", rows)
    first, copy, bad, onboarding = results
    assert first["status"] == "ready"
    assert first["record"]["full_name"] == "Mia Thompson" and first["record"]["ndis_number"] == "430123456"
    assert first["record"]["date_of_birth"] == "1985-03-12" and first["record"]["total_budget"] == 85000
    assert first["record"]["plan_management_type"] == "plan-managed"
    assert first["record"]["email"] is None and any("valid email" in w for w in first["warnings"])
    assert copy["status"] == "duplicate" and "earlier in this file" in copy["errors"][0]
    assert bad["status"] == "error" and any("9 digits" in e for e in bad["errors"])
    assert any("date of birth" in e for e in bad["errors"])
    assert onboarding["status"] == "duplicate" and "onboarding board" in onboarding["errors"][0]


def test_import_writes_only_ready_rows_as_imported_enquiries():
    db = _db(participants=[{"ndis_number": "430999999"}])
    rows = [ROW, {"full_name": "Already Here", "ndis_number": "430999999", "date_of_birth": "01/01/1990"}]
    with patch.object(svc, "get_supabase_admin", return_value=db):
        result = svc.import_participants("org-1", "user-1", rows, "shiftcare")
    assert result["imported"] == 1 and result["skipped"] == 1
    assert result["results"][1]["errors"] == ["Already a participant in CareCliQ."]


def test_import_row_shape():
    captured = {}
    db = _db()
    real_side_effect = db.table.side_effect

    def table(name):
        t = real_side_effect(name)
        if name == "participant_intakes":
            def insert(rows):
                captured["rows"] = rows
                return MagicMock()
            t.insert.side_effect = insert
        return t

    db.table.side_effect = table
    with patch.object(svc, "get_supabase_admin", return_value=db):
        svc.import_participants("org-1", "user-1", [ROW], "shiftcare")
    row = captured["rows"][0]
    assert row["status"] == "enquiry" and row["source"] == "import"
    assert row["web_intake"]["date_of_birth"] == "1985-03-12"
    assert row["web_intake"]["imported"]["source_system"] == "shiftcare"
    assert row["web_intake"]["imported"]["plan_management_type"] == "plan-managed"
    assert row["total_budget"] == "85000.00" and row["plan_start_date"] == "2026-07-01"


def test_staff_preview_flags_team_members_and_pending_invites():
    with patch.object(svc, "_existing_staff_emails", return_value=({"sam@example.com"}, {"pat@example.com"})), \
         patch.object(svc, "get_supabase_admin"):
        results = svc.preview_staff("org-1", [
            {"full_name": "Ava Lee", "email": "Ava@Example.com", "role": "Team Leader"},
            {"full_name": "Sam", "email": "sam@example.com"},
            {"full_name": "Pat", "email": "pat@example.com"},
            {"full_name": "No Email"},
            {"full_name": "Chef", "email": "chef@example.com", "role": "Chef"},
        ])
    ava, sam, pat, missing, chef = results
    assert ava["status"] == "ready" and ava["record"] == {"full_name": "Ava Lee", "email": "ava@example.com", "role": "support_coordinator"}
    assert sam["status"] == "duplicate" and pat["status"] == "duplicate"
    assert missing["status"] == "error"
    assert chef["status"] == "ready" and chef["record"]["role"] == "support_worker" and chef["warnings"]


def test_import_falls_back_until_migration_244_is_applied():
    attempts = []
    db = _db()
    real_side_effect = db.table.side_effect

    def table(name):
        t = real_side_effect(name)
        if name == "participant_intakes":
            def insert(rows):
                attempts.append([r["source"] for r in rows])
                q = MagicMock()
                if len(attempts) == 1:
                    q.execute.side_effect = Exception('violates check constraint "participant_intakes_source_check"')
                return q
            t.insert.side_effect = insert
        return t

    db.table.side_effect = table
    with patch.object(svc, "get_supabase_admin", return_value=db):
        result = svc.import_participants("org-1", "user-1", [ROW], "spreadsheet")
    assert attempts == [["import"], ["coordinator_referral"]]
    assert result["imported"] == 1
