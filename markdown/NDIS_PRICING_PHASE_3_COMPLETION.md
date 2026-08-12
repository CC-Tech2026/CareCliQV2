# NDIS Pricing Phase 3 Implementation — COMPLETE

**Status**: ✅ **Phase 3 COMPLETE** | Phase 4 UI integration **PENDING**  
**Completion Date**: 2025-01-27  
**Changes Made**: 5 files modified/created

---

## Summary

Unified effective-dated NDIS pricing system successfully integrated into CareCliQ backend. Supports:

- **Annual schedule loads** with bulk item creation (2025-26 data effective 2025-11-24 UTC)
- **Per-item coordinator edits** via same versioning mechanism (valid_from/valid_to)
- **Price locking in invoices** — past invoices permanently show charged prices
- **Location multiplier logic** — applied at read-time (1.25× remote, 1.40× very_remote)
- **Unified validation** — overlapping invoice detection prevents retroactive modification conflicts

---

## Phase 3 Deliverables

### New Files

#### 1. **Migration: `backend/supabase/migrations/025_ndis_pricing_effective_dated.sql`**

```
Lines: 620 | Status: Ready to apply
```

**Tables Created**:
- `ndis_price_schedules` — bulk load metadata (financial_year, effective_date, source_document)
- `ndis_price_items` — price versions with valid_from/valid_to and location fields

**Tables Modified**:
- `invoices` — added `ndis_price_item_id UUID FK` (optional, ON DELETE RESTRICT)

**Key Structures**:
- Trigger: `ndis_price_items_ensure_single_active` — enforces one active version per item per org
- Function: `resolve_ndis_price(p_item_code, p_org_id, p_as_of_date, p_location_type)` — returns price with source
- RLS Policies: service_role full access, authenticated read-scoped, coordinator write-scoped

---

#### 2. **Service: `backend/app/services/ndis_pricing_service.py`**

```
Lines: 500+ | Status: Complete
```

**Exports**:
```python
async resolve_price(item_code, org_id, as_of_date, location_type) → dict
async load_price_schedule(user, source_json) → dict
async edit_item_price(user, item_code, price_national, effective_date, reason) → dict
async get_item_history(item_code, org_id, limit) → list
async list_schedules(org_id, limit) → list
async get_schedule(schedule_id) → dict
```

**Authorization Model**:
- `load_price_schedule()`: support_coordinator only, requires recent reauthentication
- `edit_item_price()`: support_coordinator only, enforces 90-day grace period or no-invoice constraint
- `resolve_price()`: all authenticated users (read-only)

**Error Handling**:
- `403 Forbidden` — auth/role failures
- `404 Not Found` — missing item/schedule
- `409 Conflict` — overlapping invoice prevents backdating
- `422 Unprocessable Entity` — validation errors

---

#### 3. **Router: `backend/app/api/ndis_pricing.py`**

```
Lines: 300+ | Status: Complete
```

**Endpoints**:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/ndis-pricing/resolve` | Get effective price for item at date |
| `POST` | `/api/ndis-pricing/schedules/load` | Bulk load NDIS JSON |
| `GET` | `/api/ndis-pricing/schedules` | List all schedules (newest first) |
| `GET` | `/api/ndis-pricing/schedules/{id}` | Schedule details |
| `GET` | `/api/ndis-pricing/items/{code}/history` | Version history (audit trail) |
| `POST` | `/api/ndis-pricing/items/{code}/edit` | Edit single item price |

**Request/Response Models**:
```python
class PriceResolutionRequest(BaseModel):
    item_code: str
    as_of_date: str  # ISO 8601 date
    location_type: str = "national"  # "national"|"remote"|"very_remote"

class PriceResolutionResponse(BaseModel):
    id: str  # ndis_price_items.id
    item_code: str
    name: str
    price_national: float
    price_remote: Optional[float]  # NULL in storage, None here
    price_very_remote: Optional[float]  # NULL in storage, None here
    effective_price: float  # After location_type multiplier applied
    effective_price_source: str  # "explicit" | "calculated_multiplier"

class LoadScheduleRequest(BaseModel):
    raw_json: str  # NDIS support catalogue JSON

class LoadScheduleResponse(BaseModel):
    schedule_id: str
    financial_year: int
    effective_date: str
    items_loaded: int
    validation_errors: list[str]

class EditItemPriceRequest(BaseModel):
    price_national: float
    price_remote: Optional[float] = None  # Ignored if provided
    price_very_remote: Optional[float] = None  # Ignored if provided
    effective_date: str  # ISO 8601 date
    reason: str

class EditItemPriceResponse(BaseModel):
    item_code: str
    new_version_id: str
    previous_version_id: str
    effective_from: str
    previous_version_valid_to: str
    audit_log_id: str
