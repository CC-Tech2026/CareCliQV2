# Quick Testing & Validation Guide

## What Was Implemented This Session

✅ **Coordinator Notification Panel Enhanced**
- Search bar for text filtering
- Severity filter (4 levels)
- Combines filters together
- Filter toggle UI
- Panel width increased to fit controls

✅ **Worker Notification Sidebar (NEW)**
- Dedicated message panel for workers
- Same search + filter features as coordinators
- Mark as read functionality
- Auto-refresh every 15 seconds
- Notification bell in header

✅ **AppLayout Integration**
- Workers now see notification bell (not link to compliance)
- Clicking bell opens worker message panel
- Coordinators still have their notification panel

✅ **Plus: All Previous Sessions**
- Backend security fixes (3)
- Responsive design fixes (9 pages)
- Evidence chain-of-custody (staged, not deployed)
- Worker notification 500 error fixed
- Worker message endpoints created

---

## Quick Testing Checklist

### COORDINATOR - Testing Notification Filtering

**Setup:**
- Log in as coordinator
- Go to any page with the app header
- Look for Bell icon in top right header

**Test 1: Search Functionality**
- [ ] Click the bell icon → notification panel opens
- [ ] Type in search box (e.g., "emergency", "flag")
- [ ] Panel filters to matching notifications in real-time
- [ ] Clear search → shows all notifications again
- [ ] Search is case-insensitive

**Test 2: Severity Filter**
- [ ] Click the Filter icon button
- [ ] 5 tag buttons appear (All, Critical, High, Medium, Low)
- [ ] Click "Critical" → only critical severity notifications show
- [ ] Click "High" → only high severity notifications show
- [ ] Try "Medium" and "Low" filters
- [ ] Click "All" → shows all notifications again
- [ ] Selected filter has a colored ring around it

**Test 3: Combined Search + Filter**
- [ ] With severity filter active (e.g., "High")
- [ ] Type in search box (e.g., "shift")
- [ ] Shows only HIGH severity notifications matching "shift"
- [ ] Change to different severity → still shows filtered search results
- [ ] Clear search → shows all notifications in selected severity
- [ ] Change to "All" severity → shows all matches

**Test 4: Unread Count**
- [ ] Unread count in header reflects filtered results
- [ ] When all shown notifications are read, count shows 0
- [ ] Mark all read button only appears when unread > 0
- [ ] After marking all read, count goes to 0

**Test 5: Mark as Read**
- [ ] Click an unread notification → marks as read, dot disappears
- [ ] Unread count decreases
- [ ] Read notifications show at lower opacity (60%)
- [ ] Mark all read button clears all unread in filtered view

**Test 6: Filter Toggle**
- [ ] Click Filter icon → shows severity tags
- [ ] Click Filter icon again → tags disappear
- [ ] Filter button highlights when tags visible (SOFT background)

---

### SUPPORT WORKER - Testing Message Sidebar

**Setup:**
- Log in as support worker
- Go to any page with the app header
- Look for Bell icon in top right (changed from compliance link)

**Test 1: Panel Opens**
- [ ] Click bell icon → worker message panel opens on right
- [ ] Panel is 420px wide
- [ ] Has header with "Messages" title
- [ ] Has search box
- [ ] Has Filter button

**Test 2: Message Display**
- [ ] Messages show from coordinator
- [ ] Each message shows title, preview, severity, and time
- [ ] Severity colors: Red=Urgent, Orange=High, Blue=Medium, Green=Low
- [ ] Unread messages have dot indicator on right
- [ ] Unread badge shows count in header

**Test 3: Search in Worker Panel**
- [ ] Type in search box (e.g., message text)
- [ ] Filters to matching messages in real-time
- [ ] Search works on title AND message content
- [ ] Clear search → shows all messages

**Test 4: Severity Filter in Worker Panel**
- [ ] Click Filter button → severity tags appear
- [ ] Tags: All, Urgent, High, Medium, Low
- [ ] Click "Urgent" → shows only urgent messages
- [ ] Click different severities → filters work correctly
- [ ] Selected filter has colored ring

**Test 5: Mark as Read**
- [ ] Click unread message → marks as read, dot disappears
- [ ] Unread count in header decreases
- [ ] "Mark all read" button appears only when unread > 0
- [ ] After clicking "Mark all read", all dots disappear

**Test 6: Auto-Refresh**
- [ ] Leave panel open for 15 seconds
- [ ] If new message arrives, panel updates automatically
- [ ] No need to refresh manually

