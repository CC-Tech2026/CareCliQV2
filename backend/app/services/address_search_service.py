"""Australian address suggestions while someone types, and the full address
(street, suburb, state, postcode, map point) once they pick one.

Uses the Google Maps key the server already holds, so the key never reaches
browsers. Google offers three ways in, and which are switched on depends on
the Google Cloud project, so the first that answers is used and remembered:

1. Places API (New) autocomplete + place details (best suggestions),
2. the older Places autocomplete + details,
3. the Geocoding API, which the clock-in check already relies on: fewer and
   less forgiving suggestions, but each comes with its full address.

Typed text is never stored. Answers are cached briefly in memory so the
same few letters typed by many people cost one lookup.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx

from ..core.config import settings

logger = logging.getLogger(__name__)

NEW_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
NEW_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"
LEGACY_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
LEGACY_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

MIN_QUERY = 3
MAX_QUERY = 200
MAX_SUGGESTIONS = 6
CACHE_SECONDS = 600
CACHE_MAX = 1000
# How long to skip a way in that Google refused (e.g. API not enabled).
SKIP_SECONDS = 3600

MODES = ("places_new", "places_legacy", "geocode")
_skip_until: dict[str, float] = {}
_cache: dict[str, tuple[float, Any]] = {}

STATE_CODES = {"NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"}


class AddressSearchUnavailable(Exception):
    """No Maps key, or every Google route refused."""


def _api_key() -> str:
    return (settings.google_maps_api_key or "").strip()


def is_configured() -> bool:
    return bool(_api_key())


def _cache_get(key: str) -> Any:
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    _cache.pop(key, None)
    return None


def _cache_put(key: str, value: Any) -> None:
    if len(_cache) >= CACHE_MAX:
        # Drop the oldest tenth; simple and good enough for a hint cache.
        for k in sorted(_cache, key=lambda k: _cache[k][0])[: CACHE_MAX // 10]:
            _cache.pop(k, None)
    _cache[key] = (time.monotonic() + CACHE_SECONDS, value)


def _usable_modes() -> list[str]:
    now = time.monotonic()
    return [m for m in MODES if _skip_until.get(m, 0) <= now]


def _skip(mode: str, reason: str) -> None:
    logger.warning("Address search: %s unavailable, using the next option (%s)", mode, reason[:200])
    _skip_until[mode] = time.monotonic() + SKIP_SECONDS


# ── Turning Google's address parts into ours ────────────────────────────────


def address_from_components(
    components: list[dict[str, Any]],
    formatted: str = "",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> dict[str, Any]:
    """Street, suburb, state, postcode from Google address components (both
    the {long_name, short_name} and the newer {longText, shortText} shapes)."""
    parts: dict[str, tuple[str, str]] = {}
    for c in components or []:
        long = c.get("long_name") or c.get("longText") or ""
        short = c.get("short_name") or c.get("shortText") or long
        for t in c.get("types") or []:
            parts.setdefault(t, (long, short))

    def long_of(t: str) -> str:
        return parts.get(t, ("", ""))[0]

    def short_of(t: str) -> str:
        return parts.get(t, ("", ""))[1]

    number = long_of("street_number")
    unit = long_of("subpremise")
    route = long_of("route")
    if unit and number:
        number = f"{unit}/{number}"
    street = " ".join(p for p in (number, route) if p).strip()
    if not street:
        street = long_of("premise") or long_of("establishment") or long_of("point_of_interest")

    suburb = long_of("locality") or long_of("sublocality") or long_of("postal_town")
    state = short_of("administrative_area_level_1")
    postcode = long_of("postal_code")
    country = short_of("country") or "AU"

    if not formatted:
        tail = " ".join(p for p in (state, postcode) if p)
        formatted = ", ".join(p for p in (street, suburb, tail) if p)
    # Google ends Australian addresses with ", Australia"; nobody writes that.
    if formatted.endswith(", Australia"):
        formatted = formatted[: -len(", Australia")]

    return {
        "formatted": formatted,
        "street": street,
        "suburb": suburb,
        "state": state if state in STATE_CODES else state,
        "postcode": postcode,
        "country": country,
        "lat": lat,
        "lng": lng,
    }


def _split_description(description: str) -> tuple[str, str]:
    text = description.removesuffix(", Australia")
    head, _, tail = text.partition(", ")
    return head, tail


# ── Suggestions ─────────────────────────────────────────────────────────────


async def _suggest_places_new(client: httpx.AsyncClient, query: str, session: str) -> list[dict[str, Any]]:
    response = await client.post(
        NEW_AUTOCOMPLETE_URL,
        headers={"X-Goog-Api-Key": _api_key(), "Content-Type": "application/json"},
        json={
            "input": query,
            "includedRegionCodes": ["au"],
            "regionCode": "au",
            "languageCode": "en-AU",
            **({"sessionToken": session} if session else {}),
        },
    )
    if response.status_code in (400, 401, 403, 404):
        raise PermissionError(response.text)
    response.raise_for_status()
    out = []
    for s in response.json().get("suggestions") or []:
        p = s.get("placePrediction")
        if not p:
            continue
        fmt = p.get("structuredFormat") or {}
        main = (fmt.get("mainText") or {}).get("text") or ""
        secondary = ((fmt.get("secondaryText") or {}).get("text") or "").removesuffix(", Australia")
        description = ((p.get("text") or {}).get("text") or f"{main}, {secondary}").removesuffix(", Australia")
        out.append({"id": f"pn:{p.get('placeId')}", "main": main or description, "secondary": secondary, "description": description})
    return out


async def _suggest_places_legacy(client: httpx.AsyncClient, query: str, session: str) -> list[dict[str, Any]]:
    params = {"input": query, "components": "country:au", "language": "en-AU", "types": "address", "key": _api_key()}
    if session:
        params["sessiontoken"] = session
    response = await client.get(LEGACY_AUTOCOMPLETE_URL, params=params)
    response.raise_for_status()
    payload = response.json()
    status = payload.get("status")
    if status in ("REQUEST_DENIED", "INVALID_REQUEST"):
        raise PermissionError(payload.get("error_message") or status)
    out = []
    for p in payload.get("predictions") or []:
        fmt = p.get("structured_formatting") or {}
        description = (p.get("description") or "").removesuffix(", Australia")
        main = fmt.get("main_text") or _split_description(description)[0]
        secondary = (fmt.get("secondary_text") or _split_description(description)[1]).removesuffix(", Australia")
        out.append({"id": f"pl:{p.get('place_id')}", "main": main, "secondary": secondary, "description": description})
    return out


async def _suggest_geocode(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    response = await client.get(
        GEOCODE_URL,
        params={"address": query, "components": "country:AU", "region": "au", "key": _api_key()},
    )
    response.raise_for_status()
    payload = response.json()
    status = payload.get("status")
    if status == "REQUEST_DENIED":
        raise PermissionError(payload.get("error_message") or status)
    out = []
    for r in payload.get("results") or []:
        loc = (r.get("geometry") or {}).get("location") or {}
        address = address_from_components(
            r.get("address_components") or [], r.get("formatted_address") or "", loc.get("lat"), loc.get("lng")
        )
        main, secondary = _split_description(address["formatted"])
        # Geocoding answers come complete, so no second lookup is needed.
        out.append({"id": f"gc:{r.get('place_id')}", "main": main, "secondary": secondary, "description": address["formatted"], "address": address})
    return out


async def suggest(query: str, session: str = "") -> list[dict[str, Any]]:
    """Up to six suggestions for what's been typed so far."""
    query = " ".join((query or "").split())[:MAX_QUERY]
    if len(query) < MIN_QUERY:
        return []
    if not is_configured():
        raise AddressSearchUnavailable("No Google Maps key on this server")
    cache_key = f"s:{query.lower()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=6.0) as client:
        for mode in _usable_modes():
            try:
                if mode == "places_new":
                    found = await _suggest_places_new(client, query, session)
                elif mode == "places_legacy":
                    found = await _suggest_places_legacy(client, query, session)
                else:
                    found = await _suggest_geocode(client, query)
            except PermissionError as exc:
                _skip(mode, str(exc))
                continue
            except httpx.HTTPError as exc:
                logger.warning("Address search (%s) failed: %s", mode, exc)
                raise AddressSearchUnavailable("Address search didn't answer") from exc
            found = found[:MAX_SUGGESTIONS]
            _cache_put(cache_key, found)
            return found
    raise AddressSearchUnavailable("Google refused every address search option")


