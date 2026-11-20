"""The server's note rules give the results in the shared fixture that the
worker app's offline copy is also tested against (lib/worker-compliance/
fixtures/rule-parity.json), so the two can't drift apart."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.app.services import compliance_engine, note_guidance_service as guide

FIXTURE = Path(__file__).resolve().parents[2] / "lib" / "worker-compliance" / "fixtures" / "rule-parity.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["text"][:40] for c in CASES])
def test_server_rules_match_the_fixture(case):
    with patch.object(compliance_engine, "load_rule_configs", return_value={}):
        result = guide.check_draft(case["text"], participant_name="Sam")
    statuses = {r["rule"]: r["status"] for r in result["rules"]}
    for rule, expected in case["expect"].items():
        assert statuses.get(rule, "pass") == expected, (rule, statuses)
