"""Australian timezone helpers for shift scheduling with location-based support."""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "Australia/Adelaide"))
LOCATION_BASED_TIMEZONE = os.environ.get("LOCATION_BASED_TIMEZONE", "false").lower() == "true"

# Australian state/territory timezone mapping with approximate center coordinates
AUSTRALIAN_TIMEZONES = {
    "Australia/Sydney": {
        "states": ["NSW", "ACT"],
        "center": (-33.87, 151.21),  # Sydney CBD
        "bounds": {"lat": (-28.0, -37.5), "lon": (140.0, 160.0)},
    },
    "Australia/Melbourne": {
        "states": ["VIC"],
        "center": (-37.81, 144.96),  # Melbourne CBD
        "bounds": {"lat": (-34.0, -39.0), "lon": (140.0, 150.0)},
    },
    "Australia/Brisbane": {
        "states": ["QLD"],
        "center": (-27.47, 153.03),  # Brisbane CBD
        "bounds": {"lat": (-10.0, -29.0), "lon": (138.0, 160.0)},
    },
    "Australia/Perth": {
        "states": ["WA"],
        "center": (-31.95, 115.86),  # Perth CBD
        "bounds": {"lat": (-13.0, -35.0), "lon": (112.0, 130.0)},
    },
    "Australia/Adelaide": {
        "states": ["SA"],
        "center": (-34.93, 138.60),  # Adelaide CBD
        "bounds": {"lat": (-26.0, -38.0), "lon": (129.0, 141.0)},
    },
    "Australia/Hobart": {
        "states": ["TAS"],
        "center": (-42.88, 147.33),  # Hobart CBD
        "bounds": {"lat": (-40.0, -44.0), "lon": (144.0, 149.0)},
    },
    "Australia/Darwin": {
        "states": ["NT"],
        "center": (-12.46, 130.84),  # Darwin CBD
        "bounds": {"lat": (-10.0, -26.0), "lon": (118.0, 140.0)},
    },
}


def resolve_timezone_from_coordinates(
    latitude: float,
    longitude: float,
) -> ZoneInfo:
    """
    Resolve Australian timezone from worker's GPS coordinates.
    
    Falls back to APP_TIMEZONE if location-based detection fails or is disabled.
    
    Args:
        latitude: Worker's latitude
        longitude: Worker's longitude
    
    Returns:
        ZoneInfo object for the detected timezone
    """
    if not LOCATION_BASED_TIMEZONE:
        return APP_TIMEZONE
    
    try:
        # Find closest timezone by distance to center coordinate
        best_tz = APP_TIMEZONE
        best_distance = float("inf")
        
        for tz_name, tz_info in AUSTRALIAN_TIMEZONES.items():
            center_lat, center_lon = tz_info["center"]
            # Simple Euclidean distance (good enough for Australia)
            distance = ((latitude - center_lat) ** 2 + (longitude - center_lon) ** 2) ** 0.5
            
            if distance < best_distance:
                best_distance = distance
                best_tz = ZoneInfo(tz_name)
        
        logger.debug(
            f"Resolved timezone from coordinates ({latitude}, {longitude}): {best_tz}"
        )
        return best_tz
    except Exception as e:
        logger.warning(f"Failed to resolve timezone from coordinates: {e}")
        return APP_TIMEZONE


def get_timezone_for_location(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> ZoneInfo:
    """
    Get timezone for a specific location, with fallback to APP_TIMEZONE.
    
    Args:
        latitude: Optional worker latitude
        longitude: Optional worker longitude
    
    Returns:
        ZoneInfo object for the location's timezone
    """
    if latitude is not None and longitude is not None:
        return resolve_timezone_from_coordinates(latitude, longitude)
    return APP_TIMEZONE


def parse_shift_datetime(value: str) -> datetime:
    """Parse a shift timestamp; naive values are interpreted as APP_TIMEZONE local time."""
    text = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=APP_TIMEZONE)
    return dt.astimezone(timezone.utc)


def parse_shift_datetime_with_location(
    value: str,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> datetime:
    """
    Parse shift timestamp with location-based timezone support.
    
    If location is provided, treats naive timestamps as local time in the resolved timezone.
    Otherwise falls back to APP_TIMEZONE.
    
    Args:
        value: ISO datetime string (may be naive)
        latitude: Optional worker latitude for timezone resolution
        longitude: Optional worker longitude for timezone resolution
    
    Returns:
        UTC datetime
    """
    text = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    
    if dt.tzinfo is None:
        local_tz = get_timezone_for_location(latitude, longitude)
        dt = dt.replace(tzinfo=local_tz)
    
    return dt.astimezone(timezone.utc)


def app_today() -> date:
    """Current calendar date in the application timezone (Australia by default)."""
    return datetime.now(APP_TIMEZONE).date()


def get_local_time_for_location(
    dt: datetime,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> datetime:
    """
    Convert UTC datetime to local time for a specific location.
    
    Args:
        dt: UTC datetime to convert
        latitude: Optional worker latitude
        longitude: Optional worker longitude
    
    Returns:
        Datetime in the location's local timezone
    """
    local_tz = get_timezone_for_location(latitude, longitude)
    return dt.astimezone(local_tz)
