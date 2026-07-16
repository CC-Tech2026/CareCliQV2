# ✅ Supabase Migration Checklist - NDIS Invoicing System

**Status**: Multiple migrations pending application  
**Critical**: These migrations are BLOCKING the entire invoicing system

---

## 🔍 Quick Status Check

Run this in your Supabase SQL editor to verify which columns exist:

```sql
-- Check if recent migrations have been applied
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'participant_tasks' 
  AND column_name IN ('shift_type', 'evidence_required', 'is_recurring', 'price_item_code', 'category', 'priority');
```

**If you see 0 results** → Migrations 070-073 NOT applied (need to apply)  
**If you see 6 columns** → All migrations applied ✅

---

## 📋 Required Migrations (In Order)

### Migration 070: NDIS Support Category
**File**: `backend/supabase/migrations/070_ndis_support_category.sql`  
**Status**: ⏳ **PENDING** - Need to apply  
**What it does**: Adds `support_category` column to goals and tasks  
**Blocking**: Allows linking tasks to NDIS budget lines

```sql
-- Run this in Supabase SQL Editor
ALTER TABLE ndis_goals
  ADD COLUMN IF NOT EXISTS support_category TEXT;

ALTER TABLE participant_tasks
  ADD COLUMN IF NOT EXISTS support_category TEXT;

COMMENT ON COLUMN ndis_goals.support_category 
  IS 'NDIS funding line: core_daily_activities | core_transport | core_consumables | core_social_community | cb_support_coordination | cb_daily_living | cb_health_wellbeing | cb_social_skills | cb_employment | cb_learning | capital_assistive_tech | capital_home_mods';

COMMENT ON COLUMN participant_tasks.support_category 
  IS 'NDIS funding line matching ndis_goals.support_category';
```

---

### Migration 071: Shift Type, Category, Priority
**File**: `backend/supabase/migrations/071_participant_tasks_shift_category_priority.sql`  
**Status**: ⏳ **PENDING** - Need to apply  
**What it does**: Adds shift scheduling fields (morning/afternoon/night) and task classification  
**Blocking**: Task form requires these fields for UI

```sql
-- Run this in Supabase SQL Editor
ALTER TABLE participant_tasks
  ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'anytime' 
    CHECK (shift_type IN ('morning', 'afternoon', 'night', 'anytime')),
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other'
    CHECK (category IN ('personal_care', 'medication', 'domestic_assistance', 'community_access', 'transport', 'other')),
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high'));

COMMENT ON COLUMN participant_tasks.shift_type 
  IS 'Which shift(s) this task applies to: morning, afternoon, night, or anytime';
COMMENT ON COLUMN participant_tasks.category 
  IS 'Task category for classification and invoice line item mapping';
COMMENT ON COLUMN participant_tasks.priority 
  IS 'Task priority level for scheduling and display purposes';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_participant_tasks_shift_type 
  ON participant_tasks (organization_id, shift_type, status);

CREATE INDEX IF NOT EXISTS idx_participant_tasks_category 
  ON participant_tasks (organization_id, category);

CREATE INDEX IF NOT EXISTS idx_participant_tasks_priority 
  ON participant_tasks (organization_id, priority);
```

---

### Migration 072: Evidence & Recurring Tasks
**File**: `backend/supabase/migrations/072_participant_tasks_evidence_recurring.sql`  
**Status**: ⏳ **PENDING** - Need to apply  
**What it does**: Adds evidence tracking and recurring task automation fields  
**Blocking**: Recurring task scheduling depends on these columns

