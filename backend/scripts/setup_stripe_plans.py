"""Create CareCliQ's subscription plans and webhook in a Stripe account, the
same way they're set up in test mode, so switching to live is one command.

Reads the key from STRIPE_SECRET_KEY in the environment (use the live key,
sk_live_..., to go live). Dry run unless --apply. Finds things by lookup key
or URL first, so re-running never creates duplicates.

    STRIPE_SECRET_KEY=sk_live_... .venv/Scripts/python -m backend.scripts.setup_stripe_plans \
        --webhook-url https://<production-api>/api/platform-billing/webhook
    ... --apply

Creates, if missing:
  - CareCliQ Micro / Small / Medium products (tax code txcd_10103001, SaaS)
  - monthly AUD prices excluding GST, with the lookup keys stripe_service.py
    reads: micro_monthly ($125), small_monthly ($250), medium_monthly ($400)
  - a webhook endpoint for the five events stripe_service.handle_webhook_event
    handles. Its signing secret is printed once: set it as the API's
    STRIPE_WEBHOOK_SECRET.

Checks, but can't do for you (Stripe dashboard): an active Australian tax
registration (GST) and a saved Customer Portal configuration.
"""

from __future__ import annotations

import os
import sys

import stripe

PLANS = [
    ("micro_monthly", "CareCliQ Micro", 12500),
    ("small_monthly", "CareCliQ Small", 25000),
    ("medium_monthly", "CareCliQ Medium", 40000),
]
TAX_CODE = "txcd_10103001"  # Software as a service, business use
WEBHOOK_EVENTS = [
    "checkout.session.completed",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
]


def _arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None


def ensure_plans(apply: bool) -> None:
    for lookup_key, name, cents in PLANS:
        existing = stripe.Price.list(lookup_keys=[lookup_key], active=True, limit=1).data
        if existing:
            price = existing[0]
            note = "" if (price.unit_amount, price.currency, price.tax_behavior) == (cents, "aud", "exclusive") else "  <- differs from expected, check it"
            print(f"  ok      {lookup_key}: {price.unit_amount / 100:.2f} {price.currency.upper()} / {price.recurring.interval}{note}")
            continue
        print(f"  create  {lookup_key}: {name}, {cents / 100:.2f} AUD / month excl. GST")
        if not apply:
            continue
        products = stripe.Product.search(query=f"name:'{name}' AND active:'true'", limit=1).data
        product = products[0] if products else stripe.Product.create(name=name, tax_code=TAX_CODE)
        stripe.Price.create(
            product=product.id, unit_amount=cents, currency="aud",
            recurring={"interval": "month"}, tax_behavior="exclusive", lookup_key=lookup_key,
        )


def ensure_webhook(url: str | None, apply: bool) -> None:
    if not url:
        print("  skip    no --webhook-url given")
        return
    for endpoint in stripe.WebhookEndpoint.list(limit=100).auto_paging_iter():
        if endpoint.url == url:
            missing = sorted(set(WEBHOOK_EVENTS) - set(endpoint.enabled_events))
            print(f"  ok      {url} ({endpoint.status})" + (f"  <- missing events {missing}" if missing else ""))
            return
    print(f"  create  {url} for {len(WEBHOOK_EVENTS)} events")
    if apply:
        endpoint = stripe.WebhookEndpoint.create(url=url, enabled_events=WEBHOOK_EVENTS)
        print(f"\n  Webhook signing secret (shown once, set it as STRIPE_WEBHOOK_SECRET on the API):\n  {endpoint.secret}\n")


def check_dashboard_only() -> None:
    try:
        regs = stripe.tax.Registration.list(limit=20).data
        au = [r for r in regs if r.country == "AU" and r.status == "active"]
        print("  ok      Australian GST registration is active" if au else
              "  TODO    No active Australian tax registration: Dashboard > Tax > Registrations, add Australia (GST)")
    except Exception as exc:
        print(f"  ?       Couldn't read tax registrations: {exc}")
    try:
        configs = stripe.billing_portal.Configuration.list(is_default=True, limit=1).data
        print("  ok      Customer Portal is configured" if configs else
              "  TODO    Save the Customer Portal settings once: Dashboard > Settings > Billing > Customer portal")
    except Exception as exc:
        print(f"  ?       Couldn't read Customer Portal settings: {exc}")


def main() -> None:
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key.startswith(("sk_live_", "sk_test_", "rk_live_", "rk_test_")):
        sys.exit("Set STRIPE_SECRET_KEY to the account's secret key (sk_live_... for live).")
    stripe.api_key = key
    apply = "--apply" in sys.argv
    account = stripe.Account.retrieve()
    mode = "LIVE" if "_live_" in key else "test"
    print(f"Stripe account: {account.settings.dashboard.display_name} ({mode} mode){'' if apply else ', dry run'}")
    print("Plans:")
    ensure_plans(apply)
    print("Webhook:")
    ensure_webhook(_arg("--webhook-url"), apply)
    print("Dashboard settings:")
    check_dashboard_only()
    if not apply:
        print("Dry run. Re-run with --apply to create what's marked 'create'.")


if __name__ == "__main__":
    main()
