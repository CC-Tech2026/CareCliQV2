"""Street address to map coordinates, for the GPS clock-in check."""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from ..core.config import settings

logger = logging.getLogger(__name__)

# Google's location_type for a result that pins the address itself.
# APPROXIMATE means a suburb or postcode centre, which would put the 100 m
# clock-in radius in the wrong place, so it counts as no result.
PRECISE_LOCATION_TYPES = {"ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"}


async def geocode_address(address: str) -> Optional[tuple[float, float]]:
    """(latitude, longitude) for an Australian street address, or None when
    there's no Maps key, the lookup fails, or Google can only place it
    roughly."""
    address = (address or "").strip()
    api_key = (settings.google_maps_api_key or "").strip()
    if not address or not api_key:
        return None

    params = {"address": address, "components": "country:AU", "region": "au", "key": api_key}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get("https://maps.googleapis.com/maps/api/geocode/json", params=params)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.warning("Geocoding request failed: %s", exc)
        return None

    status = payload.get("status")
    results = payload.get("results") or []
    if status != "OK" or not results:
        logger.warning("Geocoding returned %s: %s", status, payload.get("error_message") or "no results")
        return None

    geometry = results[0].get("geometry") or {}
    if geometry.get("location_type") not in PRECISE_LOCATION_TYPES:
        logger.info("Geocoding only placed the address approximately (%s)", geometry.get("location_type"))
        return None
    location = geometry.get("location") or {}
    try:
        return float(location["lat"]), float(location["lng"])
    except (KeyError, TypeError, ValueError):
        return None
