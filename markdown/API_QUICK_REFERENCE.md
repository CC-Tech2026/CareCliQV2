# API Quick Reference - NDIS Invoicing Endpoints

**Base URL**: `http://localhost:8000/api`  
**Auth**: All endpoints require `Authorization: Bearer TOKEN` header

---

## 📋 Task Completion & Evidence

### Record Task Completion
```
POST /ndis-tasks/task-completions
Content-Type: application/json

{
  "task_id": "task-uuid",
  "participant_id": "participant-uuid", 
  "completion_date": "2025-07-15",
  "completion_time": "07:15",           # Optional HH:MM format
  "duration_minutes": 20,               # How long task took
  "shift_id": "shift-uuid",             # Optional
  "evidence_type": "photo_and_notes",   # none, photo, notes, photo_and_notes
  "evidence_photo_url": "https://...",  # S3 URL
  "evidence_notes": "Participant showered with minimal prompts"
}

Response:
{
  "id": "completion-uuid",
  "status": "submitted",                # awaiting verification
  "price_item_code": "01_011_0107_1_1",
  "billed_amount": 23.41,               # Auto-calculated
  "created_at": "2025-07-15T07:30:00Z"
}
```

### Verify Completion (Supervisor)
```
POST /ndis-tasks/task-completions/{completion_id}/verify
  ?approved=true
  &notes=Optional review notes

Response:
{
  "id": "completion-uuid",
  "status": "verified",                 # or "rejected"
  "evidence_verified": true,
  "verified_by": "supervisor-uuid",
  "verified_at": "2025-07-15T14:30:00Z"
}
```

### List Completions for Review
```
GET /ndis-tasks/task-completions
  ?participant_id=participant-uuid
  &status=submitted                     # pending, submitted, verified, rejected
  &limit=100

Response:
[
  {
    "id": "completion-uuid",
    "task_id": "task-uuid",
    "participant_id": "participant-uuid",
    "completion_date": "2025-07-15",
    "duration_minutes": 20,
    "evidence_type": "photo_and_notes",
    "status": "submitted",
    "billed_amount": 23.41,
    "participant_tasks": {
      "name": "Assist with morning shower",
      "category": "personal_care"
    }
  }
]
```

---

## 💰 Invoicing

### Preview Invoice (No Creation)
```
POST /ndis-tasks/invoices/preview

{
  "participant_id": "participant-uuid",
  "plan_id": "plan-uuid",
  "period_start": "2025-07-01",
  "period_end": "2025-07-31"
}

Response:
{
  "period_start": "2025-07-01",
  "period_end": "2025-07-31",
  "total_items": 15,
  "total_amount": 620.77,
  "line_items": [
    {
      "price_item_code": "01_011_0107_1_1",
      "description": "Assistance with Self-Care Activities - Morning Weekday",
      "support_category": "Assistance with Daily Life",
      "day_type": "Weekday",
      "time_type": "Daytime",
      "quantity": 5.5,               # Hours
      "unit_price": 70.23,           # $/hour
      "total_price": 386.27          # 5.5 × 70.23
    }
  ],
  "by_category": {
    "Assistance with Daily Life": 386.27,
    "Community Access": 234.50
  }
}
```

### Generate Invoice
```
POST /ndis-tasks/invoices/generate

{
  "participant_id": "participant-uuid",
  "plan_id": "plan-uuid",
  "period_start": "2025-07-01",
  "period_end": "2025-07-31"
}

Response:
{
  "invoice": {
    "id": "invoice-uuid",
    "invoice_number": "INV-DEMO-PART-202507-0001",
    "invoice_date": "2025-07-31",
    "period_start": "2025-07-01",
    "period_end": "2025-07-31",
    "participant_id": "participant-uuid",
    "total_amount": 620.77,
    "status": "draft",              # draft, finalized, sent, paid, cancelled
    "created_by": "coordinator-uuid",
    "created_at": "2025-07-31T09:00:00Z",
    "invoice_line_items": [...]
  },
  "line_items_count": 2,
  "total_amount": "620.77"
}
```

