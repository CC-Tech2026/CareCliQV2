
# NDIS Invoicing Complete Implementation Guide

## 🎯 Overview

This guide walks through the complete NDIS invoicing workflow:
1. **Load pricing data** from official NDIS schedule
2. **Create goals and tasks** with proper categorization
3. **Schedule recurring tasks** with shift-based automation
4. **Record task completions** with evidence verification
5. **Generate invoices** from verified completions
6. **Track billing** with full audit trail

## 📋 Prerequisites

- ✅ Supabase instance running
- ✅ Backend API server running on port 8000
- ✅ Frontend dev server running on port 18130
- ✅ Coordinator user account created
- ✅ Participant with NDIS plan in system

## 🚀 Step 1: Load NDIS Pricing Data

The system comes with real NDIS pricing data for 2025-26 financial year.

### Option A: Load via Python Script

```bash
cd /path/to/Supabase-Python-Hub

# Activate venv if needed
source .venv/bin/activate  # Linux/Mac
# or
.\.venv\Scripts\Activate.ps1  # Windows

# Load pricing data
python load_ndis_pricing.py --org-email sarah@sunshine-demo.com

# Output should show:
# ✅ SUCCESS!
# 📈 Loading Results:
#   • Items Loaded: 54
#   • Financial Year: 2025-26
```

### Option B: Check Pricing Loaded

```bash
# Query pricing items via API
curl -X POST http://localhost:8000/api/ndis-pricing/resolve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "item_code": "01_011_0107_1_1",
    "as_of_date": "2025-07-15",
    "location_type": "national"
  }'
```

## 📊 Step 2: Create Participant Plan with Budget

### API: Create NDIS Plan

```bash
POST /api/plans
Body: {
  "participant_id": "xxx-yyy-zzz",
  "plan_number": "2700123456",
  "plan_start": "2025-07-01",
  "plan_end": "2026-06-30",
  "total_funding": 25000
}
```

### Plan Budget Categories (Auto-created)

After plan creation, budget categories are initialized:
- **Core Supports**: $15,000 allocated (default rate: $67.56/hr)
- **Capacity Building**: $8,000 allocated (default rate: $193.99/hr)
- **Capital**: $2,000 allocated (one-time only)

## 🎯 Step 3: Create Goals with Support Category

Goals link to NDIS funding lines for budget tracking.

### API: Create NDIS Goal

```bash
POST /api/coordinator/goals
Body: {
  "participant_id": "xxx-yyy-zzz",
  "name": "Increase morning routine independence",
  "goal_area": "daily_living",
  "support_category": "01_001_01_c",  # ← Matches pricing code
  "description": "Enable independent breakfast prep",
  "target_date": "2025-12-31",
  "success_criteria": "Breakfast 5/7 days independently"
}
```

**Support Category Options** (from pricing schedule):
- `01_001_01_c` - Personal Care (Morning)
- `01_001_02_c` - Personal Care (Evening)
- `01_001_03_c` - Personal Care (Night)
- `01_002_01_c` - Domestic Assistance
- etc.

## 📝 Step 4: Create Tasks with Price Item Code

Tasks inherit support_category from goal and specify shift type for rate lookup.

### API: Create Task with Pricing

```bash
POST /api/coordinator/participants/{participant_id}/tasks
Body: {
  "name": "Assist with morning shower",
  "goal_id": "goal-xxx",
  "description": "Verbal prompts only",
  "shift_type": "morning",          # ← morning/afternoon/night/anytime
  "category": "personal_care",       # ← UI grouping
  "support_category": "01_001_01_c", # ← Inherited from goal
  "priority": "high",
  "is_mandatory": true,
  "is_recurring": true,
  "frequency_pattern": "every_morning_shift",  # ← Auto-generate daily
  "evidence_required": "photo_and_notes",       # ← NDIS audit requirement
  "price_item_code": "01_011_0107_1_1"         # ← Maps to pricing (optional)
}
```

