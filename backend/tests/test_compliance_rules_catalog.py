"""Tests for the 12-rule explanation catalog."""
import unittest

from backend.app.services.compliance_rules_catalog import (
    RULE_ORDER,
    enrich_rule_results,
    get_rules_catalog,
)


class TestComplianceRulesCatalog(unittest.TestCase):
    def test_catalog_has_all_twelve_rules(self):
        catalog = get_rules_catalog()
        self.assertEqual(len(catalog), 12)
        self.assertEqual([row["rule"] for row in catalog], RULE_ORDER)

    def test_each_rule_has_label_and_explanation(self):
        for row in get_rules_catalog():
            self.assertTrue(row["label"])
            self.assertTrue(row["explanation"])

    def test_enrich_fills_missing_rules_as_pending(self):
        enriched = enrich_rule_results([
            {"rule": "R1", "label": "Session time and duration", "status": "pass", "message": "OK"},
        ])
        self.assertEqual(len(enriched), 12)
        self.assertEqual(enriched[0]["status"], "pass")
        self.assertEqual(enriched[1]["status"], "pending")
        self.assertTrue(enriched[1]["explanation"])


if __name__ == "__main__":
    unittest.main()
