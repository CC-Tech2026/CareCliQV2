from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import ndia_claim_service as svc

USER = {"id": "u-1", "sub": "u-1", "organization_id": "org-1", "role": "managing_director"}
HEADER = (
    "RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,"
    "Quantity,Hours,UnitPrice,GSTCode,Payment Request Number,Payment Request Status,Error Message,Paid Total Amount\n"
)


def test_outcomes_are_read_by_column_name_not_position():
    content = "﻿" + HEADER + (
        "4050000000,430000001,2026-10-04,2026-10-04,04_104_0125_6_1,CS-1,,03:00,73.58,P2,PR-901,SUCCESSFUL,,220.74\n"
        "4050000000,430000002,2026-10-05,2026-10-05,04_104_0125_6_1,CS-2-1,,02:00,73.58,P2,,ERROR,Plan budget exceeded,0\n"
        "4050000000,430000002,2026-10-06,2026-10-06,04_104_0125_6_1,CS-2-2,,02:00,73.58,P2,,Pending,,\n"
    )
    lines = svc.parse_results_file(content)
    assert [(line["reference"], line["outcome"]) for line in lines] == [
        ("CS-1", "paid"), ("CS-2-1", "rejected"), ("CS-2-2", "pending"),
    ]
    assert lines[0]["payment_reference"] == "PR-901"
    assert lines[1]["message"] == "Plan budget exceeded"


def test_a_file_without_claim_references_is_refused():
    with pytest.raises(HTTPException) as exc:
        svc.parse_results_file("Name,Amount\nLiam,10\n")
    assert exc.value.status_code == 422


def _claimed(number: str, lines: int) -> dict:
    return {
        "id": f"id-{number}", "invoice_number": number, "participant_id": "p-1", "billing_period_id": None,
        "recipient_name": "NDIA", "total_cents": 10000, "status": "sent", "claim_batch_id": "b-1",
        "line_items": [
            {"item_code": "04_104_0125_6_1", "quantity": 1, "unit": "H", "unit_amount_cents": 5000,
             "service_date_from": "2026-10-04", "service_date_to": "2026-10-04"}
            for _ in range(lines)
        ],
    }


@pytest.mark.parametrize("apply", [False, True])
@pytest.mark.asyncio
async def test_results_mark_paid_claims_paid_and_return_rejected_ones(apply):
    claimed = [_claimed("CS-1", 1), _claimed("CS-2", 2), _claimed("CS-3", 2)]
    content = HEADER + (
        ",,,,,CS-1,,,,,PR-901,SUCCESSFUL,,100.00\n"
        ",,,,,CS-2-1,,,,,PR-901,SUCCESSFUL,,50.00\n"
        ",,,,,CS-2-2,,,,,,ERROR,Participant plan ended,\n"
        ",,,,,CS-3-1,,,,,PR-901,SUCCESSFUL,,50.00\n"
        ",,,,,OTHER-9,,,,,,SUCCESSFUL,,10.00\n"
    )
    with patch("backend.app.services.billing_service._fetch_all", return_value=claimed), \
         patch.object(svc, "_periods", return_value={}), \
         patch.object(svc, "_participants", return_value={"p-1": {"full_name": "Liam Carter"}}), \
         patch.object(svc, "get_supabase_admin"), \
         patch.object(svc, "mark_paid", new=AsyncMock()) as mark_paid, \
         patch.object(svc, "return_to_ready", new=AsyncMock()) as returned:
        result = await svc.reconcile_results(USER, content, apply=apply)

    outcomes = {row["invoice_number"]: row["outcome"] for row in result["matched"]}
    # CS-3 has only one of its two lines in the file, so it isn't settled yet.
    assert outcomes == {"CS-1": "paid", "CS-2": "rejected", "CS-3": "pending"}
    assert result["unmatched_references"] == ["OTHER-9"]
    if apply:
        mark_paid.assert_awaited_once_with(USER, ["id-CS-1"], None, "PR-901")
        returned.assert_awaited_once_with(USER, "id-CS-2", "NDIA: Participant plan ended")
    else:
        mark_paid.assert_not_awaited()
        returned.assert_not_awaited()