**Frequency Patterns**:
- `every_morning_shift` - Daily 6:00-12:00
- `every_afternoon_shift` - Daily 12:00-17:00
- `every_night_shift` - Daily 17:00-06:00
- `daily_all_shifts` - All times
- `specific_days_of_week` - Custom days (requires frequency_metadata)
- `custom` - Custom schedule

## 🔄 Step 5: Generate Task Instances from Recurring Template

Coordinator runs scheduler to create task instances for upcoming shifts.

### API: Schedule Recurring Tasks

```bash
POST /api/ndis-tasks/schedule-recurring-tasks
Body: {
  "start_date": "2025-07-15",
  "end_date": "2025-08-15"  # 30 days ahead
}

# Response:
{
  "message": "Scheduled recurring tasks",
  "summary": {
    "total_processed": 5,
    "total_instances_created": 45,
    "by_shift_type": {
      "morning": 15,
      "afternoon": 15,
      "night": 15,
      "anytime": 0
    }
  }
}
```

### View Scheduled Tasks for Date

```bash
GET /api/ndis-tasks/task-instances?date=2025-07-15&shift_type=morning

# Response:
{
  "date": "2025-07-15",
  "shift_type": "morning",
  "instances": [
    {
      "id": "inst-xxx",
      "task_template_id": "task-yyy",
      "scheduled_date": "2025-07-15",
      "scheduled_time": "06:00:00",
      "shift_type": "morning",
      "status": "pending",
      "participant_tasks": {
        "name": "Assist with morning shower",
        "category": "personal_care"
      }
    }
  ],
  "count": 1
}
```

### Assign Task to Worker

```bash
POST /api/ndis-tasks/task-instances/{instance_id}/assign
  ?worker_id=worker-xxx

# Task instance status changes to "assigned"
```

## ✅ Step 6: Record Task Completion with Evidence

Worker/supervisor records completion with evidence.

### API: Record Task Completion

```bash
POST /api/ndis-tasks/task-completions
Body: {
  "task_id": "task-xxx",
  "participant_id": "part-xxx",
  "completion_date": "2025-07-15",
  "completion_time": "07:15",
  "duration_minutes": 20,
  "shift_id": "shift-xxx",
  "evidence_type": "photo_and_notes",
  "evidence_photo_url": "https://...",
  "evidence_notes": "Participant showered independently with minimal prompts"
}

# Automatic pricing lookup:
# - Resolves price_item_code for date
# - Looks up hourly rate for shift_type (morning = $70.23)
# - Calculates: 20 min / 60 = 0.333 hrs × $70.23 = $23.41
# - Records billed_amount: $23.41
```

**Evidence Types**:
- `none` - No evidence required
- `photo` - Photo proof required
- `notes` - Worker notes required
- `photo_and_notes` - Both photo and notes

**Status**: Starts as `submitted` (pending verification)

## 🔍 Step 7: Verify Evidence & Approve for Billing

Supervisor reviews evidence and approves/rejects.

### API: Verify Completion

```bash
POST /api/ndis-tasks/task-completions/{completion_id}/verify
  ?approved=true
  &notes="Evidence satisfies audit requirements"

# Status changes to "verified"
# Only verified completions can be invoiced
```

### View Completions for Review

```bash
GET /api/ndis-tasks/task-completions
  ?participant_id=part-xxx
  &status=submitted  # pending, submitted, verified, rejected

# Lists all task completions awaiting review
```

## 📄 Step 8: Preview & Generate Invoice

Coordinator generates invoice from verified completions.

### API: Preview Invoice (No Creation)

```bash
POST /api/ndis-tasks/invoices/preview
Body: {
  "participant_id": "part-xxx",
  "plan_id": "plan-xxx",
  "period_start": "2025-07-01",
  "period_end": "2025-07-31"
}

# Response (no invoice created):
{
  "period_start": "2025-07-01",
  "period_end": "2025-07-31",
  "total_items": 15,
  "line_items": [
    {
      "price_item_code": "01_011_0107_1_1",
      "description": "Assistance with Self-Care Activities - Morning Weekday",
      "support_category": "Assistance with Daily Life",
      "day_type": "Weekday",
      "time_type": "Daytime",
      "quantity": 5.5,           # Hours
      "unit_price": 70.23,       # $/hour
      "total_price": 386.27      # 5.5 × 70.23
    }
  ],
  "by_category": {
    "Assistance with Daily Life": 386.27,
    "Community Access": 234.50
  },
  "total_amount": 620.77
}
```

