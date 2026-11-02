from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import stripe_service as service

SESSION = {
    "id": "cs_1",
    "metadata": {"signup": "true", "plan_tier": "small", "org_abbrev": "SUNC"},
    "customer": "cus_1",
    "subscription": "sub_1",
    "customer_details": {"email": "Founder@Example.com"},
    "custom_fields": [{"key": "organization_name", "text": {"value": "Sunshine Care"}}],
}


def _event(event_id="evt_1"):
    obj = MagicMock()
    obj.to_dict.return_value = SESSION
    return {"type": "checkout.session.completed", "id": event_id, "data": {"object": obj}}


def test_failed_webhook_forgets_event_so_stripe_retry_is_processed():
    db = MagicMock()
    with patch.object(service.stripe.Webhook, "construct_event", return_value=_event()), \
         patch.object(service, "get_supabase_admin", return_value=db), \
         patch.object(service, "_create_org_from_signup", side_effect=RuntimeError("db down")):
        with pytest.raises(RuntimeError):
            service.handle_webhook_event(b"{}", "sig")
    events = db.table.return_value
    events.insert.assert_called_once()
    events.delete.return_value.eq.assert_called_once_with("stripe_event_id", "evt_1")


def test_successful_webhook_keeps_event_recorded():
    db = MagicMock()
    with patch.object(service.stripe.Webhook, "construct_event", return_value=_event()), \
         patch.object(service, "get_supabase_admin", return_value=db), \
         patch.object(service, "_create_org_from_signup"):
        service.handle_webhook_event(b"{}", "sig")
    db.table.return_value.delete.assert_not_called()


def _org_lookup(db, existing):
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = existing


def test_replay_sends_missing_founding_invite_for_existing_org():
    db = MagicMock()
    _org_lookup(db, [{"organization_id": "org-1"}])
    sub = MagicMock()
    sub.to_dict.return_value = {"status": "trialing", "trial_end": None}
    with patch.object(service, "get_supabase_admin", return_value=db), \
         patch.object(service.stripe.Subscription, "retrieve", return_value=sub), \
         patch.object(service, "_has_founding_invite", return_value=False), \
         patch.object(service, "_send_founding_md_invite") as send:
        service._create_org_from_signup(SESSION)
    send.assert_called_once_with(org_id="org-1", email="founder@example.com", organization_name="Sunshine Care")
    db.table.return_value.insert.assert_not_called()


def test_replay_does_not_resend_when_invite_exists():
    db = MagicMock()
    _org_lookup(db, [{"organization_id": "org-1"}])
    sub = MagicMock()
    sub.to_dict.return_value = {"status": "trialing", "trial_end": None}
    with patch.object(service, "get_supabase_admin", return_value=db), \
         patch.object(service.stripe.Subscription, "retrieve", return_value=sub), \
         patch.object(service, "_has_founding_invite", return_value=True), \
         patch.object(service, "_send_founding_md_invite") as send:
        service._create_org_from_signup(SESSION)
    send.assert_not_called()


def test_new_signup_creates_org_and_sends_invite():
    db = MagicMock()
    _org_lookup(db, [])
    db.table.return_value.insert.return_value.execute.return_value.data = [{"organization_id": "org-9"}]
    sub = MagicMock()
    sub.to_dict.return_value = {"status": "trialing", "trial_end": 1790000000}
    with patch.object(service, "get_supabase_admin", return_value=db), \
         patch.object(service.stripe.Subscription, "retrieve", return_value=sub), \
         patch.object(service, "_send_founding_md_invite") as send:
        service._create_org_from_signup(SESSION)
    row = db.table.return_value.insert.call_args.args[0]
    assert row["organization_name"] == "Sunshine Care" and row["org_abbrev"] == "SUNC" and row["owner_user_id"] is None
    send.assert_called_once_with(org_id="org-9", email="founder@example.com", organization_name="Sunshine Care")


def test_founding_invite_sends_welcome_email_not_staff_invitation():
    db = MagicMock()
    with patch.object(service, "get_supabase_admin", return_value=db), \
         patch("backend.app.api.invitations._generate_short_code", return_value="ABC123"), \
         patch("backend.app.services.email_service.queue_founding_welcome_email") as welcome, \
         patch("backend.app.services.email_service.queue_invitation_email") as staff_invite:
        service._send_founding_md_invite(org_id="org-9", email="founder@example.com", organization_name="Sunshine Care")
    staff_invite.assert_not_called()
    kwargs = welcome.call_args.kwargs
    assert kwargs["to_email"] == "founder@example.com"
    assert kwargs["organization_name"] == "Sunshine Care"
    assert kwargs["trial_days"] == service.SIGNUP_TRIAL_DAYS
    assert "/accept-invite?token=" in kwargs["setup_url"]
    row = db.table.return_value.insert.call_args.args[0]
    assert row["role"] == "managing_director" and row["organization_id"] == "org-9"


def test_founding_welcome_email_reads_as_a_welcome():
    from backend.app.services import email_service

    with patch.object(email_service, "send_email") as send:
        email_service.send_founding_welcome_email(
            to_email="founder@example.com",
            setup_url="https://app.example/accept-invite?token=t",
            organization_name="Sunshine <Care>",
            trial_days=30,
        )
    kwargs = send.call_args.kwargs
    assert kwargs["subject"] == "Welcome to CareCliQ: set up Sunshine <Care>"
    assert "30-day free trial" in kwargs["text_body"]
    assert "invited" not in kwargs["text_body"].lower()
    assert "Sunshine &lt;Care&gt;" in kwargs["html_body"]
    assert kwargs.get("from_display_name") is None