**Test 7: Responsive on Mobile**
- [ ] On mobile (390px), panel still opens
- [ ] Search and filter work on small screens
- [ ] Filter tags wrap to next line if needed
- [ ] No horizontal scroll needed

---

### INTEGRATION - Testing Between Pages

**Test 1: Worker Messages Link in My Shifts**
- [ ] Go to worker → My Shifts page
- [ ] Look for "Messages" button in header (next to Quick Start)
- [ ] On mobile: Shows bell icon only
- [ ] On tablet+: Shows "Messages" text + bell icon
- [ ] Click button → goes to /worker/messages page
- [ ] /worker/messages page shows messages in full-page view

**Test 2: Notification Bell in Header**
- [ ] Coordinator: Bell opens notification panel
- [ ] Worker: Bell opens message panel
- [ ] Both show unread count badge
- [ ] Badge shows "99+" when more than 99 unread

**Test 3: Backend Integration**
- [ ] Messages appear in worker panel
- [ ] Messages come from alerts table
- [ ] Mark as read updates database
- [ ] Search filters correctly on client side

---

### RESPONSIVE DESIGN - Testing All Sizes

**Coordinator Panel:**
- [ ] Mobile (390px): Panel visible, can scroll content
- [ ] Tablet (834px): Full 420px panel comfortable
- [ ] Desktop (1280px): Panel has good spacing
- [ ] Search bar usable on all sizes
- [ ] Filter tags wrap appropriately

**Worker Panel:**
- [ ] Mobile (390px): Panel opens, search works
- [ ] Tablet (834px): Messages readable, good padding
- [ ] Desktop (1280px): Full panel optimal
- [ ] Message text not cut off
- [ ] Severity colors visible clearly

**Messages Page (/worker/messages):**
- [ ] Mobile: Card-based layout stacked
- [ ] Tablet: Cards in grid
- [ ] Desktop: Full-width cards
- [ ] Tabs (All/Unread) work on all sizes

---

### PERFORMANCE - Testing Speed

**Test 1: Search Performance**
- [ ] Type in search box
- [ ] Filter appears instantly (no lag)
- [ ] Results update as you type
- [ ] No delay between keystroke and result

**Test 2: Filter Performance**
- [ ] Click severity filter
- [ ] Tags appear instantly
- [ ] Selecting tag filters instantly
- [ ] Combining search + filter is fast

**Test 3: Panel Open Speed**
- [ ] Click bell icon
- [ ] Panel slides in quickly (<200ms)
- [ ] Messages loaded and displayed

**Test 4: Auto-Refresh**
- [ ] Leave panel open 15 seconds
- [ ] Refresh happens silently in background
- [ ] No interruption to user interaction

---

### ACCESSIBILITY - Testing Keyboard & Screen Readers

**Test 1: Keyboard Navigation**
- [ ] Tab through search input
- [ ] Tab through filter button
- [ ] Tab through severity tags
- [ ] Tab through message rows
- [ ] Enter/Space clicks buttons
- [ ] All interactive elements reachable

**Test 2: Hover States**
- [ ] Buttons show hover state (opacity, bg color change)
- [ ] Message rows highlight on hover
- [ ] Filter tags highlight on hover
- [ ] All hover states visible

**Test 3: Color Contrast**
- [ ] Text readable on all backgrounds
- [ ] Severity colors distinct
- [ ] Badge colors contrast well

---

### ERROR HANDLING - Testing Edge Cases

**Test 1: Empty States**
- [ ] No notifications: Shows "All caught up" message
- [ ] Search matches nothing: Shows "No notifications match your filters"
- [ ] No messages (worker): Shows "No messages yet"

**Test 2: Loading States**
- [ ] Panel shows loading spinner while fetching
- [ ] Spinner appears briefly then disappears
- [ ] No error messages (unless actual error)

**Test 3: Network Issues**
- [ ] Mark as read fails gracefully (shows error if implemented)
- [ ] Search still works offline (client-side filtering)
- [ ] Panel closes cleanly on error

---

## What Each File Does

### NEW FILES CREATED

| File | Purpose |
|------|---------|
| `WorkerNotificationPanel.tsx` | Worker message sidebar component with search/filter |
| `worker-messages.tsx` | Full-page message inbox for workers |
| `evidence_access_service.py` | Backend: verify evidence downloads, check hashes |
| `049_evidence_chain_of_custody.sql` | Database: 2 tables, 13 indexes, 6 RLS policies |
| Documentation | 7 files explaining implementation details |

