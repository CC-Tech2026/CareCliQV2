# Notification Sidebar & Filtering Implementation

## Overview

Enhanced notification system for both coordinators and support workers with real-time filtering, search functionality, and improved UX.

## What's New

### 1. Coordinator Notification Panel - Enhanced with Filtering & Search

**File:** [artifacts/frontend/src/components/coordinator/NotificationPanel.tsx](artifacts/frontend/src/components/coordinator/NotificationPanel.tsx)

**Changes:**
- Added search bar for real-time text filtering (searches message + alert type)
- Added severity filter dropdown with 4 levels: Critical, High, Medium, Low
- Increased panel width from 380px to 420px to accommodate filters
- Each notification is mapped to a severity level based on alert_type
- Filter state controlled by showFilters toggle (Filter icon button)

**Severity Mapping:**
```
emergency          → Critical (Red #DC2626)
coordinator_flag   → High (Orange #F97316)
no_session_started → High
no_notes_recorded  → Medium (Blue #3B82F6)
shift_assigned     → Low (Green #10B981)
feedback_received  → Low
session_completed  → Low
```

**Features:**
- ✅ Real-time search with case-insensitive matching
- ✅ Severity filter with "All" option
- ✅ Combines filters (searches within severity filter results)
- ✅ Dynamic unread count updates based on filtered results
- ✅ Filter toggle button with visual state (highlighted when active)
- ✅ Filter tags with ring highlight for selected filter

### 2. Support Worker Notification Panel - NEW with Filtering & Search

**File:** [artifacts/frontend/src/components/worker/WorkerNotificationPanel.tsx](artifacts/frontend/src/components/worker/WorkerNotificationPanel.tsx) (NEW, 365 lines)

**Purpose:** Dedicated messaging interface for workers to receive coordinator messages

**Key Components:**

#### WorkerNotificationPanel()
- Main slide-over panel (420px width)
- Shows messages from coordinator
- Auto-refresh every 15 seconds (refetchInterval: 15000)
- Features:
  - Real-time search by message title or content
  - Severity filter dropdown (urgent, high, medium, low)
  - Mark individual message as read
  - Mark all unread messages as read
  - Unread count badge in header
  - Collapsible filter UI (toggle with Filter icon)
  - Empty state handling (no messages vs no matches)
  - Loading spinner

#### WorkerNotificationBell()
- Header icon component showing unread count badge
- Triggers WorkerNotificationPanel on click
- Updates every 30 seconds for header-level awareness
- Shows "99+" if more than 99 unread

**API Endpoints Used:**
- `GET /api/worker/messages` - Fetch all/unread messages
- `POST /api/worker/messages/{message_id}/read` - Mark as read

**Message Structure:**
```typescript
interface WorkerMessage {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  severity: "urgent" | "high" | "medium" | "low";
  is_read: boolean;
  created_at: string;
}
```

### 3. AppLayout Integration

**File:** [artifacts/frontend/src/components/layout/AppLayout.tsx](artifacts/frontend/src/components/layout/AppLayout.tsx)

**Changes:**
- Added import: `WorkerNotificationBell, WorkerNotificationPanel`
- Added state: `workerNotifOpen` to track worker notification panel visibility
- Updated header section to show `WorkerNotificationBell` for workers (instead of just link to compliance)
- Added render of `WorkerNotificationPanel` when `workerNotifOpen` is true
- Workers now have full notification sidebar experience like coordinators

**Header Behavior:**
- **Coordinators:** Click bell → coordinator notification panel with filtering/search
- **Workers:** Click bell → worker notification panel with filtering/search

## Responsive Design

Both panels are responsive:
- Desktop: 420px fixed width slide-over from right
- Tablet (834px+): Full 420px panel displayed
- Mobile: Requires scroll/swipe (max-w-full respects viewport)
- Panel can be closed by clicking backdrop or X button

## Search Functionality

### Coordinator Search
- Searches notification message text (case-insensitive)
- Searches alert_type (e.g., "emergency", "flag", "session")
- Real-time filtering (no debounce needed, small dataset)

### Worker Search
- Searches message title (case-insensitive)
- Searches message content
- Real-time filtering

## Severity Filters

### Coordinator Severity Levels
- **Critical** (Red): emergency alerts
- **High** (Orange): coordinator flags, no session started warnings
- **Medium** (Blue): note recording reminders
- **Low** (Green): shift assignments, feedback, completions

### Worker Severity Levels
- **Urgent** (Red): Most important coordinator messages
- **High** (Orange): Important updates
- **Medium** (Blue): Standard information
- **Low** (Green): General notices

## UI Components

