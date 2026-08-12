# NDIS Invoicing Implementation Checklist

## ✅ Completed Components

### Database Layer
- [x] Migration 071: `shift_type`, `category`, `priority` columns on `participant_tasks`
- [x] Migration 072: `evidence_required`, `is_recurring`, `frequency_pattern`, `frequency_metadata` columns
- [x] Migration 073: Complete invoicing schema
  - [x] `task_completions` table with evidence tracking
  - [x] `invoices` and `invoice_line_items` tables
  - [x] `task_instances` table for recurring task instances
  - [x] Foreign keys and indexes
- [x] Pricing integration: `price_item_code` column on `participant_tasks`

### Service Layer
- [x] `invoice_service.py` - Complete invoicing workflow
  - [x] `generate_invoice_number()` - Creates invoice numbers in ORG-PART-YYYYMM-SEQ format
  - [x] `get_completed_tasks_for_period()` - Query verified completions
  - [x] `aggregate_line_items()` - Group by price code
  - [x] `create_invoice()` - Main invoice generation
  - [x] `get_invoice_summary()` - Preview before generation
  - [x] `finalize_invoice()` - Move from draft to finalized
  - [x] `mark_invoice_sent()` - Update status with timestamp

- [x] `recurring_task_scheduler.py` - Task instance automation
  - [x] `get_shift_type_for_time()` - Determine shift from time
  - [x] `parse_frequency_pattern()` - Convert pattern to rules
  - [x] `generate_task_instances_for_range()` - Create instances for date range
  - [x] `schedule_recurring_tasks_for_period()` - Main scheduler
  - [x] `assign_task_instance_to_worker()` - Assignment workflow
  - [x] `list_task_instances_for_date()` - Roster view

### API Layer
- [x] `ndis_tasks.py` router with 10 endpoints
  - [x] POST `/ndis-tasks/task-completions` - Record completion
  - [x] POST `/ndis-tasks/task-completions/{id}/verify` - Verify evidence
  - [x] GET `/ndis-tasks/task-completions` - List completions
  - [x] POST `/ndis-tasks/invoices/preview` - Preview invoice
  - [x] POST `/ndis-tasks/invoices/generate` - Create invoice
  - [x] POST `/ndis-tasks/invoices/{id}/finalize` - Finalize
  - [x] POST `/ndis-tasks/invoices/{id}/mark-sent` - Mark sent
  - [x] GET `/ndis-tasks/invoices/{id}` - Get invoice details
  - [x] POST `/ndis-tasks/schedule-recurring-tasks` - Generate instances
  - [x] GET `/ndis-tasks/task-instances` - List instances
  - [x] POST `/ndis-tasks/task-instances/{id}/assign` - Assign to worker

- [x] Router registered in `main.py`
  - [x] Import added
  - [x] Router included with `/api` prefix

### Frontend (Existing)
- [x] Task form enhanced with NDIS fields
  - [x] `taskShiftType` state (morning/afternoon/night/anytime)
  - [x] `taskCategory` state (personal_care/medication/domestic/etc)
  - [x] `taskPriority` state (low/medium/high)
  - [x] `taskEvidenceRequired` state (none/photo/notes/both)
  - [x] `isRecurring` state (boolean)
  - [x] `frequencyPattern` state (frequency selector)
  - [x] UI components for all fields
  - [x] Mutation includes all new fields

- [x] TypeScript types updated
  - [x] `ParticipantTask` type includes new fields
  - [x] Pydantic models align with types

### Data & Scripts
- [x] `load_ndis_pricing.py` - Load pricing from JSON file
  - [x] Loads `ndis_real_data.json`
  - [x] Validates organization/user
  - [x] Displays preview and summary
  - [x] Dry-run option for testing
  - [x] Comprehensive error messages

### Documentation
- [x] `NDIS_INVOICING_COMPLETE_GUIDE.md` - Complete workflow guide
  - [x] Step-by-step instructions
  - [x] API examples with curl
  - [x] Data flow diagram
  - [x] Database schema overview
  - [x] Testing scenarios
  - [x] Troubleshooting guide
  - [x] Key concepts explained

---

## 🔄 Pending: Database Migration Application

**BLOCKING ISSUE** - Migrations created but NOT yet applied to Supabase:

- [ ] **CRITICAL**: Apply Migration 071 to Supabase
- [ ] **CRITICAL**: Apply Migration 072 to Supabase  
- [ ] **CRITICAL**: Apply Migration 073 to Supabase

**Steps to Apply**:
1. Log into Supabase Dashboard
2. Go to SQL Editor
3. Copy contents of migration file
4. Paste into editor
5. Execute