```sql
-- Run this in Supabase SQL Editor
BEGIN;

ALTER TABLE public.participant_tasks
  ADD COLUMN IF NOT EXISTS evidence_required TEXT DEFAULT 'none'
    CHECK (evidence_required IN ('none', 'photo', 'notes', 'photo_and_notes')),
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS frequency_pattern TEXT
    CHECK (frequency_pattern IS NULL OR frequency_pattern IN (
      'every_morning_shift',
      'every_afternoon_shift',
      'every_night_shift',
      'daily_all_shifts',
      'specific_days_of_week',
      'custom'
    )),
  ADD COLUMN IF NOT EXISTS frequency_metadata JSONB;

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_participant_tasks_evidence_required 
  ON public.participant_tasks (organization_id, evidence_required) 
  WHERE evidence_required != 'none';

CREATE INDEX IF NOT EXISTS idx_participant_tasks_is_recurring 
  ON public.participant_tasks (organization_id, is_recurring) 
  WHERE is_recurring = true;

CREATE INDEX IF NOT EXISTS idx_participant_tasks_status_recurring 
  ON public.participant_tasks (organization_id, status, is_recurring);

-- Add comments for documentation
COMMENT ON COLUMN public.participant_tasks.evidence_required IS 
  'NDIS compliance: Type of evidence required (photo, notes, both, or none) for task completion';
COMMENT ON COLUMN public.participant_tasks.is_recurring IS 
  'Whether this task repeats on a schedule (true) or is one-off (false)';
COMMENT ON COLUMN public.participant_tasks.frequency_pattern IS 
  'Pattern for recurring tasks: every_morning_shift, every_afternoon_shift, every_night_shift, daily_all_shifts, specific_days_of_week, or custom';
COMMENT ON COLUMN public.participant_tasks.frequency_metadata IS 
  'JSON metadata for frequency (e.g. days_of_week: [1,3,5] for Mon/Wed/Fri, or custom schedule details)';

COMMIT;
```

---

### Migration 073: Invoicing & Task Instances
**File**: `backend/supabase/migrations/073_task_pricing_evidence_invoicing.sql`  
**Status**: ⏳ **PENDING** - Need to apply  
**What it does**: Creates 3 new tables for invoicing system + task instances  
**Blocking**: Invoice generation endpoints require these tables

**Tables created:**
- `task_completions` - Individual task completion records with evidence
- `invoices` - Invoice headers for billing
- `invoice_line_items` - Line items in each invoice
- `task_instances` - Recurring task instances from templates

```sql
-- PART 1: Add price tracking to tasks
ALTER TABLE public.participant_tasks
  ADD COLUMN IF NOT EXISTS price_item_code TEXT,
  ADD COLUMN IF NOT EXISTS effective_hourly_rate NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS recurrence_start_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_end_date DATE,
  ADD COLUMN IF NOT EXISTS recurrence_instances_created INTEGER DEFAULT 0;

-- PART 2: Create task_completions table
CREATE TABLE IF NOT EXISTS public.task_completions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID        NOT NULL REFERENCES public.participant_tasks(id) ON DELETE CASCADE,
    shift_id            UUID        REFERENCES public.shifts(id) ON DELETE SET NULL,
    participant_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    completed_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    completion_date     DATE        NOT NULL,
    completion_time     TIME,
    duration_minutes    INTEGER,
    evidence_type       TEXT        CHECK (evidence_type IN ('none', 'photo', 'notes', 'photo_and_notes')),
    evidence_photo_url  TEXT,
    evidence_notes      TEXT,
    evidence_verified   BOOLEAN     DEFAULT FALSE,
    verified_by         UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at         TIMESTAMPTZ,
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'submitted', 'verified', 'rejected')),
    price_item_code     TEXT        REFERENCES public.ndis_price_items(item_code) ON DELETE SET NULL,
    billed_amount       NUMERIC(10, 2),
    invoice_id          UUID        REFERENCES public.invoices(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PART 3: Create invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    participant_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    plan_id             UUID        REFERENCES public.ndis_plans(id) ON DELETE SET NULL,
    invoice_number      TEXT        NOT NULL UNIQUE,
    invoice_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    period_start        DATE        NOT NULL,
    period_end          DATE        NOT NULL,
    total_amount        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status              TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'finalized', 'sent', 'paid', 'overdue', 'cancelled')),
    created_by          UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    sent_date           TIMESTAMPTZ,
    paid_date           TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PART 4: Create invoice_line_items table
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          UUID        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    price_item_code     TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    support_category    TEXT,
    quantity            NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price          NUMERIC(10, 2) NOT NULL,
    total_price         NUMERIC(12, 2) NOT NULL,
    day_type            TEXT,
    time_type           TEXT,
    support_intensity   TEXT,
    task_ids            UUID[],
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PART 5: Create task_instances table (for recurring tasks)
CREATE TABLE IF NOT EXISTS public.task_instances (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_template_id    UUID        NOT NULL REFERENCES public.participant_tasks(id) ON DELETE CASCADE,
    participant_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    organization_id     UUID        NOT NULL REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
    scheduled_date      DATE        NOT NULL,
    scheduled_time      TIME,
    shift_type          TEXT        NOT NULL DEFAULT 'anytime',
    assigned_worker_id  UUID        REFERENCES public.users(id) ON DELETE SET NULL,
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'assigned', 'started', 'completed', 'cancelled')),
    completion_id       UUID        REFERENCES public.task_completions(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PART 6: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_task_completions_date 
  ON public.task_completions (organization_id, completion_date);
  
CREATE INDEX IF NOT EXISTS idx_task_completions_status 
  ON public.task_completions (status, evidence_verified);
  
CREATE INDEX IF NOT EXISTS idx_invoices_status 
  ON public.invoices (organization_id, status, period_start);
  
CREATE INDEX IF NOT EXISTS idx_invoices_participant 
  ON public.invoices (participant_id, period_start, period_end);
  
CREATE INDEX IF NOT EXISTS idx_task_instances_date 
  ON public.task_instances (organization_id, scheduled_date, shift_type);
  
CREATE INDEX IF NOT EXISTS idx_task_instances_status 
  ON public.task_instances (status, assigned_worker_id);
```

