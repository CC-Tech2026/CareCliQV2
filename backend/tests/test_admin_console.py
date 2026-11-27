"""Super admin console: what needs attention, free access, subscription and
user actions, and staff imported for a provider being held for its MD."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import admin
from backend.app.services import admin_console_service as console
from backend.app.services import data_import_service as svc
from backend.app.services import subscription_access

NOW = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)
ADMIN = {"id": "admin-1", "role": "super_admin"}
MD = {"id": "md-1", "role": "managing_director", "organization_id": "org-1"}


def _iso(days: float) -> str:
    return (NOW + timedelta(days=days)).isoformat()


def _org(**overrides):
    base = {
        "status": "active",
        "created_at": _iso(-30),
        "md_signed_in": True,
        "last_sign_in_at": _iso(-1),
        "participant_count": 12,
        "active_user_count": 8,
        "held_staff_count": 0,
        "access": {"state": "full"},
        "subscription_status": "active",
    }
    base.update(overrides)
    return base


def _codes(org) -> list[str]:
    return [i["code"] for i in console.attention_for(org, NOW)]


# -- What needs attention ------------------------------------------------------

def test_a_healthy_provider_needs_nothing():
    assert _codes(_org()) == []


def test_read_only_and_payment_trouble_are_urgent_and_come_first():
    items = console.attention_for(_org(access={"state": "read_only"}, participant_count=0), NOW)
    assert items[0]["code"] == "read_only" and items[0]["severity"] == "urgent"
    assert _codes(_org(subscription_status="past_due")) == ["payment"]
    grace = console.attention_for(_org(access={"state": "grace", "grace_ends_at": _iso(3)}), NOW)
    assert grace[0]["code"] == "grace" and "3 more days" in grace[0]["detail"]


def test_free_access_hides_billing_trouble_but_warns_before_it_ends():
    org = _org(access={"state": "read_only"}, access_override_until=_iso(5))
    assert _codes(org) == ["override_ending"]
    assert _codes(_org(access_override_until=_iso(40))) == []


def test_trial_ending_within_a_week():
    items = console.attention_for(_org(subscription_status="trialing", trial_ends_at=_iso(2)), NOW)
    assert [i["code"] for i in items] == ["trial_ending"] and items[0]["title"] == "Trial ends in 2 days"
    assert _codes(_org(subscription_status="trialing", trial_ends_at=_iso(20))) == []


def test_new_provider_whose_md_never_signed_in():
    assert "md_never_signed_in" in _codes(_org(md_signed_in=False, created_at=_iso(-3), last_sign_in_at=None))
    # Not on the day it was created.
    assert _codes(_org(md_signed_in=False, created_at=_iso(-0.5), last_sign_in_at=None)) == []


def test_quiet_provider():
    items = console.attention_for(_org(last_sign_in_at=_iso(-20)), NOW)
    assert items[0]["code"] == "quiet" and "20 days" in items[0]["title"]


def test_setup_gaps_suggest_importing_for_them():
    codes = _codes(_org(participant_count=0, active_user_count=1))
    assert codes == ["no_participants", "no_staff"]
    # Brand-new providers get a week first.
    assert _codes(_org(participant_count=0, active_user_count=1, created_at=_iso(-3))) == []
    # Staff we've prepared count as on the way.
    assert "no_staff" not in _codes(_org(active_user_count=1, held_staff_count=4, oldest_held_staff_at=_iso(-1)))


def test_held_staff_nudge_after_a_few_days():
    items = console.attention_for(_org(held_staff_count=4, oldest_held_staff_at=_iso(-5)), NOW)
    assert [i["code"] for i in items] == ["held_staff"] and items[0]["title"] == "4 invitations waiting to be sent"


def test_suspended_shows_only_that():
    assert _codes(_org(status="suspended", access={"state": "read_only"}, participant_count=0)) == ["suspended"]


def test_snapshots_count_users_participants_and_held_staff():
    orgs = [{"organization_id": "org-1", "organization_name": "Care Plus", "created_at": _iso(-30)}]
    tables = {
        "users": [
            {"organization_id": "org-1", "role": "managing_director", "is_active": True, "last_login": _iso(-2)},
            {"organization_id": "org-1", "role": "support_worker", "is_active": False, "last_login": _iso(-1)},
        ],
        "participants": [{"organization_id": "org-1"}] * 3,
        "held_staff_invitations": [{"organization_id": "org-1", "created_at": _iso(-1)}],
    }
    with patch.object(console, "_rows", side_effect=lambda table, cols, ids: tables[table]):
        snap = console.snapshots(orgs, NOW)[0]
    assert snap["display_name"] == "Care Plus"
    assert (snap["user_count"], snap["active_user_count"], snap["participant_count"], snap["held_staff_count"]) == (2, 1, 3, 1)
    assert snap["md_signed_in"] is True and snap["last_sign_in_at"] == _iso(-1)
    assert snap["billing_label"] == "Not billed through Stripe" and snap["access"]["state"] == "full"


def test_billing_labels():
    billed = {"stripe_customer_id": "cus_1"}
    assert console.billing_label({**billed, "subscription_status": "trialing"}, NOW) == "Trial"
    assert console.billing_label({**billed, "subscription_status": "past_due"}, NOW) == "Payment failing"
    assert console.billing_label({**billed, "subscription_status": "canceled", "access_override_until": _iso(3)}, NOW) == "Free access"


# -- Free access in the access check ---------------------------------------------

def test_free_access_overrides_a_lapsed_subscription_until_it_ends():
    lapsed = {
        "stripe_customer_id": "cus_1", "subscription_status": "canceled",
        "subscription_lapsed_at": _iso(-30),
    }
    assert subscription_access.evaluate(lapsed, NOW).state == "read_only"
    assert subscription_access.evaluate({**lapsed, "access_override_until": _iso(1)}, NOW).state == "full"
    assert subscription_access.evaluate({**lapsed, "access_override_until": _iso(-1)}, NOW).state == "read_only"


# -- Admin endpoints -------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("call", [
    lambda u: admin.list_organizations(current_user=u),
    lambda u: admin.update_subscription("org-1", admin.SubscriptionUpdate(plan_tier="medium", reason="Upgrade"), current_user=u),
    lambda u: admin.extend_trial("org-1", admin.TrialExtension(days=7, reason="Onboarding"), current_user=u),
    lambda u: admin.deactivate_user("org-1", "u-2", admin.UserAction(reason="Left"), current_user=u),
    lambda u: admin.admin_import("org-1", "staff", admin.AdminImportBody(), current_user=u),
])
async def test_every_admin_action_needs_a_super_admin(call):
    with pytest.raises(HTTPException) as exc:
        await call(MD)
    assert exc.value.status_code == 403


def _db_with_org(org: dict | None):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data = (
        [org] if org else []
    )
    return db


@pytest.mark.asyncio
async def test_free_access_is_saved_logged_and_clears_the_access_cache():
    db = _db_with_org({"organization_id": "org-1", "plan_tier": "micro"})
    until = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    with patch.object(admin, "get_supabase_admin", return_value=db), \
         patch.object(admin, "log_action", new=AsyncMock()) as log, \
         patch.object(subscription_access, "forget") as forget:
        result = await admin.update_subscription(
            "org-1",
            admin.SubscriptionUpdate(access_override_until=until, reason="Pilot through to February"),
            current_user=ADMIN,
        )
    saved = db.table.return_value.update.call_args[0][0]
    assert saved["access_override_until"].startswith(until)
    assert saved["access_override_reason"] == "Pilot through to February"
    assert result["ok"] is True
    forget.assert_called_once_with("org-1")
    assert log.await_args.kwargs["action_type"] == "admin.subscription.updated"
    assert log.await_args.kwargs["details"] == {"reason": "Pilot through to February"}


@pytest.mark.asyncio
@pytest.mark.parametrize("until, message", [
    ("2001-01-01", "future"),
    ("not a date", "valid date"),
    ((datetime.now(timezone.utc) + timedelta(days=400)).date().isoformat(), "up to a year"),
])
async def test_free_access_dates_are_checked(until, message):
    db = _db_with_org({"organization_id": "org-1"})
    with patch.object(admin, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as exc:
            await admin.update_subscription(
                "org-1", admin.SubscriptionUpdate(access_override_until=until, reason="Testing"), current_user=ADMIN,
            )
    assert exc.value.status_code == 422 and message in exc.value.detail


@pytest.mark.asyncio
async def test_trial_can_only_be_extended_while_trialling():
    db = _db_with_org({"organization_id": "org-1", "stripe_subscription_id": "sub_1", "subscription_status": "active"})
    with patch.object(admin, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as exc:
            await admin.extend_trial("org-1", admin.TrialExtension(days=7, reason="Onboarding"), current_user=ADMIN)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_trial_extension_moves_the_stripe_trial_from_its_current_end():
    trial_end = datetime.now(timezone.utc) + timedelta(days=3)
    db = _db_with_org({
        "organization_id": "org-1", "stripe_subscription_id": "sub_1",
        "subscription_status": "trialing", "trial_ends_at": trial_end.isoformat(),
    })
    with patch.object(admin, "get_supabase_admin", return_value=db), \
         patch.object(admin.stripe_service, "extend_trial") as extend, \
         patch.object(admin, "log_action", new=AsyncMock()), \
         patch.object(subscription_access, "forget"):
        await admin.extend_trial("org-1", admin.TrialExtension(days=14, reason="Migration taking longer"), current_user=ADMIN)
    sub_id, new_end = extend.call_args[0]
    assert sub_id == "sub_1"
    assert abs((new_end - (trial_end + timedelta(days=14))).total_seconds()) < 1


def _db_with_user(user: dict | None, directors: list[dict] = ()):
    db = MagicMock()

    def table(name):
        t = MagicMock()
        t.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = (
            [user] if user else []
        )
        t.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = list(directors)
        return t

    db.table.side_effect = table
    return db


@pytest.mark.asyncio
async def test_the_only_managing_director_cant_be_deactivated():
    md = {"id": "md-9", "role": "managing_director", "email": "md@example.com", "is_active": True}
    db = _db_with_user(md, directors=[md])
    with patch.object(admin, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as exc:
            await admin.deactivate_user("org-1", "md-9", admin.UserAction(reason="Left"), current_user=ADMIN)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_deactivating_signs_them_out_and_is_logged():
    worker = {"id": "w-1", "role": "support_worker", "email": "w@example.com", "is_active": True}
    db = _db_with_user(worker)
    with patch.object(admin, "get_supabase_admin", return_value=db), \
         patch.object(admin.dss, "revoke_all_sessions") as revoke, \
         patch.object(admin, "log_action", new=AsyncMock()) as log:
        await admin.deactivate_user("org-1", "w-1", admin.UserAction(reason="Left the company"), current_user=ADMIN)
    revoke.assert_called_once_with("w-1")
    assert log.await_args.kwargs["action_type"] == "admin.user.deactivated"


@pytest.mark.asyncio
async def test_role_changes_never_touch_managing_directors():
    db = _db_with_user({"id": "md-9", "role": "managing_director", "email": "md@example.com"})
    with patch.object(admin, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as exc:
            await admin.change_user_role(
                "org-1", "md-9", admin.RoleUpdate(role="support_worker", reason="Mistake"), current_user=ADMIN,
            )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_admin_staff_import_holds_instead_of_sending():
    db = _db_with_org({"organization_id": "org-1"})
    held = {"imported": 2, "skipped": 0, "results": []}
    with patch.object(admin, "get_supabase_admin", return_value=db), \
         patch.object(admin.import_svc, "hold_staff", return_value=held) as hold, \
         patch.object(admin.import_svc, "import_staff") as send, \
         patch.object(admin, "log_action", new=AsyncMock()):
        result = await admin.admin_import(
            "org-1", "staff", admin.AdminImportBody(records=[{"email": "a@example.com"}]), current_user=ADMIN,
        )
    assert result == held
    hold.assert_called_once()
    send.assert_not_called()


# -- Held staff ------------------------------------------------------------------

def test_hold_staff_stores_ready_rows_without_emailing():
    db = MagicMock()
    with patch.object(svc, "_existing_staff_emails", return_value=(set(), set())), \
         patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "_send_invitation") as send:
        result = svc.hold_staff("org-1", "admin-1", [
            {"full_name": "Ava Lee", "email": "ava@example.com", "role": "Coordinator"},
            {"full_name": "No Email"},
        ], "shiftcare")
    assert result["imported"] == 1 and result["skipped"] == 1
    rows = db.table.return_value.insert.call_args[0][0]
    assert rows == [{
        "organization_id": "org-1", "email": "ava@example.com", "full_name": "Ava Lee",
        "role": "support_coordinator", "source_system": "shiftcare", "prepared_by": "admin-1",
    }]
    send.assert_not_called()


def test_held_staff_count_as_already_invited_in_previews():
    with patch.object(svc, "_members_and_sent_invites", return_value=(set(), set())), \
         patch.object(svc, "_held_rows", return_value=[{"email": "Ava@example.com"}]):
        members, pending = svc._existing_staff_emails("org-1")
    assert pending == {"ava@example.com"}


def test_sending_held_staff_skips_people_who_joined_meanwhile():
    held = [
        {"id": "h1", "email": "ava@example.com", "role": "support_worker"},
        {"id": "h2", "email": "sam@example.com", "role": "support_coordinator"},
    ]
    db = MagicMock()
    with patch.object(svc, "_held_rows", return_value=held), \
         patch.object(svc, "_members_and_sent_invites", return_value=({"sam@example.com"}, set())), \
         patch.object(svc, "_branding", return_value={}), \
         patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "_send_invitation") as send:
        result = svc.send_held_staff("org-1", "md-1")
    assert result == {"sent": 1, "skipped": 1}
    send.assert_called_once_with(db, "org-1", "md-1", "ava@example.com", "support_worker", {})
    assert db.table.return_value.delete.call_count == 2  # both leave the holding table


def test_sending_only_chosen_held_staff():
    held = [{"id": "h1", "email": "a@example.com", "role": "support_worker"},
            {"id": "h2", "email": "b@example.com", "role": "support_worker"}]
    with patch.object(svc, "_held_rows", return_value=held), \
         patch.object(svc, "_members_and_sent_invites", return_value=(set(), set())), \
         patch.object(svc, "_branding", return_value={}), \
         patch.object(svc, "get_supabase_admin", return_value=MagicMock()), \
         patch.object(svc, "_send_invitation") as send:
        assert svc.send_held_staff("org-1", "md-1", ids=["h2"]) == {"sent": 1, "skipped": 0}
    assert send.call_args[0][3] == "b@example.com"


def test_held_rows_read_as_empty_before_migration_273():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.order.return_value.execute.side_effect = Exception(
        'relation "public.held_staff_invitations" does not exist'
    )
    with patch.object(svc, "get_supabase_admin", return_value=db):
        assert svc._held_rows("org-1") == []


def test_micro_is_no_longer_offered():
    with pytest.raises(ValueError):
        admin.SubscriptionUpdate(plan_tier="micro", reason="Downgrade")
