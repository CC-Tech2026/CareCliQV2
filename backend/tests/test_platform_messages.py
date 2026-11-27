"""Admin portal messages, site banners and the news opt-out."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import admin_messages as api
from backend.app.services import platform_messages_service as pm

ADMIN = {"id": "admin-1", "role": "super_admin", "email": "admin@carecliq.example", "full_name": "Ada Admin"}
MD = {"id": "md-1", "role": "managing_director", "organization_id": "org-1"}

ORGS = [
    {"organization_id": "org-1", "organization_name": "Care Plus", "status": "active"},
    {"organization_id": "org-2", "organization_name": "Sunrise", "status": "active"},
    {"organization_id": "org-3", "organization_name": "Gone", "status": "suspended"},
]
USERS = [
    {"id": "u1", "email": "Dir@CarePlus.example", "full_name": "Dana Director", "role": "managing_director", "organization_id": "org-1", "is_active": True},
    {"id": "u2", "email": "coord@careplus.example", "full_name": "Cam Coord", "role": "support_coordinator", "organization_id": "org-1", "is_active": True},
    {"id": "u3", "email": "worker@careplus.example", "full_name": "Wes", "role": "support_worker", "organization_id": "org-1", "is_active": False},
    {"id": "u4", "email": "client@example.com", "full_name": "Pat Client", "role": "participant", "organization_id": "org-1", "is_active": True},
    {"id": "u5", "email": "dir@sunrise.example", "full_name": "Sam", "role": "managing_director", "organization_id": "org-2", "is_active": True, "product_news_opt_out": True},
    {"id": "u6", "email": "dir@gone.example", "full_name": "Gil", "role": "managing_director", "organization_id": "org-3", "is_active": True},
]


def _db():
    db = MagicMock()

    def table(name):
        t = MagicMock()
        if name == "organizations":
            t.select.return_value.execute.return_value.data = ORGS
        elif name == "users":
            def in_(_col, ids):
                q = MagicMock()
                q.execute.return_value.data = [u for u in USERS if u["organization_id"] in ids]
                return q
            t.select.return_value.in_.side_effect = in_
        return t

    db.table.side_effect = table
    return db


def _resolve(audience):
    with patch.object(pm, "get_supabase_admin", return_value=_db()):
        return pm.resolve_audience(audience)


# -- Audience ------------------------------------------------------------------

def test_default_audience_is_active_directors_only():
    r = _resolve({"orgs": "all"})
    assert [x["email"] for x in r["recipients"]] == ["dir@careplus.example", "dir@sunrise.example"]
    assert {o["organization_id"] for o in r["organizations"]} == {"org-1", "org-2"}  # suspended left out


def test_roles_widen_it_but_never_reach_participants_or_deactivated_staff():
    r = _resolve({"orgs": "all", "roles": ["managing_director", "support_coordinator", "support_worker"]})
    emails = {x["email"] for x in r["recipients"]}
    assert "coord@careplus.example" in emails
    assert "worker@careplus.example" not in emails  # deactivated
    assert "client@example.com" not in emails       # participant portal


def test_selected_providers_only():
    r = _resolve({"orgs": "selected", "org_ids": ["org-2"]})
    assert [x["email"] for x in r["recipients"]] == ["dir@sunrise.example"]
    assert r["recipients"][0]["opted_out"] is True


def test_status_filter_uses_account_health():
    snaps = [
        {"organization_id": "org-1", "billing_label": "Trial", "subscription_status": "trialing", "attention": []},
        {"organization_id": "org-2", "billing_label": "Payment failing", "subscription_status": "past_due",
         "attention": [{"code": "payment"}]},
    ]
    with patch.object(pm.console, "snapshots", return_value=snaps):
        assert [o["organization_id"] for o in _resolve({"orgs": "status", "status": "trial"})["organizations"]] == ["org-1"]
        assert [o["organization_id"] for o in _resolve({"orgs": "status", "status": "payment_trouble"})["organizations"]] == ["org-2"]


# -- Rendering -----------------------------------------------------------------

def test_personalising():
    r = {"full_name": "Dana Director", "organization_name": "Care Plus"}
    assert pm.personalise("Hi {first_name} at {organisation}, {name}", r) == "Hi Dana at Care Plus, Dana Director"
    assert pm.personalise("Hi {first_name}", {"full_name": ""}) == "Hi there"
    assert pm.personalise("{unknown} stays", r) == "{unknown} stays"


def test_unsubscribe_token_round_trip_and_tamper():
    token = pm.unsubscribe_token("u1")
    assert pm.user_for_token(token) == "u1"
    assert pm.user_for_token(pm.unsubscribe_token("u2").split(".")[0] + "." + token.split(".")[1]) is None
    assert pm.user_for_token("garbage") is None


def test_news_has_an_unsubscribe_link_and_service_does_not():
    r = {"full_name": "Dana", "organization_name": "Care Plus", "user_id": "u1"}
    msg = {"subject": "Hello {first_name}", "body": "Line one\n\nLine <two>", "category": "news",
           "button_label": "Open", "button_url": "https://app.example/x"}
    subject, text, html = pm.render_email(msg, r)
    assert subject == "Hello Dana"
    assert "email-preferences?token=" in text and "Unsubscribe" in html
    assert "Line &lt;two&gt;" in html  # escaped
    _, text2, html2 = pm.render_email({**msg, "category": "service"}, r)
    assert "email-preferences" not in text2 and "service message" in html2


# -- Sending -------------------------------------------------------------------

def test_send_records_every_person_and_skips_opted_out_news():
    db = MagicMock()
    db.table.return_value.insert.return_value.execute.side_effect = [
        MagicMock(data=[{"id": "m1", "subject": "News", "body": "Body text here", "category": "news",
                         "channels": ["email", "in_app"], "button_url": None, "org_count": 2, "recipient_count": 2}]),
        MagicMock(data=[
            {"id": "r1", "email": "dir@careplus.example", "status": "queued"},
            {"id": "r2", "email": "dir@sunrise.example", "status": "opted_out"},
        ]),
    ]
    resolved = {
        "organizations": [{"organization_id": "org-1", "name": "Care Plus"}, {"organization_id": "org-2", "name": "Sunrise"}],
        "roles": ["managing_director"],
        "recipients": [
            {"user_id": "u1", "email": "dir@careplus.example", "full_name": "Dana", "role": "managing_director",
             "organization_id": "org-1", "organization_name": "Care Plus", "opted_out": False},
            {"user_id": "u5", "email": "dir@sunrise.example", "full_name": "Sam", "role": "managing_director",
             "organization_id": "org-2", "organization_name": "Sunrise", "opted_out": True},
        ],
    }
    with patch.object(pm, "resolve_audience", return_value=resolved), \
         patch.object(pm, "get_supabase_admin", return_value=db), \
         patch.object(pm, "_enqueue", return_value=True) as enqueue, \
         patch("backend.app.services.user_notification_store.create_user_notification") as notify:
        out = pm.send_message(
            {"subject": "News", "body": "Body text here", "category": "news", "channels": ["email", "in_app"]},
            {"orgs": "all"}, "admin-1",
        )
    rows = db.table.return_value.insert.call_args_list[1][0][0]
    assert [r["status"] for r in rows] == ["queued", "opted_out"]
    assert enqueue.call_count == 1  # opted-out director gets no email...
    assert notify.call_count == 2   # ...but both see the in-app notice
    assert out["queued"] == 1 and out["org_count"] == 2


def test_nobody_in_the_audience_is_an_error():
    with patch.object(pm, "resolve_audience", return_value={"organizations": [], "recipients": [], "roles": []}):
        with pytest.raises(ValueError, match="Nobody"):
            pm.send_message({"subject": "x", "body": "y"}, {}, None)


# -- Banners -------------------------------------------------------------------

def test_banners_for_directors_and_never_for_participants():
    rows = [{"id": "b1", "audience": "everyone"}, {"id": "b2", "audience": "directors"}]
    db = MagicMock()
    db.table.return_value.select.return_value.lte.return_value.gt.return_value.order.return_value.execute.return_value.data = rows
    with patch.object(pm, "get_supabase_admin", return_value=db):
        assert [b["id"] for b in pm.active_banners({"role": "managing_director"})] == ["b1", "b2"]
        assert [b["id"] for b in pm.active_banners({"role": "support_worker"})] == ["b1"]
        assert pm.active_banners({"role": "participant"}) == []


# -- API -----------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("call", [
    lambda u: api.list_messages(current_user=u),
    lambda u: api.system_status(current_user=u),
    lambda u: api.platform_activity(current_user=u),
    lambda u: api.list_banners(current_user=u),
])
async def test_admin_only(call):
    with pytest.raises(HTTPException) as exc:
        await call(MD)
    assert exc.value.status_code == 403


def test_links_must_be_https_or_an_app_page():
    with pytest.raises(ValueError):
        api.MessageBody(subject="Hello", body="A body long enough", button_label="Go", button_url="http://evil.example")
    with pytest.raises(ValueError):
        api.MessageBody(subject="Hello", body="A body long enough", button_label="Go", button_url="javascript:alert(1)")
    ok = api.MessageBody(subject="Hello", body="A body long enough", button_label="Go", button_url="/md/import")
    assert ok.button_url.endswith("/md/import") and ok.button_url.startswith("http")


@pytest.mark.asyncio
async def test_banner_window_is_checked():
    now = datetime.now(timezone.utc)
    with pytest.raises(HTTPException) as exc:
        await api.create_banner(api.BannerBody(message="Maintenance tonight", ends_at=now - timedelta(hours=1)), current_user=ADMIN)
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        await api.create_banner(api.BannerBody(message="Maintenance tonight", ends_at=now + timedelta(days=40)), current_user=ADMIN)
    assert "31 days" in exc.value.detail


@pytest.mark.asyncio
async def test_unsubscribe_needs_a_valid_token_and_saves_the_choice():
    with pytest.raises(HTTPException) as exc:
        await api.read_preferences(token="not-a-real-token")
    assert exc.value.status_code == 404

    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"id": "u1", "email": "dana@careplus.example", "product_news_opt_out": False}
    ]
    with patch.object(api, "get_supabase_admin", return_value=db), patch.object(api, "log_action", new=AsyncMock()):
        out = await api.update_preferences(api.PreferenceUpdate(token=pm.unsubscribe_token("u1"), news=False))
    assert out == {"email": "da***@careplus.example", "news": False}
    db.table.return_value.update.assert_called_once_with({"product_news_opt_out": True})


def test_template_blanks_must_be_filled_before_sending():
    with pytest.raises(ValueError, match=r"\{date\}"):
        api.MessageBody(subject="Maintenance on {date}", body="Hi {first_name}, we are down then.")
    ok = api.MessageBody(subject="Hi {first_name}", body="News for {organisation}, {name}.")
    assert ok.subject == "Hi {first_name}"
