# Timezone Implementation Audit

## Current Status: ⚠️ MIXED - Partial Implementation

### 1. **Timezone Configuration** ✅
**Location:** `backend/app/core/timezone.py`

**Current Setup:**
```python
APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "Australia/Adelaide"))
```

**Status:** 
- ✅ Defaults to `Australia/Adelaide` (good for SA-based operations)
- ✅ Environment configurable via `APP_TIMEZONE` env var
- ✅ Uses Python 3.9+ `zoneinfo` module (modern approach)

---

### 2. **Shift DateTime Parsing** ✅
**Function:** `parse_shift_datetime()` in `timezone.py`

**Current Logic:**
```python
def parse_shift_datetime(value: str) -> datetime:
    """Parse a shift timestamp; naive values are interpreted as APP_TIMEZONE local time."""
    text = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=APP_TIMEZONE)  # ✅ Treats naive as APP_TIMEZONE
    return dt.astimezone(timezone.utc)
```

**Status:** ✅ **CORRECT** - Properly converts APP_TIMEZONE → UTC

**Used by:**
- `shift_service.py` - Shift start/end time calculations
- `notification_service.py` - Timezone conversions for display

---

### 3. **Worker Clock-In Flow** ⚠️ **ISSUE FOUND**

**Flow:**
1. Worker sends `client_timestamp` from mobile/web (may be naive or UTC)
2. `normalize_client_timestamp()` processes it
3. Result stored in `shifts.clock_in_time`

**Problem in `check_in_service.py:312-325`:**
```python
def normalize_client_timestamp(client_timestamp: Optional[str]) -> Optional[str]:
    if not client_timestamp:
        return None
    try:
        parsed = _parse_iso(client_timestamp)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)  # ❌ WRONG!
            # Should be: parsed = parsed.replace(tzinfo=APP_TIMEZONE)
        now = datetime.now(timezone.utc)
        if abs((now - parsed).total_seconds()) > OFFLINE_SYNC_MAX_SKEW_HOURS * 3600:
            return None
        return parsed.isoformat()
    except (TypeError, ValueError):
        return None
```

**Issue:** Naive timestamps treated as **UTC** instead of **Australian local time**

**Example Scenario:**
- Worker in Adelaide clocks in at 2:00 PM local (no timezone in timestamp)
- Currently interpreted as: 2:00 PM **UTC** = 11:30 PM Adelaide time
- Should be: 2:00 PM **Adelaide** = 4:30 AM UTC

---

### 4. **Location Data Available** ✅
**Worker clock-in includes location:**
```python
class ClockInLocationBody(BaseModel):
    latitude: float
    longitude: float
```

**Current Usage:**
- ✅ Validates geofence (100m radius)
- ✅ GPS verification
- ❌ **NOT used for timezone determination**

---

### 5. **App Today** ✅
**Function:** `app_today()` in `timezone.py`
```python
def app_today() -> date:
    """Current calendar date in the application timezone (Australia by default)."""
    return datetime.now(APP_TIMEZONE).date()
```

**Status:** ✅ Correctly uses APP_TIMEZONE

---

## Summary Table

| Component | Current | Status | Issue |
|-----------|---------|--------|-------|
| APP_TIMEZONE config | Australia/Adelaide | ✅ | None |
| Shift datetime parsing | APP_TIMEZONE aware | ✅ | None |
| Worker clock-in timestamp | Naive → UTC | ❌ | Treats naive as UTC |
| Location-based timezone | Not implemented | ❌ | Hardcoded to single TZ |
| App calendar date | APP_TIMEZONE aware | ✅ | None |

---

## Recommendations

### **Priority 1: Fix Clock-In Timestamp Handling** 🔴 URGENT
Change `check_in_service.py:319` from:
```python
parsed = parsed.replace(tzinfo=timezone.utc)
```
To:
```python
from ..core.timezone import APP_TIMEZONE
parsed = parsed.replace(tzinfo=APP_TIMEZONE)
```

**Impact:** Clock-in times will be correctly recorded in Australian time

### **Priority 2: Add Location-Based Timezone** (Optional)
Implement timezone lookup from coordinates:
- Use GeoPy or similar library
- Look up timezone from worker's clock-in location (lat/lon)
- Support workers across multiple Australian states/territories:
  - Sydney: `Australia/Sydney`
  - Melbourne: `Australia/Melbourne`
  - Brisbane: `Australia/Brisbane`
  - Perth: `Australia/Perth`
  - Adelaide: `Australia/Adelaide`
  - Hobart: `Australia/Hobart`
  - Darwin: `Australia/Darwin`

### **Priority 3: Configuration Options** 
Add to `.env`:
```
# Timezone for shift scheduling (default: Australia/Adelaide)
APP_TIMEZONE=Australia/Adelaide

# Enable location-based timezone lookup for workers
LOCATION_BASED_TIMEZONE=false
```

---

## Testing Plan

**Test Case 1: Clock-In Timestamp**
```
Worker in Adelaide clocks in at 2:00 PM (14:00)
Client sends: "2024-01-15T14:00:00" (naive, no Z)

Expected stored time: 2024-01-15T04:30:00+00:00 (UTC)
Current (buggy): 2024-01-15T14:00:00+00:00 (UTC) ❌
```

**Test Case 2: Multiple Timezones**
```
If location-based TZ enabled:
- Worker at Sydney (lat: -33.87, lon: 151.21) → Australia/Sydney
- Worker at Perth (lat: -31.95, lon: 115.86) → Australia/Perth
- Shift times adjust per worker's local timezone
```

---

## Code Impact
- ✅ No breaking changes needed
- ✅ Only 1 line fix for clock-in issue
- ⚠️ Location-based TZ requires new dependency (GeoPy ~2.3)
- ⚠️ Database query updates for location lookups