### API: Generate Invoice

```bash
POST /api/ndis-tasks/invoices/generate
Body: {
  "participant_id": "part-xxx",
  "plan_id": "plan-xxx",
  "period_start": "2025-07-01",
  "period_end": "2025-07-31"
}

# Response:
{
  "invoice": {
    "id": "inv-xxx",
    "invoice_number": "INV-DEMO-PART-202507-1234",
    "invoice_date": "2025-07-31",
    "period_start": "2025-07-01",
    "period_end": "2025-07-31",
    "total_amount": 620.77,
    "status": "draft",
    "invoice_line_items": [...]
  },
  "line_items_count": 2,
  "total_amount": "620.77"
}
```

**Invoice Status Flow**:
1. `draft` - Created, awaiting coordinator review
2. `finalized` - Approved for sending
3. `sent` - Submitted to participant/scheme
4. `paid` - Payment received
5. `cancelled` - Voided

### API: Finalize Invoice

```bash
POST /api/ndis-tasks/invoices/{invoice_id}/finalize

# Moves from draft → finalized
# Ready to send to participant
```

### API: Mark Sent

```bash
POST /api/ndis-tasks/invoices/{invoice_id}/mark-sent

# Moves from finalized → sent
# Records sent_date timestamp
```

## 🔗 Data Flow Diagram

```
NDIS Pricing Schedule (2025-26)
├─ Item: "01_011_0107_1_1"
│  ├─ Name: "Assistance with Self-Care Activities - Morning Weekday"
│  ├─ Price: $70.23/hour
│  └─ Support Category: "01_001_01_c"
│
↓
Participant Plan
├─ Total Budget: $25,000
├─ Period: 2025-07-01 to 2026-06-30
└─ Budgets by Category:
   ├─ Core Supports: $15,000
   ├─ Capacity Building: $8,000
   └─ Capital: $2,000
│
↓
NDIS Goal
├─ Name: "Morning Independence"
├─ Support Category: "01_001_01_c" (links to pricing)
└─ Related Tasks: [task-1, task-2, ...]
│
↓
Recurring Task Template
├─ Name: "Assist with morning shower"
├─ Shift Type: morning (6:00-12:00)
├─ Support Category: "01_001_01_c" (inherited)
├─ Price Item Code: "01_011_0107_1_1" (explicit mapping)
├─ Frequency Pattern: every_morning_shift
└─ Evidence Required: photo_and_notes
│
↓
Task Instances (Auto-generated Daily)
├─ Instance 1: 2025-07-15 @ 06:00, morning shift
├─ Instance 2: 2025-07-16 @ 06:00, morning shift
└─ Instance N: ...
│
↓
Task Completions (Worker Records)
├─ Date: 2025-07-15
├─ Duration: 20 min
├─ Evidence: Photo + Notes
├─ Price Lookup: $70.23/hour
├─ Billed: (20/60) × $70.23 = $23.41
└─ Status: submitted → verified
│
↓
Invoice (Aggregated Completions)
├─ Period: 2025-07-01 to 2025-07-31
├─ Line Item 1: $386.27 (5.5 hrs × $70.23)
├─ Line Item 2: $234.50 (other services)
├─ Total: $620.77
└─ Status: draft → finalized → sent → paid
```

## 📊 Database Schema

### New Tables Added

| Table | Purpose |
|-------|---------|
| `task_completions` | Individual task completion records with evidence |
| `invoices` | Invoice headers grouped by participant/period |
| `invoice_line_items` | Line items per invoice, grouped by price code |
| `task_instances` | Individual task instances from recurring templates |

### Key Columns Added