### Filter Toggle
- Icon button with Filter icon
- Highlights (background changes to SOFT color) when filters are shown
- Clicking toggles filter panel visibility

### Severity Tags
- Individual button for each severity level + "All" option
- Selected tag gets 2px ring highlight in the tag's color
- Unselected tags show at 60% opacity (hover increases to 100%)
- Clicking tag toggles filter or clears if already selected

### Search Input
- Placeholder text matches role (coordinators vs workers)
- Search icon on left
- Real-time onChange handler updates search query
- Focus ring uses PLUM color

### Unread Count Badge
- Shows in header next to "Messages" or "Notifications" title
- Shows count of unread messages in filtered results
- Red background (CORAL) with white text
- Only shows when unread > 0

### Mark All Read
- Button appears only when unread > 0
- Triggers mutation to mark all messages as read
- Reruns query after completion

## Performance Considerations

- **Search & Filter:** useMemo dependency on alerts, searchQuery, severityFilter prevents unnecessary recalculations
- **API Calls:** Refetch intervals avoid aggressive polling (15s user panel, 30s header badge)
- **Mutations:** onSuccess invalidates queries to maintain UI sync

## Testing Checklist

### Coordinator Filtering
- [ ] Search by message text works
- [ ] Search by alert type works
- [ ] Severity filter by Critical filters correctly
- [ ] Severity filter by High filters correctly
- [ ] Severity filter by Medium filters correctly
- [ ] Severity filter by Low filters correctly
- [ ] Combine search + severity filter works
- [ ] "All" button clears severity filter
- [ ] Filter toggle shows/hides filter UI
- [ ] Unread count updates when filtered
- [ ] Mark all read marks all filtered messages as read
- [ ] Empty state shows correct message (no messages vs no matches)

### Worker Messaging
- [ ] Messages panel opens on bell click
- [ ] Messages load from /api/worker/messages
- [ ] Search by title works
- [ ] Search by content works
- [ ] Severity filter works (all 4 levels)
- [ ] Click message marks as read
- [ ] Unread dot disappears when marked read
- [ ] Mark all read button works
- [ ] Unread count in header updates
- [ ] Panel closes on backdrop click
- [ ] Panel closes on X click
- [ ] Auto-refresh every 15s works

### Responsive Design
- [ ] Tablet (834px): Both panels render correctly
- [ ] Mobile (390px): Panels respect max-w-full
- [ ] Desktop (1280px): Full 420px panels display
- [ ] Search input is usable on all sizes
- [ ] Filter tags wrap on mobile
- [ ] Scroll behavior works for long lists

## Code Quality

- ✅ TypeScript types: Fully typed (Message, Alert interfaces)
- ✅ Lucide icons used consistently
- ✅ Design tokens applied (PLUM, CORAL, TEXT, MUTED, BORDER, SOFT)
- ✅ Accessibility: hover states, keyboard accessible buttons
- ✅ Error handling: Loading states, empty states, error messages
- ✅ Performance: useMemo for filtering, mutation optimization
- ✅ Mobile-first responsive design

## Files Modified/Created

### Created (NEW)
1. **WorkerNotificationPanel.tsx** (+365 lines)
   - Worker message management component
   - Includes search and severity filtering
   - API integration for fetch/read operations

### Modified
1. **NotificationPanel.tsx** (+150 lines)
   - Added search input
   - Added severity filter dropdown
   - Enhanced header with filter controls
   - Increased width to 420px
   - Added SEVERITY_LEVELS constant

2. **AppLayout.tsx** (+4 lines)
   - Import WorkerNotificationBell and WorkerNotificationPanel
   - Add workerNotifOpen state
   - Update bell header to use WorkerNotificationBell for workers
   - Render WorkerNotificationPanel when workerNotifOpen

## Integration Points

### For Coordinators
1. NotificationBell in header triggers NotificationPanel
2. Click within panel marks individual notifications as read
3. Search and filter work on coordinator-specific alert types

### For Workers
1. WorkerNotificationBell in header shows message count
2. Click bell triggers WorkerNotificationPanel
3. Messages from coordinators appear with severity levels
4. Can search and filter their messages
5. Message link in my-shifts.tsx also available for quick access

## Future Enhancements

- [ ] Persistence: Remember last selected filter between sessions
- [ ] Bulk actions: Select multiple messages for batch operations
- [ ] Message categories: Filter by message source (shift, client, etc.)
- [ ] Message templates: Coordinator quick-send templates
- [ ] Read receipts: Show when worker read coordinator message
- [ ] Delivery status: Show pending/sent/read states
- [ ] Archive: Move messages to archive instead of delete
- [ ] Notification sounds: Optional audio alert for new messages