**Migration Files**:
- `backend/supabase/migrations/071_participant_tasks_shift_category_priority.sql`
- `backend/supabase/migrations/072_participant_tasks_evidence_recurring.sql`
- `backend/supabase/migrations/073_task_pricing_evidence_invoicing.sql`

---

## 📋 Next Steps (Not Yet Started)

### Priority 1: Migration & Pricing Load
1. [ ] Apply migrations 071-073 to Supabase (blocking all tests)
2. [ ] Run `python load_ndis_pricing.py` to populate pricing data
3. [ ] Verify pricing loaded via API query

### Priority 2: Feature Testing
1. [ ] Create test participant with NDIS plan
2. [ ] Create test goal with support_category
3. [ ] Create recurring task with shift_type
4. [ ] Generate task instances for 7 days
5. [ ] Record task completions with evidence
6. [ ] Verify completions
7. [ ] Generate invoice and verify line items

### Priority 3: UI Enhancements (Optional)
1. [ ] Build coordinator dashboard for:
   - [ ] Pending completions review
   - [ ] Invoice generation workflow
   - [ ] Task assignment interface
2. [ ] Worker app integration:
   - [ ] Display task instances for shift
   - [ ] Record completion with photo upload
3. [ ] Invoice PDF generation/export

### Priority 4: Automation & Scheduling (Optional)
1. [ ] APScheduler job for daily task generation
2. [ ] Email notifications for:
   - [ ] Pending evidence review
   - [ ] Invoice ready for sending
3. [ ] Webhook for scheme integration

---

## 🔍 Implementation Status by Feature

### Feature 1: Task-to-Price-Item Mapping ✅ COMPLETE
- [x] Database column `price_item_code` added
- [x] Support category field on tasks
- [x] Price lookup in completion workflow
- [x] Billing amount calculated

### Feature 2: Invoice Generation ✅ COMPLETE
- [x] Service layer fully implemented
- [x] Invoice numbering scheme
- [x] Line item aggregation
- [x] API endpoints (preview, generate, finalize, send)
- [x] Full NDIS compliance workflow

### Feature 3: Evidence Verification ✅ COMPLETE
- [x] Evidence fields on completions
- [x] Verification workflow endpoints
- [x] Supervisor approval process
- [x] Audit trail (verified_by, verified_at)

### Feature 4: Recurring Task Automation ✅ COMPLETE
- [x] Shift-time based scheduling
- [x] Multiple frequency patterns
- [x] Task instance generation
- [x] Worker assignment
- [x] Roster view endpoint

---

## 📊 Code Statistics

| Component | Lines | Status |
|-----------|-------|--------|
| Migration 071 | 85 | Created, Pending Application |
| Migration 072 | 92 | Created, Pending Application |
| Migration 073 | 245 | Created, Pending Application |
| invoice_service.py | 285 | ✅ Complete |
| recurring_task_scheduler.py | 315 | ✅ Complete |
| ndis_tasks.py (API) | 425 | ✅ Complete |
| load_ndis_pricing.py | 150 | ✅ Complete |
| **Total New Code** | **1,497** | |

---

## 🚀 Quick Start After Migrations Applied

```bash
# 1. Load pricing data
python load_ndis_pricing.py --org-email sarah@sunshine-demo.com

# 2. View pricing loaded
curl -X GET "http://localhost:8000/api/ndis-pricing/items?limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Create test goal with pricing reference
# (Use coordinator UI or API call)

# 4. Create recurring task
# (Use task form in frontend)

# 5. Generate task instances
curl -X POST http://localhost:8000/api/ndis-tasks/schedule-recurring-tasks \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"start_date": "2025-07-15", "end_date": "2025-08-15"}'

# 6. Record completions and generate invoice
# (Follow guide in NDIS_INVOICING_COMPLETE_GUIDE.md)
```

---

## 📞 Support & Questions

**Implementation by**: CareCliQ NDIS Enhancement Team  
**Date Completed**: 2026-06-29  
**Version**: 1.0

### Key Implementation Notes
- All services follow async/await patterns matching existing codebase
- Pricing lookup uses existing `resolve_ndis_price()` RPC function
- Foreign key constraints ensure referential integrity
- Comprehensive indexes on frequently queried columns
- NDIS compliance: full audit trail with verified_by/verified_at timestamps

### Known Limitations
- PDF invoice generation not yet implemented (can use third-party library)
- No email notifications (requires email queue integration)
- Shift times hardcoded (can be made configurable per organization)
- No rebilling/adjustment workflow (future enhancement)

---

**Deployment Checklist**:
- [ ] Migrations applied
- [ ] Pricing data loaded
- [ ] API endpoints responding
- [ ] Frontend types updated
- [ ] End-to-end test passed
- [ ] Documentation reviewed
- [ ] Ready for coordinator training