# ── The full address for a picked suggestion ────────────────────────────────


async def details(suggestion_id: str, session: str = "") -> dict[str, Any]:
    kind, _, place_id = (suggestion_id or "").partition(":")
    if not place_id or kind not in ("pn", "pl", "gc"):
        raise ValueError("Unknown suggestion")
    if not is_configured():
        raise AddressSearchUnavailable("No Google Maps key on this server")
    cache_key = f"d:{suggestion_id}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=6.0) as client:
        try:
            if kind == "pn":
                params = {"sessionToken": session} if session else {}
                response = await client.get(
                    NEW_DETAILS_URL.format(place_id=place_id),
                    params=params,
                    headers={
                        "X-Goog-Api-Key": _api_key(),
                        "X-Goog-FieldMask": "addressComponents,formattedAddress,location",
                    },
                )
                response.raise_for_status()
                p = response.json()
                loc = p.get("location") or {}
                address = address_from_components(
                    p.get("addressComponents") or [], p.get("formattedAddress") or "", loc.get("latitude"), loc.get("longitude")
                )
            elif kind == "pl":
                params = {"place_id": place_id, "fields": "address_component,formatted_address,geometry", "key": _api_key()}
                if session:
                    params["sessiontoken"] = session
                response = await client.get(LEGACY_DETAILS_URL, params=params)
                response.raise_for_status()
                r = response.json().get("result") or {}
                loc = (r.get("geometry") or {}).get("location") or {}
                address = address_from_components(
                    r.get("address_components") or [], r.get("formatted_address") or "", loc.get("lat"), loc.get("lng")
                )
            else:
                response = await client.get(GEOCODE_URL, params={"place_id": place_id, "key": _api_key()})
                response.raise_for_status()
                results = response.json().get("results") or []
                if not results:
                    raise ValueError("Unknown suggestion")
                r = results[0]
                loc = (r.get("geometry") or {}).get("location") or {}
                address = address_from_components(
                    r.get("address_components") or [], r.get("formatted_address") or "", loc.get("lat"), loc.get("lng")
                )
        except httpx.HTTPError as exc:
            logger.warning("Address details (%s) failed: %s", kind, exc)
            raise AddressSearchUnavailable("Address lookup didn't answer") from exc

    _cache_put(cache_key, address)
    return address