```

---

### Modified Files

#### 4. **Backend Entry Point: `backend/app/main.py`**

**Changes**:

```python
# Line 8 — added to imports:
from .api import auth, participants, ..., ndis_pricing

# Line 172 — added to router registration:
app.include_router(ndis_pricing.router, prefix="/api")
```

**Status**: ✅ **COMPLETE** — Router now registered

---

#### 5. **Billing Integration: `backend/app/api/billing.py` + `backend/app/services/billing_service.py`**

**API Schema Changes** (`billing.py`):

```python
class InvoiceLineItem(BaseModel):
    description: str
    quantity: float
    unit_amount_cents: Optional[int] = None
    item_code: Optional[str] = None  # ← NEW: Optional NDIS item code
```

**Service Logic** (`billing_service.py`):

New async function `_resolve_ndis_prices_for_invoice()`:
- For each line item with `item_code` set, resolves current price
- Locks line to resolved `ndis_price_item_id` 
- Updates `unit_amount_cents` if not explicitly provided
- Recalculates line total with resolved price
- Gracefully handles resolution failures (doesn't block invoice creation)

Updated `create_invoice()`:
1. Calculate line totals from manual entries (existing logic)
2. Call `_resolve_ndis_prices_for_invoice()` to populate pricing
3. Recalculate totals using resolved prices
4. Persist invoice with `ndis_price_item_id` FK pointers

**Status**: ✅ **COMPLETE** — Integration hook ready

---

## Validation Checklist

- ✅ Unique scheduling: `UNIQUE (organization_id, financial_year, effective_date)` ensures no duplicates
- ✅ Single-version enforcement: Trigger on `ndis_price_items` enforces `valid_to` closure
- ✅ Audit trail: `edited_by`, `edited_at`, `reason` fields captured
- ✅ RLS scoped: All access via `organization_id` partition
- ✅ Authorization gated: support_coordinator role required for writes
- ✅ Backward compatible: Invoices without `ndis_price_item_id` continue to work
- ✅ Price protection: Overlapping invoices block retroactive edits (unless 90-day grace)
- ✅ Remote pricing: NULL in storage, applied at query-time via multipliers
- ✅ Audit logging: All price changes logged via `audit_service.log_action()`

---

## Next Steps (Phase 4 — Not Yet Started)

### UI Integration

1. **Invoice Creation Form** (`billing.tsx`):
   - Add optional NDIS item code picker with autocomplete
   - Call `POST /api/ndis-pricing/resolve` when item selected
   - Display resolved price; allow manual override

2. **Admin Price Edit Screen**:
   - New minimal form for coordinators
   - Fields: item_code, current_price (read-only), new_price_national, effective_date, reason
   - Calls `POST /api/ndis-pricing/items/{code}/edit` with require_recent_reauth

3. **Schedule Load Interface**:
   - File uploader for NDIS JSON
   - Calls `POST /api/ndis-pricing/schedules/load`
   - Shows validation results (success count, errors)

### Testing

1. **Schema Validation**:
   - Apply migration 025 to dev database
   - Verify tables/functions created
   - Confirm RLS policies enforced

2. **Loader Test**:
   - Load provided NDIS JSON file (54 items, 10 categories)
   - Verify all items created with NULL remote prices
   - Check `financial_year`, `effective_date` populated correctly

3. **Price Resolution**:
   - Call `resolve_price()` for national location (no multiplier)
   - Call `resolve_price()` for remote location (1.25× multiplier)
   - Call `resolve_price()` for very_remote location (1.40× multiplier)
   - Verify `effective_price_source` field distinguishes "explicit" vs "calculated_multiplier"

4. **Price Edit**:
   - Edit single item price as coordinator
   - Verify version history shows old and new
   - Verify past invoices still show original price
   - Verify overlapping invoice detection blocks backdating

5. **Invoice Integration**:
   - Create invoice with line item containing `item_code`
   - Verify price auto-populated from resolved price
   - Verify `ndis_price_item_id` set in persisted invoice
   - Verify manual override still works (override unit_amount_cents)

---

## Key Design Decisions (Rationale)

| Decision | Rationale |
|----------|-----------|
| **Unified versioning** (not separate systems) | Single valid_from/valid_to table handles both bulk loads and manual edits; simpler triggers, clearer audit trail |
| **NULL remote prices** in storage | Location multipliers applied at read-time; no derived data stored; easier to update multipliers without data migration |
| **schedule_id = NULL** for manual edits | Cleaner than synthetic schedule rows; audit_log provides full traceability |
| **90-day grace period** for backdating | Balances operational flexibility (recent edits allowed) with data integrity (no casual retroactive changes) |
| **ON DELETE RESTRICT** for FK | Prevents accidental invoice orphaning; coordinator must void invoice before deleting price version |
| **Invoice line_items = JSONB** | Preserves historical line structure; supports arbitrary fields without schema migration for each variant |
| **require_recent_reauth** on writes | Sensitive pricing changes require fresh authentication (defense in depth) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/TypeScript)              │
│  ┌────────────────────┐      ┌──────────────────────────┐  │
│  │ Invoice Creator    │      │ Admin Price Editor      │  │
│  │ + Item Code Pick   │      │ + Schedule Loader       │  │
│  └────────────────────┘      └──────────────────────────┘  │
└────────────┬────────────────────────────────────────────────┘
             │ HTTP REST
┌────────────▼────────────────────────────────────────────────┐
│                  FastAPI Backend (Python)                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  API Layer (ndis_pricing.py)                        │  │
│  │  • POST /resolve                                    │  │
│  │  • POST /schedules/load                             │  │
│  │  • POST /items/{code}/edit                          │  │
│  │  • GET /items/{code}/history                        │  │
│  └─────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Service Layer (ndis_pricing_service.py)            │  │
│  │  • resolve_price()                                  │  │
│  │  • load_price_schedule()                            │  │
│  │  • edit_item_price()                                │  │
│  │  • get_item_history()                               │  │
│  └─────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Billing Integration (billing_service.py)           │  │
│  │  • _resolve_ndis_prices_for_invoice()               │  │
│  │  • create_invoice() ← enhanced to resolve prices    │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────┬────────────────────────────────────────────────┘
             │ SQL (async Supabase client)
┌────────────▼────────────────────────────────────────────────┐
│              PostgreSQL Database (Supabase)                 │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Tables:                                            │  │
│  │  • ndis_price_schedules (bulk load metadata)       │  │
│  │  • ndis_price_items (versioned prices + audit)    │  │
│  │  • invoices (updated with ndis_price_item_id FK)  │  │
│  └─────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Functions:                                         │  │
│  │  • resolve_ndis_price() — price lookup + multiplier│  │
│  └─────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  RLS Policies: organization_id-scoped access       │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing / Deployment Notes

### Pre-Production Checklist

- [ ] Migration 025 applied to dev; schema verified
- [ ] NDIS JSON loader tested with provided file (54 items)
- [ ] Price resolution tested (national, remote, very_remote)
- [ ] Effective-dating logic tested (past invoices vs. future edits)
- [ ] RLS policies validated (org-scoped access enforced)
- [ ] Role-based authorization tested (coordinator-only write gates)
- [ ] Backdating conflict detection tested (90-day grace + invoice overlap)
- [ ] Audit trail verified for all operations
- [ ] Invoice integration end-to-end tested

### Known Limitations (Intentional)

1. **No backfill of remote prices**: This is by design. Remote/very_remote remain NULL; multipliers applied at query time.
2. **Self-managed participants not UI-blocked**: UI may show warning only; no schema constraint (per requirements).
3. **Location multipliers not configurable per org**: Hardcoded 1.25×/1.40× in SQL function; can be parameterized in future.
4. **No bulk price edit**: Coordinator edits are single-item only. Bulk updates would require new endpoint.

### Rollback Strategy

If issues found pre-production:

```bash
# Rollback migration (down script):
psql -h supabase_host -U postgres -d postgres -c \
  "DROP TRIGGER IF EXISTS ndis_price_items_ensure_single_active ON ndis_price_items; \
   DROP TABLE IF EXISTS ndis_price_items, ndis_price_schedules; \
   ALTER TABLE invoices DROP COLUMN IF EXISTS ndis_price_item_id;"

