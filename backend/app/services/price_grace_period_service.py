"""Grace-period auto-adopt for the platform NDIS price catalogue.

Scaffold only — not wired into notification_scheduler.py's gather loop, and
gated off by settings.price_grace_period_auto_adopt_enabled (default false)
as a second, independent safeguard. Do not register run_price_grace_period_pass()
in the scheduler until both of these are true:

  1. platform_ndis_price_items exists and resolve_price() actually falls
     back to it (neither is built yet — organizations.auto_adopt_platform_rates
     is currently just a column with no reader).
  2. The compliance question is answered: NDIS requires a provider to
     discuss a price change with the participant and get their agreement
     before it applies to an existing service agreement — there is no
     regulator-mandated notice period. An org that ignored the diff-review
     screen being auto-adopted after a grace window proves the provider
     didn't forget, not that the participant agreed. Whether a grace-period
     auto-adopt is allowed to stand in for that consent step is a business/
     legal call, not something to decide by writing this job.

Once both are resolved, this function's body needs the actual diff/decision
record (which items an org explicitly adopted or skipped in the review
screen — also not built yet) to know what "didn't act on it" means; it
cannot be written correctly before that exists either.
"""

from __future__ import annotations

import logging

from ..core.config import settings

logger = logging.getLogger(__name__)


async def run_price_grace_period_pass() -> int:
    """No-op until price_grace_period_auto_adopt_enabled is turned on.

    Returns the count of items auto-adopted (always 0 while gated off).
    """
    if not settings.price_grace_period_auto_adopt_enabled:
        logger.debug(
            "price_grace_period_auto_adopt_enabled is false — grace-period "
            "pass skipped (platform catalogue + diff-review infra don't exist yet)."
        )
        return 0

    raise NotImplementedError(
        "price_grace_period_auto_adopt_enabled was turned on, but the platform "
        "catalogue table, the resolve_price() fallback, and the diff-review "
        "decision record this job depends on haven't been built. Turning this "
        "flag on is a no-op by design until that work lands — see this module's "
        "docstring."
    )
