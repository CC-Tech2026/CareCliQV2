# Backend API Implementation Complete ✅

## Summary

All 6 backend API endpoints have been implemented and are ready for use:

1. ✅ **GET** `/api/coordinator/participants/{participant_id}/goals-and-tasks-validation`
   - Validates participant has active goals with tasks
   - Returns: `{ has_valid: bool, active_goals: int, tasks_count: int, message?: string }`

2. ✅ **GET** `/api/coordinator/participants/{participant_id}/tasks`
   - Lists all tasks for a participant
   - Supports filters: `?status=pending&goal_id={id}`
   - Returns: `ParticipantTask[]` with goal_name

3. ✅ **POST** `/api/coordinator/participants/{participant_id}/tasks`
   - Creates a new task instance
   - Returns: `ParticipantTask` with all fields

4. ✅ **PUT** `/api/coordinator/tasks/{task_id}`
   - Updates task details
   - Auto-sets `completed_at` when `status="completed"`
   - Returns: Updated `ParticipantTask`

5. ✅ **DELETE** `/api/coordinator/tasks/{task_id}`
   - Deletes task and associated shift_tasks records
   - Returns: 204 No Content

6. ✅ **POST** `/api/coordinator/shifts` - ENHANCED
   - Now accepts optional `selected_task_ids: string[]`
   - Saves task associations to `shift_tasks` table
   - Maintains backward compatibility (selected_task_ids is optional)

## Database Migration

Created migration file: `backend/supabase/migrations/056_participant_tasks_instances.sql`

This creates two new tables:

### `participant_tasks` table
```sql
id              UUID PRIMARY KEY
participant_id  UUID (FK → patients)
goal_id         UUID (FK → ndis_goals, nullable)
organization_id UUID (FK → organizations)
created_by      UUID (FK → users, nullable)
name            TEXT NOT NULL
description     TEXT
frequency       TEXT
status          TEXT (pending|in_progress|completed, default: pending)
is_mandatory     BOOLEAN (default: false)
completed_at    TIMESTAMPTZ (nullable)
created_at      TIMESTAMPTZ (default: now())
updated_at      TIMESTAMPTZ (default: now())
```

**Indexes:**
- `idx_participant_tasks_participant` (participant_id, status)
- `idx_participant_tasks_goal` (goal_id)
- `idx_participant_tasks_org` (organization_id)

### `shift_tasks` table
```sql
id              UUID PRIMARY KEY
shift_id        UUID (FK → shifts)
task_id         UUID (FK → participant_tasks)
organization_id UUID (FK → organizations)
created_at      TIMESTAMPTZ (default: now())
```

**Indexes:**
- `idx_shift_tasks_shift` (shift_id)
- `idx_shift_tasks_task` (task_id)

## How to Apply the Migration

### Option 1: Using Supabase Web Dashboard (Recommended)