### Get Invoice Details
```
GET /ndis-tasks/invoices/{invoice_id}

Response:
{
  "id": "invoice-uuid",
  "invoice_number": "INV-DEMO-PART-202507-0001",
  "total_amount": 620.77,
  "status": "draft",
  "invoice_line_items": [
    {
      "id": "line-item-uuid",
      "price_item_code": "01_011_0107_1_1",
      "description": "Assistance with Self-Care Activities - Morning Weekday",
      "support_category": "Assistance with Daily Life",
      "quantity": 5.5,
      "unit_price": 70.23,
      "total_price": 386.27
    }
  ]
}
```

### Finalize Invoice (Draft → Finalized)
```
POST /ndis-tasks/invoices/{invoice_id}/finalize

Response:
{
  "id": "invoice-uuid",
  "invoice_number": "INV-DEMO-PART-202507-0001",
  "total_amount": 620.77,
  "status": "finalized",
  "finalized_at": "2025-07-31T09:05:00Z"
}
```

### Mark Invoice Sent (Finalized → Sent)
```
POST /ndis-tasks/invoices/{invoice_id}/mark-sent

Response:
{
  "id": "invoice-uuid",
  "status": "sent",
  "sent_at": "2025-07-31T10:00:00Z"
}
```

---

## 🔄 Recurring Task Scheduling

### Generate Task Instances
```
POST /ndis-tasks/schedule-recurring-tasks

{
  "start_date": "2025-07-15",
  "end_date": "2025-08-15"              # 30-day window
}

Response:
{
  "message": "Scheduled recurring tasks for org-uuid",
  "period": {
    "start": "2025-07-15",
    "end": "2025-08-15"
  },
  "summary": {
    "total_processed": 5,               # Recurring task templates
    "total_instances_created": 45,      # Total instances across all shifts
    "by_shift_type": {
      "morning": 15,
      "afternoon": 15,
      "night": 15,
      "anytime": 0
    },
    "errors": []
  }
}
```

### List Task Instances for Date
```
GET /ndis-tasks/task-instances
  ?date=2025-07-15
  &shift_type=morning                  # morning, afternoon, night, anytime, all

Response:
{
  "date": "2025-07-15",
  "shift_type": "morning",
  "count": 3,
  "instances": [
    {
      "id": "instance-uuid",
      "task_template_id": "task-uuid",
      "participant_id": "participant-uuid",
      "scheduled_date": "2025-07-15",
      "scheduled_time": "06:00:00",
      "shift_type": "morning",
      "status": "pending",               # pending, assigned, completed
      "assigned_worker_id": null,        # null until assigned
      "participant_tasks": {
        "name": "Assist with morning shower",
        "category": "personal_care"
      }
    }
  ]
}
```

### Assign Instance to Worker
```
POST /ndis-tasks/task-instances/{instance_id}/assign
  ?worker_id=worker-uuid

Response:
{
  "id": "instance-uuid",
  "status": "assigned",
  "assigned_worker_id": "worker-uuid",
  "updated_at": "2025-07-15T06:30:00Z"
}
```

---

## 📊 Invoice Status Workflow

```
Draft
  ↓
  Coordinator reviews line items (optional: use /preview first)
  ↓
POST /finalize → Finalized
  ↓
  Ready to send to participant
  ↓
POST /mark-sent → Sent
  ↓
  Participant receives, payment processed
  ↓
  Manually update to: Paid
  OR
  Mark as: Cancelled (for voided invoices)
```

---

## 🎬 Complete Example Workflow

### 1. Create Goal
```
POST /coordinator/goals
{
  "participant_id": "part-123",
  "name": "Morning Independence",
  "support_category": "01_001_01_c",
  "goal_area": "daily_living"
}
→ Returns goal-456
```

### 2. Create Recurring Task
```
POST /coordinator/participants/part-123/tasks
{
  "name": "Assist with shower",
  "goal_id": "goal-456",
  "shift_type": "morning",
  "is_recurring": true,
  "frequency_pattern": "every_morning_shift",
  "evidence_required": "photo_and_notes",
  "price_item_code": "01_011_0107_1_1"
}
→ Returns task-789
```

