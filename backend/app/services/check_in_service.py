"""GPS/QR shift check-in validation (CARECLIQV2-197)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ..core.config import settings
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

CLOCK_IN_EARLY_MINUTES = 15
CLOCK_IN_LATE_MINUTES = 30
CHECK_IN_GEOFENCE_METERS = 100
QR_TOKEN_DEFAULT_TTL_DAYS = 365
OFFLINE_SYNC_MAX_SKEW_HOURS = 24


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _parse_iso(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def validate_clock_in_window(
    scheduled_start: str,
    *,
    now: Optional[datetime] = None,
) -> None:
    """Reject check-in outside the allowed window (-15 / +30 minutes)."""
    if not scheduled_start:
        return
    current = now or datetime.now(timezone.utc)
    start = _parse_iso(str(scheduled_start))
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    earliest = start - timedelta(minutes=CLOCK_IN_EARLY_MINUTES)
    latest = start + timedelta(minutes=CLOCK_IN_LATE_MINUTES)
    if current < earliest:
        raise ValueError(
            f"Too early to check in. You can check in from "
            f"{earliest.astimezone(timezone.utc).strftime('%H:%M')} UTC "
            f"({CLOCK_IN_EARLY_MINUTES} minutes before shift start)."
        )
    if current > latest:
        raise ValueError(
            f"Check-in window closed. You can check in up to "
            f"{CLOCK_IN_LATE_MINUTES} minutes after shift start."
        )


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def verify_gps_location(
    worker_lat: float,
    worker_lng: float,
    target_lat: float,
    target_lng: float,
    *,
    accuracy: Optional[float] = None,
    radius_meters: float = CHECK_IN_GEOFENCE_METERS,
) -> tuple[bool, float]:
    distance = haversine_meters(worker_lat, worker_lng, target_lat, target_lng)
    buffer_m = max(0.0, float(accuracy or 0))
    return distance <= (radius_meters + buffer_m), distance


def resolve_participant_coordinates(
    shift: dict[str, Any],
    participant_id: Optional[str],
    organization_id: str,
) -> Optional[tuple[float, float]]:
    lat = shift.get("participant_latitude")
    lng = shift.get("participant_longitude")
    if lat is not None and lng is not None:
        return float(lat), float(lng)
    if not participant_id:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select("latitude, longitude")
            .eq("id", str(participant_id))
            .eq("organization_id", str(organization_id))
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            row = rows[0]
            plat, plng = row.get("latitude"), row.get("longitude")
            if plat is not None and plng is not None:
                return float(plat), float(plng)
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("participant coordinate lookup failed: %s", exc)
    return None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _sign_payload(payload_b64: str) -> str:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def build_qr_token(code_id: str, participant_id: str, organization_id: str, *, exp: int) -> str:
    payload = {
        "cid": str(code_id),
        "pid": str(participant_id),
        "oid": str(organization_id),
        "exp": exp,
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8").rstrip("=")
    return f"{payload_b64}.{_sign_payload(payload_b64)}"


def decode_qr_token(token: str) -> dict[str, Any]:
    parts = (token or "").strip().split(".")
    if len(parts) != 2:
        raise ValueError("Invalid QR code.")
    payload_b64, signature = parts
    expected = _sign_payload(payload_b64)
    if not hmac.compare_digest(expected, signature):
        raise ValueError("Invalid QR code.")
    padding = "=" * (-len(payload_b64) % 4)
    raw = base64.urlsafe_b64decode(payload_b64 + padding)
    payload = json.loads(raw.decode("utf-8"))
    exp = int(payload.get("exp") or 0)
    if exp and datetime.now(timezone.utc).timestamp() > exp:
        raise ValueError("This QR code has expired. Ask your coordinator for a new one.")
    return payload


def verify_qr_token_for_shift(
    token: str,
    shift: dict[str, Any],
    organization_id: str,
) -> tuple[bool, Optional[str], Optional[str]]:
    payload = decode_qr_token(token)
    if str(payload.get("oid") or "") != str(organization_id):
        raise ValueError("QR code is not valid for this organization.")
    participant_id = str(shift.get("participant_id") or "")
    if participant_id and str(payload.get("pid") or "") != participant_id:
        raise ValueError("QR code does not match this participant.")
    code_id = str(payload.get("cid") or "")
    if not code_id:
        raise ValueError("Invalid QR code.")
    try:
        resp = (
            get_supabase_admin()
            .table("participant_check_in_codes")
            .select("id, token_hash, revoked_at, expires_at, participant_id, organization_id")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("QR check-in is not available yet.") from exc
        raise
    rows = resp.data or []
    if not rows:
        raise ValueError("QR code not recognized.")
    row = rows[0]
    if row.get("revoked_at"):
        raise ValueError("This QR code has been revoked.")
    expires_at = row.get("expires_at")
    if expires_at:
        exp_dt = _parse_iso(str(expires_at))
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > exp_dt:
            raise ValueError("This QR code has expired.")
    if hash_token(token) != row.get("token_hash"):
        raise ValueError("Invalid QR code.")
    if str(row.get("organization_id") or "") != str(organization_id):
        raise ValueError("QR code is not valid for this organization.")
    if participant_id and str(row.get("participant_id") or "") != participant_id:
        raise ValueError("QR code does not match this participant.")
    return True, code_id, participant_id or str(row.get("participant_id") or "")


def create_participant_check_in_code(
    participant_id: str,
    organization_id: str,
    *,
    label: str = "Primary location",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    created_by: Optional[str] = None,
    ttl_days: int = QR_TOKEN_DEFAULT_TTL_DAYS,
) -> dict[str, Any]:
    code_id = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    exp_ts = int(expires_at.timestamp())
    token = build_qr_token(code_id, participant_id, organization_id, exp=exp_ts)
    row = {
        "id": code_id,
        "organization_id": organization_id,
        "participant_id": participant_id,
        "label": label.strip() or "Primary location",
        "token_hash": hash_token(token),
        "latitude": latitude,
        "longitude": longitude,
        "expires_at": expires_at.isoformat(),
        "created_by": created_by,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        resp = get_supabase_admin().table("participant_check_in_codes").insert(row).execute()
        saved = (resp.data or [row])[0]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("QR check-in codes are not available yet.") from exc
        raise
    return {
        "id": saved.get("id", code_id),
        "participant_id": participant_id,
        "label": saved.get("label", label),
        "latitude": saved.get("latitude"),
        "longitude": saved.get("longitude"),
        "expires_at": saved.get("expires_at"),
        "qr_token": token,
    }


def list_participant_check_in_codes(participant_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("participant_check_in_codes")
            .select("id, label, latitude, longitude, expires_at, revoked_at, created_at")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .is_("revoked_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def log_shift_check_in(
    *,
    shift_id: str,
    worker_id: str,
    organization_id: str,
    method: str,
    location: Optional[dict[str, Any]] = None,
    verified: bool = False,
    verification_distance_meters: Optional[float] = None,
    qr_code_id: Optional[str] = None,
    client_timestamp: Optional[str] = None,
) -> None:
    row = {
        "shift_id": shift_id,
        "worker_id": worker_id,
        "organization_id": organization_id,
        "method": method,
        "location": location,
        "verified": verified,
        "verification_distance_meters": verification_distance_meters,
        "qr_code_id": qr_code_id,
        "client_timestamp": client_timestamp,
        "server_timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        get_supabase_admin().table("shift_check_ins").insert(row).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shift_check_ins unavailable: %s", exc)
            return
        raise


def normalize_client_timestamp(client_timestamp: Optional[str]) -> Optional[str]:
    if not client_timestamp:
        return None
    try:
        parsed = _parse_iso(client_timestamp)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if abs((now - parsed).total_seconds()) > OFFLINE_SYNC_MAX_SKEW_HOURS * 3600:
            return None
        return parsed.isoformat()
    except (TypeError, ValueError):
        return None