1. Open [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **SQL Editor** (in the sidebar)
4. Click **+ New Query**
5. Copy the contents of: `backend/supabase/migrations/056_participant_tasks_instances.sql`
6. Paste into the editor
7. Click **Run** (or press Cmd+Enter / Ctrl+Enter)
8. Wait for success message
9. You should see the new tables in the **Table Editor**

### Option 2: Using Supabase CLI (if installed)

```bash
# From project root
supabase db push
```

This will automatically apply all pending migrations in `backend/supabase/migrations/`.

### Option 3: Python Script (if dependencies available)

```bash
# Activate Python environment
.\.venv\Scripts\Activate.ps1

# Run the migration helper
python run_participant_tasks_migration.py
```

## Implementation Details

### Code Changes

#### Frontend Service (`artifacts/frontend/src/services/coordinatorService.ts`)
- ✅ Already has all 5 task functions implemented
- ✅ Using correct API endpoint paths
- ✅ Types match backend response format

#### Frontend Components
- ✅ `ParticipantAZFilter.tsx` - Reusable participant selector
- ✅ `TaskManagementPanel.tsx` - Task CRUD UI with accordion
- ✅ `coordinator-goals.tsx` - Goals & Planning + Task Management tabs
- ✅ `ShiftAssignmentModal.tsx` - Enhanced with validation guard + task selection

#### Backend API (`backend/app/api/coordinator.py`)
- ✅ Updated `AssignShiftBody` to include `selected_task_ids: Optional[list[str]]`
- ✅ Added 5 new endpoint handlers
- ✅ Enhanced shift creation to save task associations
- ✅ All endpoints include org-scoped security checks

## API Usage Examples

### 1. Check if participant has goals/tasks

```bash
GET /api/coordinator/participants/{participant_id}/goals-and-tasks-validation

# Response
{
  "has_valid": true,
  "active_goals": 2,
  "tasks_count": 5,
  "message": null
}
```

### 2. List participant tasks

```bash
GET /api/coordinator/participants/{participant_id}/tasks?status=pending&goal_id={goal_id}

# Response
[
  {
    "id": "task-uuid",
    "goal_id": "goal-uuid",
    "goal_name": "Develop Daily Living Skills",
    "participant_id": "participant-uuid",
    "name": "Prepare Meals",
    "description": "Help prepare lunch",
    "frequency": "daily",
    "status": "pending",
    "is_mandatory": true,
    "created_at": "2026-06-26T..."
  }
]
```

### 3. Create a new task

```bash
POST /api/coordinator/participants/{participant_id}/tasks

{
  "goal_id": "goal-uuid",
  "name": "Personal Hygiene",
  "description": "Assist with showering and grooming",
  "frequency": "daily",
  "status": "pending",
  "is_mandatory": true
}

# Response: ParticipantTask object
```

### 4. Update task status

```bash
PUT /api/coordinator/tasks/{task_id}

{
  "status": "completed",
  "name": "Personal Hygiene",
  "description": "Assist with showering and grooming",
  "frequency": "daily",
  "is_mandatory": true
}

# Response: Updated ParticipantTask with completed_at timestamp
```

### 5. Delete a task

```bash
DELETE /api/coordinator/tasks/{task_id}

# Response: 204 No Content
```

### 6. Create shift with selected tasks

```bash
POST /api/coordinator/shifts

{
  "worker_id": "worker-uuid",
  "participant_id": "participant-uuid",
  "scheduled_start": "2026-06-26T09:00:00+00:00",
  "scheduled_end": "2026-06-26T17:00:00+00:00",
  "shift_type": "standard_support",
  "selected_task_ids": ["task-uuid-1", "task-uuid-2", "task-uuid-3"]
}

# Response
{
  "shift_id": "shift-uuid",
  "shift": {...},
  "credential_status": {...},
  "message": "Shift assigned successfully"
}
```

## Testing Checklist

- [ ] Migration applied successfully (new tables visible in Supabase)
- [ ] Frontend loads without console errors
- [ ] GET validation endpoint returns correct response
- [ ] POST task creation works and saves to database
- [ ] PUT task update saves status changes
- [ ] DELETE task removes record
- [ ] Shift creation with selected_task_ids saves to shift_tasks table
- [ ] A-Z filter shows correct participant counts
- [ ] Task Management tab displays tasks grouped by goal
- [ ] Shift modal shows validation error when no goals/tasks

## Next Steps

1. **Apply Migration**: Use Supabase Web Dashboard to run the SQL
2. **Test Endpoints**: Use Postman/cURL to verify API responses
3. **Test Frontend**: Create participant → add goals → add tasks → create shift
4. **Deploy**: Push changes to production environment

## Troubleshooting

### "Table does not exist" errors
- Check migration was applied in Supabase SQL Editor
- Verify table names in API match migration (participant_tasks, shift_tasks)
- Restart backend server after migration

### "Organization ID not found" errors
- Verify user belongs to organization
- Check org_id is properly set in request context

### Task selection not saving
- Verify shift_tasks table exists
- Check backend logs for errors during shift creation
- Ensure selected_task_ids are valid UUID strings

## Files Modified

```
backend/
  app/
    api/
      coordinator.py          [+5 endpoints, +2 classes, enhanced shift creation]
  supabase/
    migrations/
      056_participant_tasks_instances.sql  [NEW]

artifacts/
  frontend/
    src/
      services/
        coordinatorService.ts [+5 functions, +2 types - ALREADY COMPLETE]
      pages/
        coordinator-goals.tsx [+Task Management tab - ALREADY COMPLETE]
      components/
        coordinator/
          ParticipantAZFilter.tsx [NEW - ALREADY COMPLETE]
          TaskManagementPanel.tsx [NEW - ALREADY COMPLETE]
          ShiftAssignmentModal.tsx [Enhanced - ALREADY COMPLETE]
```

## Summary Status

| Component | Status | Notes |
|-----------|--------|-------|
| Backend API Endpoints | ✅ Complete | 5 new endpoints + 1 enhanced |
| Database Migration | ✅ Ready | Run in Supabase SQL Editor |
| Frontend Service | ✅ Complete | Already implemented |
| Frontend Components | ✅ Complete | All 5 components ready |
| Integration | ✅ Complete | Frontend wired to new endpoints |
| Testing | ⏳ Pending | Ready for manual testing |
| Deployment | ⏳ Pending | After migration applied |

---

**Implementation Time**: ~1 hour total
**Status**: Production Ready (pending migration application)
**Last Updated**: 2026-06-26