### 3. Generate Instances (Monthly)
```
POST /ndis-tasks/schedule-recurring-tasks
{
  "start_date": "2025-07-15",
  "end_date": "2025-08-15"
}
→ Creates 31 instances (one per morning)
```

### 4. Assign Worker to Instance
```
POST /ndis-tasks/task-instances/inst-001/assign?worker_id=worker-555
→ Instance ready for worker
```

### 5. Record Completion
```
POST /ndis-tasks/task-completions
{
  "task_id": "task-789",
  "participant_id": "part-123",
  "completion_date": "2025-07-15",
  "completion_time": "07:15",
  "duration_minutes": 20,
  "evidence_type": "photo_and_notes",
  "evidence_photo_url": "https://...",
  "evidence_notes": "Participant independent"
}
→ Returns completion-aaa with billed_amount: $23.41
→ Status: submitted (awaiting verification)
```

### 6. Verify Completion
```
POST /ndis-tasks/task-completions/completion-aaa/verify?approved=true
→ Completion status: verified
→ Now ready for invoicing
```

### 7. Preview Invoice
```
POST /ndis-tasks/invoices/preview
{
  "participant_id": "part-123",
  "period_start": "2025-07-01",
  "period_end": "2025-07-31"
}
→ Shows line items and totals WITHOUT creating invoice
→ Coordinator can review before committing
```

### 8. Generate Invoice
```
POST /ndis-tasks/invoices/generate
{
  "participant_id": "part-123",
  "period_start": "2025-07-01",
  "period_end": "2025-07-31"
}
→ Returns invoice-xyz with status: draft
→ Invoice number: INV-DEMO-PART-202507-0001
→ Total: $620.77 (sum of all verified completions)
```

### 9. Finalize Invoice
```
POST /ndis-tasks/invoices/invoice-xyz/finalize
→ Status: draft → finalized
→ Ready to send to participant
```

### 10. Mark Sent
```
POST /ndis-tasks/invoices/invoice-xyz/mark-sent
→ Status: finalized → sent
→ Timestamp recorded for tracking
```

---

## 🔍 Error Responses

### 400 Bad Request
```json
{
  "detail": "Invalid date format (use YYYY-MM-DD)"
}
```

### 403 Forbidden
```json
{
  "detail": "Coordinator role required"
}
```

### 404 Not Found
```json
{
  "detail": "Invoice not found"
}
```

### 500 Internal Server Error
```json
{
  "detail": "Price lookup failed: Item code not found"
}
```

---

## 🔑 Key Parameters

| Field | Values | Example |
|-------|--------|---------|
| `shift_type` | morning, afternoon, night, anytime | "morning" |
| `frequency_pattern` | every_morning_shift, every_afternoon_shift, every_night_shift, daily_all_shifts, specific_days_of_week, custom | "every_morning_shift" |
| `evidence_type` | none, photo, notes, photo_and_notes | "photo_and_notes" |
| `status` (completion) | submitted, verified, rejected | "verified" |
| `status` (invoice) | draft, finalized, sent, paid, cancelled | "finalized" |
| `date_format` | YYYY-MM-DD | "2025-07-15" |
| `time_format` | HH:MM or HH:MM:SS | "06:00" or "07:15:30" |

---

## 🚀 Testing with cURL

```bash
# List completions awaiting verification
curl -X GET "http://localhost:8000/api/ndis-tasks/task-completions?status=submitted" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get task instances for tomorrow, morning shift
curl -X GET "http://localhost:8000/api/ndis-tasks/task-instances?date=2025-07-16&shift_type=morning" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Generate instances for next 30 days
curl -X POST "http://localhost:8000/api/ndis-tasks/schedule-recurring-tasks" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2025-07-15",
    "end_date": "2025-08-15"
  }'
```

---

**Last Updated**: 2026-06-29  
**Version**: 1.0  
**API Status**: Ready (after migrations applied)