**participant_tasks**:
- `price_item_code` - Links task to pricing schedule
- `is_recurring` - Mark as template for automation
- `frequency_pattern` - Recurrence rule
- `evidence_required` - Audit requirement

**task_completions**:
- `evidence_type`, `evidence_photo_url`, `evidence_notes` - Compliance tracking
- `billed_amount` - Calculated from pricing
- `invoice_id` - Links to invoice
- `verified_by`, `verified_at` - Audit trail

## 🔍 Testing the Full Flow

### Quick Test Scenario

```bash
# 1. Load pricing (already done in Step 1)
python load_ndis_pricing.py

# 2. Create test goal
curl -X POST http://localhost:8000/api/coordinator/goals \
  -H "Authorization: Bearer TOKEN" \
  -d '{...goal payload...}'

# 3. Create recurring task
curl -X POST http://localhost:8000/api/coordinator/participants/{id}/tasks \
  -H "Authorization: Bearer TOKEN" \
  -d '{...task with is_recurring: true...}'

# 4. Generate instances
curl -X POST http://localhost:8000/api/ndis-tasks/schedule-recurring-tasks \
  -H "Authorization: Bearer TOKEN" \
  -d '{"start_date": "2025-07-15", "end_date": "2025-07-20"}'

# 5. Record completion
curl -X POST http://localhost:8000/api/ndis-tasks/task-completions \
  -H "Authorization: Bearer TOKEN" \
  -d '{...completion payload...}'

# 6. Verify completion
curl -X POST http://localhost:8000/api/ndis-tasks/task-completions/{id}/verify \
  -H "Authorization: Bearer TOKEN" \
  -d '{"approved": true}'

# 7. Generate invoice
curl -X POST http://localhost:8000/api/ndis-tasks/invoices/generate \
  -H "Authorization: Bearer TOKEN" \
  -d '{"participant_id": "...", "period_start": "2025-07-01", "period_end": "2025-07-31"}'
```

## 🐛 Troubleshooting

### "Task not found" on completion
- Verify task belongs to coordinator's organization
- Check task_id is correct UUID format

### "No verified completions found" on invoice generation
- Completions must have status = "verified"
- Check completions exist in date range
- Verify evidence was approved via /verify endpoint

### Price lookup failing
- Ensure pricing data loaded (check ndis_price_items table)
- Verify item_code matches pricing schedule exactly
- Check date is within valid_from/valid_to range

### Task instances not generating
- Recurring task must have is_recurring = true
- Frequency pattern must be valid (one of 6 types)
- Date range must not be empty

## 📚 API Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/ndis-tasks/task-completions` | Record completion |
| POST | `/ndis-tasks/task-completions/{id}/verify` | Approve for billing |
| GET | `/ndis-tasks/task-completions` | List completions |
| POST | `/ndis-tasks/invoices/preview` | Preview before generation |
| POST | `/ndis-tasks/invoices/generate` | Create invoice |
| POST | `/ndis-tasks/invoices/{id}/finalize` | Approve for sending |
| POST | `/ndis-tasks/invoices/{id}/mark-sent` | Mark as sent |
| POST | `/ndis-tasks/schedule-recurring-tasks` | Generate task instances |
| GET | `/ndis-tasks/task-instances` | List instances for date |
| POST | `/ndis-tasks/task-instances/{id}/assign` | Assign to worker |

## 🎓 Key Concepts

**Support Category**: NDIS funding line linking goals/tasks to pricing (e.g., "01_001_01_c")

**Price Item Code**: Specific pricing code from schedule (e.g., "01_011_0107_1_1")

**Shift Type**: Time period affecting rates (morning $70.23, night $78.81)

**Frequency Pattern**: Recurrence rule for task automation

**Evidence Verification**: Supervisor approval before billing

**Task Instance**: Individual scheduled occurrence from recurring template

**Invoice Status**: Draft → Finalized → Sent → Paid (with audit trail)

---

**Version**: 1.0 | **Date**: 2026-06-29 | **For CareCliQ NDIS System**
