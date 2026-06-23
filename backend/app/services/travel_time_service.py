"""Google Maps travel time estimates for dashboard navigation (CARECLIQV2-114)."""

from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import quote

import httpx

from ..core.config import settings

logger = logging.getLogger(__name__)


def maps_directions_url(destination: str, origin_lat: Optional[float] = None, origin_lng: Optional[float] = None) -> str:
    dest = quote(destination)
    if origin_lat is not None and origin_lng is not None:
        return (
            f"https://www.google.com/maps/dir/?api=1"
            f"&origin={origin_lat},{origin_lng}&destination={dest}&travelmode=driving"
        )
    return f"https://www.google.com/maps/dir/?api=1&destination={dest}&travelmode=driving"


async def estimate_travel_time(
    destination_address: str,
    *,
    origin_lat: Optional[float] = None,
    origin_lng: Optional[float] = None,
) -> dict[str, Any]:
    """Return travel duration using Google Distance Matrix when configured."""
    address = (destination_address or "").strip()
    if not address:
        return {
            "available": False,
            "reason": "missing_destination",
            "navigation_url": None,
            "duration_text": None,
            "duration_seconds": None,
        }

    navigation_url = maps_directions_url(address, origin_lat, origin_lng)
    api_key = (settings.google_maps_api_key or "").strip()
    if not api_key:
        return {
            "available": False,
            "reason": "maps_api_not_configured",
            "navigation_url": navigation_url,
            "duration_text": None,
            "duration_seconds": None,
        }

    if origin_lat is None or origin_lng is None:
        return {
            "available": False,
            "reason": "origin_required",
            "navigation_url": navigation_url,
            "duration_text": None,
            "duration_seconds": None,
        }

    params = {
        "origins": f"{origin_lat},{origin_lng}",
        "destinations": address,
        "mode": "driving",
        "departure_time": "now",
        "key": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                "https://maps.googleapis.com/maps/api/distancematrix/json",
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.info("Distance Matrix request failed: %s", exc)
        return {
            "available": False,
            "reason": "maps_request_failed",
            "navigation_url": navigation_url,
            "duration_text": None,
            "duration_seconds": None,
        }

    rows = payload.get("rows") or []
    if not rows:
        return {
            "available": False,
            "reason": "no_route",
            "navigation_url": navigation_url,
            "duration_text": None,
            "duration_seconds": None,
        }

    elements = rows[0].get("elements") or []
    if not elements:
        return {
            "available": False,
            "reason": "no_route",
            "navigation_url": navigation_url,
            "duration_text": None,
            "duration_seconds": None,
        }

    element = elements[0]
    if element.get("status") != "OK":
        return {
            "available": False,
            "reason": element.get("status", "no_route").lower(),
            "navigation_url": navigation_url,
            "duration_text": None,
            "duration_seconds": None,
        }

    duration = element.get("duration_in_traffic") or element.get("duration") or {}
    seconds = duration.get("value")
    text = duration.get("text")
    return {
        "available": True,
        "reason": None,
        "navigation_url": navigation_url,
        "duration_text": text,
        "duration_seconds": seconds,
        "distance_text": (element.get("distance") or {}).get("text"),
    }