# Remove router (revert main.py changes)
# Remove service files (keep for reference in git)
```

---

## File Reference Summary

| File | Type | LOC | Status |
|------|------|-----|--------|
| `backend/supabase/migrations/025_ndis_pricing_effective_dated.sql` | Migration | 620 | ✅ Ready |
| `backend/app/services/ndis_pricing_service.py` | Service | 500+ | ✅ Complete |
| `backend/app/api/ndis_pricing.py` | Router | 300+ | ✅ Complete |
| `backend/app/main.py` | Entry Point | Modified | ✅ Complete |
| `backend/app/api/billing.py` | Schema | Modified | ✅ Complete |
| `backend/app/services/billing_service.py` | Service | Modified | ✅ Complete |

---

## Questions / Clarifications

If any of the following arise, refer to the detailed conversation summary in `CONVERSATION_SUMMARY.md`:

- **Backdating grace period**: 90 days before invoiced period triggers conflict
- **Location multipliers**: 1.25× remote, 1.40× very_remote (not configurable per-org yet)
- **Self-managed plan handling**: UI-side validation only; no schema constraint
- **Invoice line item override**: Still possible; price resolution doesn't force locking
- **Audit trail**: All changes logged; queryable via `get_item_history()`

---

**Created**: 2025-01-27  
**Phase**: 3 of 4  
**Next Review**: Phase 4 UI integration start
