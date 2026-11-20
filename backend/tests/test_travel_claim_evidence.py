"""Travel claims carry their evidence: a car trip that differs from the
route estimate says where the worker went, and a fare over $10 has a
receipt. Drafts can be saved unfinished; the check is at submission."""
from backend.app.services import travel_expense_service as svc


def test_a_car_trip_close_to_the_route_needs_no_explanation():
    assert not svc.mileage_needs_explanation(10.5, 10.0)
    assert not svc.mileage_needs_explanation(10.8, 10.0)  # within 1 km


def test_a_car_trip_far_from_the_route_or_without_one_needs_an_explanation():
    assert svc.mileage_needs_explanation(14.0, 10.0)
    assert svc.mileage_needs_explanation(8.0, None)


def test_submission_names_what_each_claim_still_needs():
    long_trip = {"expense_type": "mileage", "claimed_km": 30, "calculated_km": 12, "trip_details": ""}
    assert "where you drove" in svc.missing_evidence(long_trip)
    long_trip["trip_details"] = "Took Liam to the library, then home via the pharmacy."
    assert svc.missing_evidence(long_trip) is None

    fare = {"expense_type": "transit", "amount_cents": 1450, "receipt_storage_path": None}
    assert "receipt" in svc.missing_evidence(fare)
    fare["receipt_storage_path"] = "org/w/s/receipt.jpg"
    assert svc.missing_evidence(fare) is None
    assert svc.missing_evidence({"expense_type": "transit", "amount_cents": 450}) is None


def test_before_the_migration_a_trip_is_not_blocked_for_lack_of_a_column():
    # trip_details absent from the row: migration 266 isn't applied yet.
    assert svc.missing_evidence({"expense_type": "mileage", "claimed_km": 30, "calculated_km": 12}) is None
