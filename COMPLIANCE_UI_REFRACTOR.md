# CareCliQ Compliance Centre — Page Structure & Layout Specification

> **Scope:** This document defines the Compliance Centre page layout, tab structure, and actions menu (three dots) consistency. Apply this to `src/pages/compliance.tsx`.

---

## 1. Page anatomy

The Compliance Centre is a **Detail archetype** with four routed tabs. All tabs share the same frame and actions menu.

```
┌─ Breadcrumb (Compliance > Centre) ─────────────────────┐
├─ PAGE HEADER ─────────────────────────────────────────┤
│ Title: "Compliance Centre"                             │
│ Subtitle: "Audit readiness across your team and        │
│            participants · updated 8 minutes ago"       │
│ Right-aligned: [⋮] (three dots menu)                   │
├─ TAB BAR ─────────────────────────────────────────────┤
│ Overview | Staff compliance | Participant compliance | │
│ Incidents (2)                                          │
├─ SECTION 1 ───────────────────────────────────────────┤
│ [Content specific to each tab]                         │
├─ SECTION 2 ───────────────────────────────────────────┤
│ [Content specific to each tab]                         │
├─ SECTION 3 ───────────────────────────────────────────┤
│ [Content specific to each tab]                         │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Page header (consistent across all tabs)

### Title + subtitle block
- **Title:** "Compliance Centre" (Poppins Bold 24px, navy).
- **Subtitle:** "Audit readiness across your team and participants · updated 8 minutes ago" (Plus Jakarta Sans 13px, muted grey).
- **Layout:** Title on one line, subtitle on the next (allow wrapping).
- **Spacing:** 12px gap between title and subtitle.

### Actions menu (three dots / kebab)
- **Position:** top-right of the subtitle row, at the same vertical baseline as the title.
- **Icon:** three vertical dots (⋮) from `lucide-react` (`MoreVertical` or `EllipsisVertical`).
- **Button size:** 36px (square, to hit 44px tap target when styled).
- **Button style:** Ghost (transparent background, navy icon, hover tint).
- **Menu items** (when clicked):
  - Export compliance report (PDF)
  - Refresh data
  - Print this page
  - Share compliance status (link copy)
  - Archive compliance record (if applicable)
  - (Optional: Go to Audit Pack)
- **Menu styling:** Poppins Medium 13px, navy text, left-aligned items, 40px width min.
- **Hover:** background tint (--cc-border at 0.3 opacity).

---

## 3. Tab bar (routed, consistent across all tabs)

### Tab structure
- **Route pattern:** `/compliance/:tab` (or `/quality/compliance/:tab` if moving under Quality).
- **Tab names:**
  1. **Overview** → `/compliance` (default) or `/compliance/overview`
  2. **Staff compliance** → `/compliance/staff`
  3. **Participant compliance** → `/compliance/participants`
  4. **Incidents** → `/compliance/incidents` (with badge "2" or dynamic count)

### Tab styling
- **Tab text:** Inter Medium 13px, navy on inactive, navy on active (underline only changes).
- **Active indicator:** 2px solid pink (#E8457A) underline beneath the tab text.
- **Inactive tabs:** muted grey text, no underline.
- **Hover (inactive):** text darkens slightly, very subtle animation (0.2s transition).
- **Tab height:** 40px (includes padding).
- **Padding:** 12px left/right per tab.
- **Gap between tabs:** 4px (tight spacing).
- **Border-bottom:** 1px solid --cc-border (full width, runs under all tabs).

### Incident badge
- **Position:** next to "Incidents" tab text.
- **Size:** 20px diameter circle.
- **Background:** red (functional status colour, not pink) or amber if there are unreviewed incidents.
- **Text:** white, Nunito Bold 11px, centered count.
- **Rule:** only show if count > 0.

### Responsive behaviour (mobile)
- **sm breakpoint (<640px):** tabs stack horizontally but may require horizontal scroll if space is tight.
- Ensure tab bar remains sticky at the top when scrolling page content (see Section 4).

---

## 4. Tab bar stickiness + page scrolling

### Sticky tab bar
- The **tab bar sticks to the top** of the content area when scrolling (not the entire page — the title/subtitle scrolls off).
- **Implementation:** Tailwind `sticky top-[56px]` (below the app top bar at 56px height).
- **Background:** matches page background (cream --cc-bg) so content doesn't show through.
- **Shadow:** subtle 0 2px 4px rgba(0,0,0,0.06) when sticky (signals it's "floating").
- **z-index:** ensure tabs stay above page content (z-10 or z-20).

### Content scrolling
- Each tab's content scrolls independently below the sticky tab bar.
- On mobile, if content is short, no scroll needed; tab bar still sticky for consistency.

---

## 5. Tab-specific content (layout consistency rules)

### Overview tab
**Content sections (top to bottom):**

1. **KPI strip** (3–4 cards)
   - Card anatomy: label (Inter Medium 12px, muted) + large number (Nunito Black 36–48px) + optional chart/visual.
   - Cards: 4 per row on lg, 2 per row on md, 1 per row on sm.
   - Spacing: 16px gap between cards.
   - Examples:
     - "OVERALL SCORE" + donut chart + legend.
     - "NDIS AUDIT SCORE" + large number (80/100).
     - "AT-RISK REVENUE" + $490.
     - "CLAIM READINESS" + 13%.

2. **Urgent actions banner**
   - Background: very light pink tint (rgba(241,115,138,0.08)).
   - Left border: 3px solid amber/orange (not pink — functional status).
   - Title: "3 urgent actions require your attention today" (Poppins Bold 14px, navy).
   - Content: 3 action chips in a horizontal row, scrollable on mobile.
     - Each chip: icon + label + date.
     - Chip style: soft tint background, no border, 12px padding.
     - Click → deep-link to the specific item (e.g. click "Screening expiring" → goes to that worker's compliance detail).

3. **Most Common Issues section**
   - Card: title "Most Common Issues" (Poppins Medium 14px) + subtitle.
   - Content: list of issues with progress bars.
     - Row: issue name (Inter 13px) + progress bar (proportional length) + count (right-aligned, muted).
   - Spacing: 16px gap between rows.

4. **Budget Impact section**
   - Two stat cards side-by-side (lg), stacked (sm).
   - Left card: "AT-RISK REVENUE" + large red number + caption.
   - Right card: "CLAIM READINESS" + green percentage + caption.
   - Cards use functional status colours (red/green, not pink).

5. **Staff Compliance Snapshot**
   - Card title + subtitle.
   - DataTable (see Section 7 for table specs).
   - Columns: Worker | NDIS Screening | Avg Score | Status.
   - Rows: 3 visible, "View all staff compliance →" link at bottom.

6. **Participant Compliance Snapshot**
   - Card title + subtitle.
   - DataTable (see Section 7 for table specs).
   - Columns: Participant | Plan Status | Service Agreement | Note Quality | Flags | Status.
   - Rows: 3 visible, "View all participant compliance →" link at bottom.

7. **AI Detected Patterns**
   - Card title + subtitle.
   - Content: 2–3 pattern cards displayed horizontally (carousel on mobile).
   - Each pattern card: avatar + coordinator name (Poppins Medium 12px) + description text + "Dismiss" button.
   - Dismiss → removes the card, updates the pattern list (local state or backend call).
   - Background: functional colour tints (amber for coaching suggestions, purple for process reminders).

### Staff compliance tab
**Content sections (top to bottom):**

1. **KPI strip** (3–4 cards, matches Overview aesthetic)
   - "TOTAL WORKERS" + count.
   - "FULLY COMPLIANT" + count.
   - "CREDENTIALS EXPIRING" + count.
   - "ACTION REQUIRED" + count.

2. **Filter bar + search**
   - Search input: "Search workers..."
   - Filter dropdown: "All workers" (default shows all statuses; can filter by Compliant / Expiring soon / Action required).
   - View toggle (Table / Cards).

3. **DataTable** (see Section 7)
   - Columns: Worker | NDIS Screening | First Aid | CPR | Manual Handling | Medication Admin | Session Avg Score | Status.
   - Rows: sortable by column, hover highlights the row.
   - Row click → worker detail page (or open a modal).
   - Actions (kebab): Review, Flag, Send reminder, etc.

4. **Optional: warning banner**
   - If any screening expires in < 14 days, show a banner: "Screening renewal reminder" with an action button.

### Participant compliance tab
**Content sections (top to bottom):**

1. **KPI strip** (3–4 cards)
   - "TOTAL PARTICIPANTS" + count.
   - "SERVICE AGREEMENTS SIGNED" + count.
   - "NOTE QUALITY SCORE" + avg percentage.
   - "FLAGGED FOR REVIEW" + count.

2. **Filter bar + search**
   - Search input: "Search participants..."
   - Filter dropdown: status (All / Compliant / Review required / Action required).

3. **DataTable** (see Section 7)
   - Columns: Participant | Plan Status | Service Agreement | Note Quality | Flags | Status.
   - Rows: sortable, hover highlights.
   - Row click → participant detail page.
   - Actions (kebab): Review, Send notice, Flag, etc.

4. **Optional: warning banner**
   - If any service agreement is unsigned, show a reminder banner with a CTA.

### Incidents tab
**Content sections (top to bottom):**

1. **KPI strip** (2–3 cards)
   - "TOTAL INCIDENTS" + count.
   - "OPEN INCIDENTS" + count.
   - "RESOLVED THIS MONTH" + count.

2. **Filter bar + search**
   - Search input: "Search incidents..."
   - Filter dropdown: status (All / Open / Closed / Pending review).
   - Date range picker (optional).

3. **DataTable** (see Section 7)
   - Columns: Incident ID | Type | Reported by | Date | Status | Assigned to.
   - Rows: sortable, hover highlights.
   - Row click → incident detail page.
   - Actions (kebab): View, Reassign, Close, Mark reviewed, etc.

---

## 6. Consistency rules (apply to ALL tabs)

- **Header:** title + subtitle + actions menu on every tab.
- **Tab bar:** sticky, same styling on all tabs.
- **KPI strip:** consistent card styling, same spacing (16px).
- **DataTables:** same header style (navy bg), same row height (48px), same hover effect.
- **Spacing between sections:** 24px vertical gap (Tailwind `gap-6` or `mb-6`).
- **Card styling:** white/light cream background, 1px border, 12px border radius, soft shadow.
- **Padding within cards:** 20px.
- **Modals/popovers:** consistent styling per the main UI spec (Section 3.5 of CareCliQ_UI_Layout_Specification.md).

---

## 7. DataTable specs (for all tabs)

Apply this to every table in Compliance Centre.

### Header row
- Background: navy (#1A1A2E).
- Text: white, Poppins Medium 12px.
- Height: 44px.
- Padding: 12px left/right.
- Sticky (scrolls with content but stays at top of table).

### Data rows
- Height: 48px.
- Padding: 12px left/right, 8px top/bottom.
- Text: Inter Regular 13px, navy.
- Zebra striping: alternate rows with --cc-border at 0.2 opacity (very subtle).
- Hover: background tint (--cc-border at 0.5 opacity).
- Border-bottom: 1px solid --cc-border between rows.

### Status/severity columns
- Use functional colours (green for Compliant, amber for At Risk, red for Critical).
- Never use pink in the table data.
- Chips: 20–24px height, 8px padding, rounded-full, Nunito 11px bold.

### Actions column (rightmost)
- Three dots menu (kebab) or a "View detail" chevron.
- Click menu → opens popover with options (Review, Flag, Archive, etc.).
- Click chevron → navigates to detail page.

### Sorting
- Clickable column headers show a ↑/↓ chevron if sorted.
- Chevron colour: pink (#E8457A) when sorted.
- Chevron: right-align in the header cell.

### Empty state
- Placeholder row: "No [items] found. [Action]"
- Icon + message + one button (e.g. "Add participant").

### Loading skeleton
- Match table structure (rows, columns, same height as data rows).
- Animate pulse (no spinners).

---

## 8. Actions menu (three dots) — implementation

### Trigger
- Click the three dots (⋮) in the top-right of the page header.

### Menu rendering
- Popover (not a modal — stays local to the header).
- Opens downward, right-aligned with the button.
- Background: white, border 1px --cc-border, shadow soft.
- Width: 180px min.

### Menu items (standard, adjust per tab)
1. **Export compliance report** (PDF icon) → downloads PDF of the current tab.
2. **Refresh data** (refresh icon) → re-fetches from the API (show a spinner while loading).
3. **Print this page** (print icon) → opens browser print dialog.
4. **Share compliance status** (share icon) → copy a link to the clipboard, show toast "Link copied".
5. **(Optional) Go to Audit Pack** (if Compliance Centre is separate from Audit Pack).

### Menu item styling
- Text: Inter Medium 13px, navy.
- Icon: 16px, muted grey (left-aligned).
- Padding: 10px 12px.
- Hover: background tint (--cc-border at 0.3 opacity).
- Dividers: 1px --cc-border between logical groups (e.g. before "Export", before "Go to Audit Pack").

### Close menu
- Click outside the menu → closes.
- Press Escape → closes.
- Click an action → closes after the action completes.

---

## 9. Mobile responsiveness (sm breakpoint <640px)

### Tab bar
- Remains sticky but may scroll horizontally if all tabs don't fit.
- Wrap tabs in a horizontal scroll container if needed.

### KPI strip
- Stacks to 1 card per row (full width).
- Maintain 16px gaps.

### DataTables
- Reduce column count (hide less critical columns, or switch to CardGrid view if there's a toggle).
- Horizontal scroll on the table itself.
- Maintain 48px row height and 12px padding.

### Sections
- Maintain 24px vertical gap.
- Cards remain full width (no sidebars).

### Actions menu (three dots)
- Same trigger and content.
- Menu may need max-height and scroll if space is very limited (unlikely for this menu).

---

## 10. Accessibility (WCAG 2.1 AA)

- **Tab bar:** semantic `<Tabs>` component (or `<nav role="tablist">` with proper ARIA attributes).
- **Tab links:** `role="tab"`, `aria-selected`, `aria-controls`.
- **Keyboard navigation:** Tab key cycles through tabs, Arrow keys (left/right) move between tabs.
- **Focus indicator:** 2px solid pink (#E8457A) outline on focused tab.
- **Actions menu:** `role="menu"`, `role="menuitem"` on each menu item, Escape closes, focus management.
- **Tables:** semantic `<table>` with `<thead>`, `<tbody>`, `<th>`, `<td>`. Sortable headers have `aria-sort`.
- **Badges/chips:** descriptive labels (not just colour; include text like "Compliant" or "At Risk").
- **Links:** all links have visible :focus state, underline on hover.

---

## 11. Implementation checklist

- [ ] Breadcrumb: "Compliance > Centre" displayed above title.
- [ ] Page header: title + subtitle + actions menu (three dots), spacing correct.
- [ ] Tab bar: Overview | Staff compliance | Participant compliance | Incidents, routed, sticky.
- [ ] Incidents tab: badge shows count (only if > 0).
- [ ] Tab bar: pink underline on active, muted text on inactive, smooth transitions.
- [ ] Overview tab: KPI strip + urgent actions + common issues + budget impact + staff snapshot + participant snapshot + AI patterns (all sections present, spacing 24px).
- [ ] Staff tab: KPI strip + filter/search + DataTable with correct columns + sortable headers.
- [ ] Participant tab: KPI strip + filter/search + DataTable with correct columns.
- [ ] Incidents tab: KPI strip + filter/search + DataTable (status, dates, assigned).
- [ ] All DataTables: navy header, 48px rows, zebra striping, hover highlight, actions (kebab) per row.
- [ ] Actions menu: Export, Refresh, Print, Share, (optional Audit Pack) — all functional.
- [ ] Mobile (sm): tab bar scrollable, KPI cards stack, tables horizontal scroll, sections full width.
- [ ] Accessibility: semantic HTML, keyboard tab navigation, focus indicators, ARIA labels on menu.
- [ ] Empty states: per DataTable, with icon + message + CTA.
- [ ] Loading states: skeleton rows matching table structure, animated pulse.

---

**Document version:** 1.0 · July 2026 · CareCliQ · CC Tech Australia Pty Ltd
