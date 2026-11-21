"""Labels: the office's own words for finding people, shared by participants
and staff, never made twice (matched by their words, ignoring case)."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from backend.app.services import tag_service as ts

ORG = "org-1"


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.body = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, k, v):
        self.filters.append(lambda r: str(r.get(k)) == str(v) if not isinstance(v, bool) else r.get(k) is v)
        return self

    def in_(self, k, vs):
        vs = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(k)) in vs)
        return self

    def order(self, *_a, **_k):
        return self

    def update(self, body):
        self.op, self.body = "update", body
        return self

    def upsert(self, body, on_conflict=None):
        self.op, self.body, self.keys = "upsert", body, (on_conflict or "").split(",")
        return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.op == "upsert":
            hit = next((r for r in rows if all(r.get(k) == self.body.get(k) for k in self.keys)), None)
            if hit:
                hit.update(self.body)
            else:
                hit = {"id": f"{self.table}-{len(rows) + 1}", **self.body}
                rows.append(hit)
            return type("R", (), {"data": [hit]})()
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in match:
                r.update(self.body)
        return type("R", (), {"data": match})()


class _DB:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Q(self.tables, name)


@pytest.fixture
def db():
    tables = {
        "tag_categories": [
            {"id": "c-life", "organization_id": ORG, "name": "Lived experience", "is_active": True},
            {"id": "c-old", "organization_id": ORG, "name": "Old", "is_active": False},
        ],
        "tags": [
            {"id": "t-autism", "organization_id": ORG, "category_id": "c-life", "label": "Autism", "is_active": True},
            {"id": "t-old", "organization_id": ORG, "category_id": "c-old", "label": "Hills", "is_active": True},
            {"id": "t-other-org", "organization_id": "org-2", "category_id": "c-x", "label": "Dog lover", "is_active": True},
        ],
        "participant_tags": [{"participant_id": "p-1", "tag_id": "t-autism"}, {"participant_id": "p-2", "tag_id": "t-autism"}],
        "worker_tags": [{"worker_id": "w-1", "tag_id": "t-autism"}],
    }
    d = _DB(tables)
    with patch.object(ts, "get_supabase_admin", return_value=d):
        yield tables


def test_the_same_words_reuse_the_existing_label(db):
    assert ts.find_or_create_label(ORG, "  autism ")["id"] == "t-autism"
    assert ts.find_or_create_label(ORG, "AUTISM")["id"] == "t-autism"
    assert len(db["tags"]) == 3


def test_a_new_label_goes_in_the_labels_category(db):
    tag = ts.find_or_create_label(ORG, "Female   worker only")
    assert tag["label"] == "Female worker only"
    category = next(c for c in db["tag_categories"] if c["id"] == tag["category_id"])
    assert category["name"] == "Labels" and category["organization_id"] == ORG


def test_a_label_only_in_a_switched_off_category_or_another_org_is_not_reused(db):
    assert ts.find_or_create_label(ORG, "Hills")["id"] != "t-old"
    assert ts.find_or_create_label(ORG, "Dog lover")["id"] != "t-other-org"


def test_a_switched_off_label_comes_back_instead_of_a_copy(db):
    db["tags"][0]["is_active"] = False
    tag = ts.find_or_create_label(ORG, "Autism")
    assert tag["id"] == "t-autism" and db["tags"][0]["is_active"] is True


def test_an_empty_label_is_refused(db):
    with pytest.raises(ValueError):
        ts.find_or_create_label(ORG, "   ")


def test_the_overview_counts_who_has_each_label(db):
    out = ts.label_overview(ORG)
    assert [l["label"] for l in out["labels"]] == ["Autism"]  # Hills is in a switched-off category
    assert out["labels"][0]["participants"] == 2 and out["labels"][0]["workers"] == 1
    assert out["participants"] == {"p-1": ["t-autism"], "p-2": ["t-autism"]}
    assert out["workers"] == {"w-1": ["t-autism"]}
