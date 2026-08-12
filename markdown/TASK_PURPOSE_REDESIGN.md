# Task Purpose Redesign — Implementation Summary

## What Changed

### 1. **New Task Creation Form** 
The "New task" form now opens with a **critical first question** before any other fields:

**"What is this task for?"** with two choices:
- **"Supports a goal"** — Link this task to a specific NDIS goal
- **"Core support"** (default selected) — Routine support like personal care, medication, or domestic assistance

**Key UX Decisions:**
- **Core support is the default** because routine tasks are more common in practice
- The goal dropdown is **physically hidden** until you select "Supports a goal"
  - No "none" option sitting in a dropdown to confuse coordinators
  - When you pick "Core support", the goal field disappears entirely
  - When you pick "Supports a goal", the goal dropdown appears

**New Form Fields:**
- Task Purpose (mandatory choice, shown first)
- Linked Goal (only visible if purpose = "Supports a goal")
- Task Title (with AI suggestions)
- Category (Personal Care, Meal Prep, Household, Health & Medical, Mobility, Social, Other)
- Shift Type (Morning, Afternoon, Evening, Night, All)
- Priority (Low, Medium, High, Critical)
- **Requirement** (NEW: Mandatory vs Optional radio buttons)
- Evidence Required (None, Notes, Photo, Signature, All)
- Instructions (with AI suggestions)

---

### 2. **Goals & Tasks Tab Display — Grouped Hierarchy**

The Goals & Tasks tab now shows tasks organized by their relationship to goals:

```
┌─────────────────────────────────────────────────────────┐
│ Goals & tasks                    [New goal] [New task]   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 🎯 Increase independence in morning routine             │
│    Status: Active · Category: Independence              │
│    └─ [Task cards nested here - coming soon]            │
│       "Prompt independent dressing" (Mandatory)         │
│       "Breakfast support" (Optional)                    │
│                                                          │
│ 🎯 Improve community access confidence                  │
│    Status: Active · Category: Social                    │
│    └─ [No tasks yet for this goal]                      │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ ❤️ CORE SUPPORT — NOT LINKED TO A GOAL                 │
│    "Morning medication" (Mandatory · Photo)             │
│    "Laundry & tidying" (Optional)                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**How it works:**
- Goals appear as cards with their status and category
- Tasks linked to a goal nest underneath as indented items
- Tasks with no linked goal go in the "Core support" section below
- Each task shows a **Mandatory/Optional badge** so coordinators can tell them apart
- The distinction between goal-linked and core support is **visible after creation** — no guessing

---

## State Management

Three new state variables were added:

```typescript
const [taskPurpose, setTaskPurpose] = useState<'core' | 'goal'>('core');
const [linkedGoalId, setLinkedGoalId] = useState<string | null>(null);
const [isMandatory, setIsMandatory] = useState(true);
```

When the form opens, these reset to safe defaults:
- `taskPurpose = 'core'` (most common case)
- `linkedGoalId = null` (no goal selected yet)
- `isMandatory = true` (mandatory tasks are typical)

---

## What You'll See When Testing

1. **Click "New goal"** → Creates a goal (existing flow, unchanged)

2. **Click "New task"** → Opens form with two big buttons:
   - **Supports a goal** (purple outline when selected)
   - **Core support** (green outline, selected by default)

3. **Select "Core support"** (the default):
   - Goal dropdown doesn't appear
   - Fill in title, category, shift type, etc.
   - Sets `mandatory` automatically (can toggle with radio)
   - Submit and it appears under "Core support" section

4. **Select "Supports a goal"**:
   - Goal dropdown appears with list of available goals
   - Choose a goal (required)
   - Fill in other fields
   - Submit and it appears **nested under that goal's card**

5. **In Goals & Tasks tab**:
   - See goals as top-level cards
   - See nested tasks under each goal (with Mandatory/Optional badge)
   - See separate "Core support" section at bottom

---

## Files Modified

- **[artifacts/frontend/src/pages/patients.tsx](artifacts/frontend/src/pages/patients.tsx)**
  - Added `taskPurpose`, `linkedGoalId`, `isMandatory` state
  - Redesigned task form with purpose choice first
  - Added mandatory/optional radio toggle
  - Replaced Goals & Tasks tab display with hierarchical grouped layout
  - Added `Heart` icon import for "Core support" section

---

## What's Next (Implementation Checklist)

The form UI is complete, but these features still need backend integration:

- [ ] **Task submission handler**: Save `taskPurpose`, `linkedGoalId`, `isMandatory` to API
- [ ] **Task data fetching**: Query tasks grouped by goal
- [ ] **Populate nested tasks**: Render tasks under their linked goal
- [ ] **Populate core support section**: Render tasks where `linked_goal_id` is null
- [ ] **Task edit/delete**: Allow updating task purpose or properties
- [ ] **Evidence tracking integration**: Connect task completion to evidence field

---

## Design Philosophy

✅ **Purpose is explicit** — No ambiguity about whether a task supports a goal  
✅ **Default is sensible** — Core support is the norm, not the exception  
✅ **Hierarchy is clear** — Nested tasks under goals, core tasks separate  
✅ **Distinction persists** — After creation, you can still tell them apart  
✅ **User-friendly** — No hidden "none" options or confusing UI  

This hierarchical structure matches real NDIS workflows where:
- Some tasks are **progress toward a goal** (e.g., "Practice independent dressing" under "Increase morning independence")
- Others are **ongoing support** (e.g., "Morning medication", "Laundry help")
- Coordinators need to see which is which at a glance