---

## 🚀 How to Apply Migrations

### Step 1: Go to Supabase Dashboard
1. Log in to [https://supabase.com](https://supabase.com)
2. Select your project
3. Go to **SQL Editor** (left sidebar)

### Step 2: Apply Each Migration (In Order)
1. Click **New Query**
2. Copy the SQL from one migration above
3. Paste into the editor
4. Click **Run** (or Ctrl+Enter)
5. Wait for "Success" message
6. Repeat for each migration (070 → 071 → 072 → 073)

### Step 3: Verify All Applied

Run this query to check:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('task_completions', 'invoices', 'invoice_line_items', 'task_instances');
```

**Expected output**: Should show 4 tables ✅

---

## ⚠️ Important Notes

1. **Apply in order** (070 → 071 → 072 → 073) - don't skip any
2. **Use IF NOT EXISTS** - safe to re-run if already applied
3. **Can't revert easily** - backup your database first if concerned
4. **No data loss** - all migrations use ALTER TABLE (preserves existing data)

---

## 🔗 After Migrations Applied

Once all 4 migrations are applied, you can:

1. **Load NDIS Pricing Data** (54 items)
   ```bash
   python load_ndis_pricing.py --org-email sarah@sunshine-demo.com
   ```

2. **Test Task Creation** with new fields
   - `shift_type: "morning"` ✅
   - `category: "personal_care"` ✅
   - `evidence_required: "photo_and_notes"` ✅
   - `is_recurring: true` ✅
   - `frequency_pattern: "every_morning_shift"` ✅

3. **Test Invoicing Endpoints** (all 10)
   - Task completion recording
   - Evidence verification
   - Invoice generation
   - Recurring task scheduling

---

## 📊 Migration Dependencies

```
Migration 070 (support_category)
    ↓
Migration 071 (shift/category/priority)
    ↓
Migration 072 (evidence/recurring)
    ↓
Migration 073 (invoicing tables + task_instances)
    ↓
✅ All systems ready
    ↓
Load pricing data
    ↓
Start testing invoicing workflow
```

---

## ✅ Verification Checklist

After applying all migrations, run these queries:

```sql
-- Check participant_tasks has all new columns
SELECT 
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '❌' END as participant_tasks_new_columns
FROM information_schema.columns
WHERE table_name = 'participant_tasks'
  AND column_name IN ('shift_type', 'category', 'priority', 'evidence_required', 'is_recurring', 'frequency_pattern', 'price_item_code');

-- Check invoicing tables exist
SELECT 
  CASE WHEN COUNT(*) = 4 THEN '✅ All tables exist' ELSE '❌ Missing tables' END
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('task_completions', 'invoices', 'invoice_line_items', 'task_instances');

-- Check indexes created
SELECT 
  CASE WHEN COUNT(*) > 0 THEN '✅ Indexes created' ELSE '❌ Indexes missing' END
FROM information_schema.statistics
WHERE table_name IN ('task_completions', 'invoices', 'task_instances');
```

---

**Everything is ready to apply. Start with Migration 070 and work through 073 in order.** ✅