### MODIFIED FILES

| File | What Changed |
|------|--------------|
| `NotificationPanel.tsx` | Added search input, severity filter, "All" button, enhanced UI |
| `AppLayout.tsx` | Import worker components, show WorkerNotificationBell for workers |
| `coordinator.py` | Fixed 500 error (shift_id → session_id) |
| `worker.py` | Added /api/worker/messages endpoints |
| `my-shifts.tsx` | Added Messages button |
| `sessions.tsx` | Fixed role string comparison |
| `session-detail.tsx` | Fixed role string comparison |
| `compliance.tsx`, `coordinator-rostering.tsx`, etc. | Fixed responsive layout issues |

---

## Deployment Path

**Step 1: Code Review**
- [ ] Review frontend components (NotificationPanel, WorkerNotificationPanel)
- [ ] Review backend changes (coordinator.py, worker.py)
- [ ] Review database migration (049_evidence_chain_of_custody.sql)

**Step 2: Test in Dev**
- [ ] Run full test suite
- [ ] Test manually on staging
- [ ] Load test with realistic data

**Step 3: Deploy**
- [ ] Deploy backend code
- [ ] Deploy database migration
- [ ] Deploy frontend code
- [ ] Monitor error rates

**Step 4: Verify**
- [ ] All notification features working
- [ ] Search and filter responding
- [ ] Auto-refresh functioning
- [ ] No performance degradation

---

## Known Issues & Notes

### Pre-Existing
- 16 Pylance type warnings in sessions.py (not blocking)
- Some pre-existing responsive issues in other pages (not part of this session)

### This Session's Work
- All 9 responsive issues fixed (tested at 834px tablet)
- 1 security issue fixed (token storage)
- 2 role comparison issues fixed
- 1 organization lockout risk fixed
- 1 500 error fixed (shift_id → session_id)
- All code staged in git, not deployed

### Not Deployed Yet
- Evidence chain-of-custody (database + backend code)
- Worker message endpoints (backend tested, not live)
- Notification UI enhancements (frontend only, not deployed)

---

## Quick Fixes If Issues Found

| Issue | Fix |
|-------|-----|
| Search not working | Check useOrgQuery hook is imported |
| Filter not showing | Verify showFilters state toggle |
| Mark as read fails | Check API endpoint is responding |
| Panel won't open | Verify notifOpen/workerNotifOpen state |
| Wrong messages showing | Check org_id filter in query |
| Styles look wrong | Verify design token colors applied |
| Responsive broken | Check Tailwind breakpoints used correctly |

---

## Success Criteria

**✅ PASS if:**
- [ ] Coordinator can search notifications
- [ ] Coordinator can filter by severity
- [ ] Worker can open message panel
- [ ] Worker can search messages
- [ ] Worker can filter by severity
- [ ] Filters combine correctly
- [ ] Unread counts update
- [ ] Mark as read works
- [ ] Auto-refresh happens
- [ ] All responsive sizes work
- [ ] No console errors
- [ ] No TypeScript errors

**❌ FAIL if:**
- [ ] Any feature doesn't work as described
- [ ] Performance is slow
- [ ] Responsive breaks on tablet
- [ ] API returns 500 errors
- [ ] Unread count doesn't update

---

## Where to Check Results

**Coordinator Notification Panel:**
- URL: Any page in coordinator workspace
- Element: Bell icon in top-right header
- Location: Fixed slide-over from right edge

**Worker Message Panel:**
- URL: Any page in worker workspace
- Element: Bell icon in top-right header (NEW)
- Location: Fixed slide-over from right edge
- Alternative: /worker/messages page

**Full Page Message Inbox:**
- URL: /worker/messages
- For: Support workers
- Features: Tabs (All/Unread), severity colors, responsive design

---

## Questions?

Refer to:
- [NOTIFICATION_SIDEBAR_FILTERING.md](NOTIFICATION_SIDEBAR_FILTERING.md) - Feature docs
- [SESSION_2_5_NOTIFICATION_UI_SUMMARY.md](SESSION_2_5_NOTIFICATION_UI_SUMMARY.md) - Implementation details
- [WORKER_NOTIFICATIONS_IMPLEMENTATION.md](WORKER_NOTIFICATIONS_IMPLEMENTATION.md) - Notification architecture
- [IMPLEMENTATION_COMPLETE_CHECKLIST.md](IMPLEMENTATION_COMPLETE_CHECKLIST.md) - Complete status

All code is staged and ready for testing.
