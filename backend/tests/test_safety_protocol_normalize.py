from backend.app.services.safety_protocol_service import _normalize_protocol

WELL_FORMED = {
    "safety_card_body": "Heat-sensitive.",
    "scenarios": [{"trigger": "Feeling overwhelmed", "response": "Offer a quiet space.", "sort_order": 0}],
    "deescalation_techniques": [{"title": "Slow down", "steps": ["Lower your voice"], "sort_order": 0}],
    "physical_safety_notes": [{"note": "Uses a walker outdoors.", "sort_order": 0}],
    "escalation_contacts": [{"role": "on_call", "label": "On-call coordinator", "phone": "08 5550 1299", "sort_order": 0}],
}


def test_well_formed_protocol_is_unchanged():
    assert _normalize_protocol(WELL_FORMED) == WELL_FORMED


def test_rows_written_in_the_old_seed_shape_become_renderable():
    # The shapes seed_client_demo wrote straight to the table, which crashed
    # the worker app's safety card (tech.steps.map, contact.role.replace).
    row = _normalize_protocol({
        "scenarios": [{"title": "Feeling overwhelmed", "response": "Offer a quiet space."}],
        "deescalation_techniques": ["Lower your voice and slow down", "  "],
        "physical_safety_notes": ["Uses a walker outdoors."],
        "escalation_contacts": [
            {"name": "Daniela Ruiz", "relationship": "Partner", "phone": "0491 571 804"},
            {"name": "Harbourside on-call", "relationship": "Coordinator on call", "phone": "(08) 5550 1299"},
            {"name": "No phone", "relationship": "Friend"},
        ],
    })
    assert row["scenarios"][0]["trigger"] == "Feeling overwhelmed"
    assert row["deescalation_techniques"] == [{"title": "Lower your voice and slow down", "steps": []}]
    assert row["physical_safety_notes"] == [{"note": "Uses a walker outdoors."}]
    assert [(c["role"], c["label"], c["phone"]) for c in row["escalation_contacts"]] == [
        ("emergency", "Daniela Ruiz (Partner)", "0491 571 804"),
        ("on_call", "Harbourside on-call (Coordinator on call)", "(08) 5550 1299"),
    ]


def test_unusable_items_are_dropped_not_crashed_on():
    row = _normalize_protocol({
        "scenarios": [None, 3, {"response": ""}],
        "deescalation_techniques": [None, {"title": "", "steps": [None, ""]}],
        "physical_safety_notes": [{}, 5],
        "escalation_contacts": ["0400 000 000", {"phone": "  "}],
    })
    assert row["scenarios"] == []
    assert row["deescalation_techniques"] == []
    assert row["physical_safety_notes"] == []
    assert row["escalation_contacts"] == []
