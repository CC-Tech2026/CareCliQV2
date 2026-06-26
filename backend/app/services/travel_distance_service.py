"""Travel distance estimation for mileage claims — CARECLIQV2-292."""

from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import quote

import httpx

from ..core.config import settings

logger = logging.getLogger(__name__)


async def estimate_driving_distance_km(
    origin_address: str,
    destination_address: str,
) -> dict[str, Any]:
    """Return driving distance in km using Google Distance Matrix."""
    origin = (origin_address or "").strip()
    destination = (destination_address or "").strip()
    if not origin:
        return {"available": False, "reason": "missing_origin", "distance_km": None}
    if not destination:
        return {"available": False, "reason": "missing_destination", "distance_km": None}

    api_key = (settings.google_maps_api_key or "").strip()
    if not api_key:
        return {"available": False, "reason": "maps_api_not_configured", "distance_km": None}

    params = {
        "origins": origin,
        "destinations": destination,
        "mode": "driving",
        "units": "metric",
        "key": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://maps.googleapis.com/maps/api/distancematrix/json",
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.info("Distance Matrix mileage request failed: %s", exc)
        return {"available": False, "reason": "maps_request_failed", "distance_km": None}

    rows = payload.get("rows") or []
    if not rows:
        return {"available": False, "reason": "no_route", "distance_km": None}
    elements = rows[0].get("elements") or []
    if not elements or elements[0].get("status") != "OK":
        return {
            "available": False,
            "reason": (elements[0].get("status") if elements else "no_route"),
            "distance_km": None,
        }

    distance = elements[0].get("distance") or {}
    meters = distance.get("value")
    if meters is None:
        return {"available": False, "reason": "no_distance", "distance_km": None}

    km = round(float(meters) / 1000.0, 2)
    return {
        "available": True,
        "reason": None,
        "distance_km": km,
        "distance_text": distance.get("text"),
        "navigation_url": (
            f"https://www.google.com/maps/dir/?api=1"
            f"&origin={quote(origin)}&destination={quote(destination)}&travelmode=driving"
        ),
    }


async def estimate_shift_mileage(
    worker_address: str,
    shift_destination_address: str,
) -> dict[str, Any]:
    return await estimate_driving_distance_km(worker_address, shift_destination_address)
