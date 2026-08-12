# CareCliQ AppLayout Refactor — eCourse-Inspired Structure with Ivory/Purple/Pink

> **Scope:** Redesign the persistent AppLayout (sidebar + top bar + right-rail) adopting the clean, organized structure of the eCourse design, with CareCliQ's final colour palette: Ivory background, Purple as primary accent, Pink as secondary accent.

> **Reference aesthetic:** The eCourse design shows a professional sidebar-first layout with a collapsible sidebar, clean top bar, and contextual right-rail. We adopt that structure and apply your brand colours: Ivory (`#F2EFDE`), Purple (`#6E79C2`), Pink (`#E8457A`), Dark Navy (`#2D2D3D`).

---

## 1. Overall frame anatomy

```
┌────────────────────────────────────────────────────────────────┐
│ TOP BAR (56px, sticky)                                         │
│ [Logo area] [Breadcrumb/Title] [Search] [Notifications] [Profile]
├──────────┬──────────────────────────────┬──────────────────────┤
│          │                              │                      │
│ SIDEBAR  │  MAIN CONTENT                │  RIGHT RAIL (lg+)    │
│ (220px)  │  (responsive width)          │  (280px, contextual) │
│ Collaps. │                              │  Sticky              │
│ to 64px  │  (one of 5 archetypes)       │                      │
│          │                              │  · Quick facts       │
│ Purple   │  Ivory background            │  · Today panel       │
│ accent   │  Dark navy text              │  · Action items      │
│ on       │  White/light cards           │  · Related info      │
│ active   │                              │                      │
└──────────┴──────────────────────────────┴──────────────────────┘
```

**Key structure:** Three-column layout on desktop (sidebar | content | rail), responsive collapse on tablet/mobile. Sidebar is collapsible with state persistence.

---

## 2. Sidebar (left, persistent, collapsible)

### Dimensions
- **Expanded width:** 220px.
- **Collapsed width:** 64px (icon-only rail).
- **Height:** full viewport minus top bar (56px).
- **Position:** fixed or sticky left edge.
- **Overflow:** scrollable if nav items exceed viewport.
- **Z-index:** 15 (below modals, above main content on mobile).

### Styling
- **Background:** Ivory `#F2EFDE`.
- **Right border:** 1px solid `#E0DDD0` (muted grey-ivory).
- **Shadow:** none (clean edge, border provides separation).
- **Text:** Dark navy `#2D2D3D`.
- **Icons:** Dark navy, 24px.

### Sections (top to bottom)

#### 1. Logo block
- **Height:** 56px (aligns with top bar).
- **Content:** CareCliQ logo + wordmark (expanded) or icon only (collapsed).
- **Padding:** 12px centered.
- **Alignment:** center horizontally and vertically.
- **Bottom border:** 1px solid `#E0DDD0`.
- **Background:** Ivory `#F2EFDE` (no tint change).
- **Typography:** Poppins Bold 16px, dark navy.
- **Logo size:** 32px square (icon), 140px full width (wordmark + icon).

#### 2. Main navigation items
**Properties (all items):**
- **Height:** 44px (tap-friendly, 12px padding vertical + 20px icon + 12px text).
- **Spacing:** 2px vertical gap between items.
- **Typography:** Inter Regular 13px (expanded), dark navy.
- **Icon spacing:** 12px left padding + 24px icon + 12px gap + label text.
- **Hover state:** background tint (purple `#6E79C2` at 8% opacity), text unchanged.
- **Active state:**
  - **Left border:** 4px solid purple `#6E79C2` (replaces 12px left padding).
  - **Background:** light purple tint (purple at 12% opacity).
  - **Text:** dark navy (unchanged).
  - **Icon:** dark navy (unchanged).
- **Collapsed state:** icon-only (24px), centered, no label, same height (44px).

**Coordinator nav items (example order):**
1. Dashboard (icon: LayoutGrid)
2. Participants (icon: Users)
3. Team (icon: UserCheck)
4. Schedule (icon: Calendar)
5. Quality (icon: ShieldCheck)
6. Invoices (icon: Receipt)
7. Reports (icon: BarChart3)
8. (vertical spacer, flex-grow).

#### 3. Footer zone (bottom of sidebar)
- **Top border:** 1px solid `#E0DDD0`.
- **Items:** Settings, Help, Accessibility.
- **Height per item:** 40px.
- **Spacing:** 8px vertical between items.
- **Typography:** Inter Regular 12px (expanded), dark navy.
- **Hover state:** purple background tint at 8% opacity.
- **Properties:** same as main nav items (icon spacing, active state, collapsed state).

#### 4. Collapse/expand toggle
- **Position:** bottom of sidebar, above footer (or integrated into footer area).
- **Height:** 40px.
- **Icon:** ChevronLeft (expanded) or ChevronRight (collapsed), 20px, dark navy.
- **Padding:** 12px centered within 40px area.
- **Background:** transparent, hover tint (purple at 8% opacity).
- **Interaction:**
  - Click → toggle sidebar width 220px ↔ 64px.
  - Animation: smooth 0.3s ease-in-out transition.
  - State: persisted in localStorage (`sidebar-collapsed` boolean).
  - Icon orientation changes to reflect state (← or →).

### Responsive behaviour

**Desktop (lg, ≥1024px):**
- Sidebar always visible, 220px or 64px (user can toggle).
- No drawer mode.

**Tablet (md, 640–1023px):**
- Sidebar visible, 220px or 64px (user can toggle).
- May collapse by default to 64px to save space.

**Mobile (sm, <640px):**
- Sidebar hidden by default.
- Trigger: hamburger menu icon (☰) in top bar left.
- Opens as a **drawer** (slide-in from left):
  - Width: 220px (full expanded).
  - Overlay: semi-transparent black (rgba(0,0,0,0.4)) behind drawer.
  - Close on: clicking overlay, pressing Escape, selecting a nav item, clicking close button.
  - No collapse to 64px on mobile (stays 220px in drawer).

---

## 3. Top bar (top, sticky)

### Dimensions & position
- **Height:** 56px.
- **Padding:** 12px horizontal, 8px vertical (3 + 4).
- **Position:** sticky top (z-index: 20, stays visible when scrolling page content).
- **Alignment:** flex row, space-between or space-around layout.

### Styling
- **Background:** off-white or very light ivory (`#FDFBF9`).
- **Bottom border:** 1px solid `#E0DDD0`.
- **Box shadow:** subtle 0 2px 4px rgba(0,0,0,0.04).
- **Text:** Dark navy `#2D2D3D`.

### Layout (left to right, three zones)

#### Left zone (flex: 0 0 auto, max 25%)
**Content:** Breadcrumb or page indicator.
- **Breadcrumb format:** `Participants > Amara K. > Sessions` (only on level 2+ pages).
- **Typography:** Inter 12px, dark navy text + purple `#6E79C2` links.
- **Separator:** ` > ` in dark navy.
- **Hover on link:** underline, colour unchanged.
- **Mobile (sm):** breadcrumb hides or compresses to just current page name.

#### Center zone (flex: 1 1 auto, 50%)
**Content:** Global search / quick-jump input.
- **Input style:** Inter Regular 13px, placeholder text in muted grey.
- **Input dimensions:** 8px top/bottom padding, 12px left/right padding, 32px height minimum (within 56px bar).
- **Input border:** 1px solid `#E0DDD0`.
- **Input background:** white.
- **Border radius:** 6px.
- **Left icon:** magnifying glass (Search icon, 16px, dark navy), inside input, 12px from left edge.
- **Right indicator:** "⌘K" in Inter 11px, muted grey, faint background pill (optional, omit on mobile).
- **Focus state:** border changes to purple `#6E79C2`, soft purple shadow (0 0 0 3px rgba(110,121,194,0.1)).
- **On focus:** opens quick-jump menu (existing component, no changes).

#### Right zone (flex: 0 0 auto, max 25%)
**Content (left to right):** notifications bell + profile avatar + dropdown.
- **Spacing between items:** 12px gap.
- **Spacing from right edge:** 12px.

**Notifications bell:**
- Icon: Bell from lucide-react, 20px, dark navy.
- Cursor: pointer.
- Interaction: click → opens popover with notifications (existing component, no changes to popover styling).
- Badge (if unread): red circle (`#EF4444`, functional status), 8px diameter, positioned top-right of icon.
- Show badge only if unread count > 0.

**Profile avatar + dropdown:**
- Avatar: 36px circle, user image or initials.
- Optional label: Poppins Medium 12px, dark navy, right of avatar (omit on mobile or if space tight).
- Interaction: click avatar → opens dropdown menu (below avatar).
- **Dropdown content:**
  - Profile settings
  - Org settings (if multi-org)
  - Switch role (if applicable)
  - Logout
- **Dropdown styling:**
  - Background: white.
  - Border: 1px solid `#E0DDD0`.
  - Box shadow: soft 0 4px 12px rgba(0,0,0,0.08).
  - Width: 200px.
  - Items: Inter 13px, dark navy, padding 12px.
  - Item hover: background tint (purple at 8% opacity).
  - Close on: click outside, Escape key, item selection.

### Responsive behaviour

**Desktop (lg):** All three zones visible, full width.

**Tablet (md):**
- Left zone: breadcrumb may compress or hide if space tight.
- Center zone: search remains visible, may be narrower.
- Right zone: notifications + profile visible, spacing tighter (8px).

**Mobile (sm):**
- Left zone: hamburger menu (☰) icon (20px, dark navy) triggers sidebar drawer. Optional logo or minimal brand indicator.
- Center zone: search becomes an icon (Search icon, 20px) that toggles a full-screen search overlay on tap (optional pattern; or search input remains but takes 70% of bar width).
- Right zone: notifications (bell) + profile avatar only; spacing tight (8px).

---

## 4. Right rail (contextual, lg breakpoint and up)

### Dimensions & position
- **Width:** 280px.
- **Position:** sticky right (scrolls independently from content).
- **Height:** full viewport minus top bar (56px), scrollable internally.
- **Z-index:** 10 (below top bar and sidebar).
- **Display:** hidden on md and below (display: none).

### Styling
- **Background:** Ivory `#F2EFDE` (matches sidebar, or very light purple tint: rgba(110,121,194,0.04)).
- **Left border:** 1px solid `#E0DDD0`.
- **Padding:** 16px.
- **Text:** Dark navy `#2D2D3D`.

### Widget structure (repeating pattern)

Each rail section is a "widget" — a card containing contextual information. Widgets are stacked vertically, spaced 12px apart.

**Widget container:**
- Background: off-white or very light ivory (`#FDFBF9`).
- Border: 1px solid `#E0DDD0`.
- Border-radius: 8px.
- Padding: 12px.
- Margin-bottom: 12px.

**Widget title:**
- Typography: Poppins Medium 12px, dark navy.
- Margin-bottom: 8px.
- No decoration (no icon, no border).

**Widget content:**
- Typography: Inter Regular 12px, dark navy (or muted grey for secondary text).
- Line-height: 1.5.
- Lists: no bullets; vertical spacing 4px between items.
- Links: purple `#6E79C2`, hover underline.

**Widget buttons:**
- Style: secondary (outline) or text-link.
- Typography: Inter Medium 12px.
- Padding: 6px 10px (compact).
- Border-radius: 4px.
- Border: 1px solid purple `#6E79C2` (if outline).
- Colour: purple text (if text-link) or purple border (if outline).
- Hover: background tint (purple at 8% opacity).

### Widget content per page archetype

#### Overview pages (Dashboard)
- **Widget 1: Quick stats**
  - Title: "This month" (optional, can omit title).
  - Content: 2–3 key metrics (simple key-value pairs).
  - Example: "Sessions: 24", "Compliant: 19", "At Risk: 5".

- **Widget 2: Today panel**
  - Title: "Today" + date (e.g. "Today, 8 Jul 2026").
  - Content: compact timeline of today's sessions/shifts.
  - Each item: time + participant + status chip.
  - Clickable items link to detail or open modal.

- **Widget 3: Upcoming actions**
  - Title: "Next 7 days" (optional).
  - Content: list of upcoming deadlines/renewals.
  - Example: "Amara K. screening expires in 5 days".
  - Links: each item is clickable, navigates to relevant detail page.

#### Detail pages (Participant, Worker, Session, etc.)
- **Widget 1: Quick facts**
  - Title: "Details" (or "Info").
  - Content: metadata table (key-value pairs).
  - Example: "Created: 8 Jul 2026", "Status: Active", "Plan expiry: 15 Sep 2026".
  - Styling: 8px padding per row, compact (no extra spacing).

- **Widget 2: Related items**
  - Title: "Related" (or "Links").
  - Content: list of related records with navigation links.
  - Example: "Active sessions: 3", "Assigned workers: 2".
  - All items are clickable links (purple).

- **Widget 3: Recent activity** (optional)
  - Title: "Activity" (or "Recent changes").
  - Content: feed of recent updates/notes.
  - Each item: timestamp + action + actor initials.
  - Example: "SM updated compliance status, 2 hours ago".

#### Index pages (Team, Participants list, Incidents, etc.)
- **Widget 1: Active filters** (if filters applied)
  - Title: "Filters" (or "Active filters").
  - Content: list of currently active filters.
  - Each filter: chip with "×" icon (removable).
  - Click chip → removes filter, updates list.

- **Widget 2: Export/actions**
  - Title: "Actions" (or "Export").
  - Content: buttons for Export to CSV, Print, Share (as applicable).
  - Button style: secondary (outline).

### Responsive collapse (md and below)

**Tablet (md, 640–1023px):**
- Right rail may be hidden or collapsed to a toggle button.
- Rail content moves below main content as a collapsible section.
- Toggle button: "Show details" or icon-only toggle.

**Mobile (sm, <640px):**
- Right rail hidden entirely.
- Rail content (Today, Quick facts) may appear in a bottom drawer or accordion below main content.
- Optional toggle: "Quick facts" or "More info" button at bottom of page.

---

## 5. Main content area (center, responsive)

### Dimensions
- **Desktop (lg):** width = viewport width - 220px (sidebar) - 280px (rail) = ~60% of viewport.
- **Tablet (md):** width = viewport width - 220px (or 64px if collapsed) = ~70–80% of viewport.
- **Mobile (sm):** width = viewport width = 100%.

### Styling
- **Background:** Ivory `#F2EFDE`.
- **Padding:** 24px (lg), 20px (md), 16px (sm).
- **Max-width:** none (fills available space).
- **Overflow:** scroll vertical only; never horizontal scrollbar.

### Content (per archetype)
- See CareCliQ_UI_Layout_Specification.md, Section 2, for page archetype anatomy (Overview, Index, Detail, Workflow, Board).
- Main content displays the active page; content scrolls independently from sidebar and rail.
- Page titles use Poppins Bold 24px, dark navy.
- Cards use Ivory/white backgrounds, 1px `#E0DDD0` borders, 12px border-radius, 20px padding.

---

## 6. Colour tokens (final, authoritative reference)

```css
--cc-ivory: #F2EFDE              /* All backgrounds: sidebar, page, rail, cards */
--cc-purple: #6E79C2             /* PRIMARY ACCENT: active nav border, focus rings, primary buttons, main links */
--cc-pink: #E8457A               /* SECONDARY ACCENT: subtle highlights, secondary buttons, tertiary links */
--cc-dark-navy: #2D2D3D          /* All text, icons, headings */
--cc-border: #E0DDD0             /* Borders, dividers, subtle edges */

/* Functional status colours (unchanged from existing spec) */
--cc-status-compliant: #10B981   /* Green, compliance/success */
--cc-status-risk: #F59E0B        /* Amber, warning/at-risk */
--cc-status-critical: #EF4444    /* Red, critical/error */
--cc-status-info: #3B82F6        /* Blue, informational */
```

**Application rules:**
- **Backgrounds:** use `--cc-ivory` for sidebar, page canvas, rail, and card backgrounds.
- **Text:** use `--cc-dark-navy` for all body text, headings, and icon fills.
- **Primary accent:** use `--cc-purple` for active nav left border (4px), focus rings (2px), primary button background (gradient optional), main navigation links.
- **Secondary accent:** use `--cc-pink` for subtle highlights, secondary buttons (outline), tertiary links, hover effects.
- **Borders:** use `--cc-border` for all dividing lines, card borders, subtle edges.
- **Status:** use functional colours (`--cc-status-*`) for compliance/incident/alert indicators; never use purple or pink for status.

---

## 7. Components & consistency

### Buttons

**Primary button (purple, main CTA):**
- Background: purple `#6E79C2`.
- Text: white, Inter Medium 13px.
- Padding: 10px 20px.
- Border-radius: 6px.
- Hover: opacity 0.9.
- Active: scale 0.98.
- One per screen max (exceptions: Workflow archetype footer may have multiple).

**Secondary button (outline, secondary action):**
- Background: transparent.
- Border: 1px solid purple `#6E79C2`.
- Text: purple `#6E79C2`, Inter Medium 13px.
- Hover: background tint (purple at 8% opacity).

**Tertiary button (text link):**
- Background: transparent.
- Text: purple `#6E79C2`, Inter Medium 13px, underline on hover.
- No border.

**Disabled state (all):**
- Opacity: 0.5.
- Cursor: not-allowed.

### Links

- **Colour:** purple `#6E79C2`.
- **Typography:** Inter Regular 13px (or inherit from parent).
- **Hover:** underline, colour unchanged.
- **Focus:** 2px solid purple outline (ring).

### Cards

- **Background:** off-white or very light ivory (`#FDFBF9`).
- **Border:** 1px solid `#E0DDD0`.
- **Border-radius:** 12px.
- **Padding:** 20px.
- **Box shadow:** 0 1px 3px rgba(0,0,0,0.06).
- **Hover (clickable cards):** border colour darkens slightly, shadow deepens.

### Status chips / badges

- **Compliant:** green background (`#10B981`), dark navy text, Inter Bold 11px, 24px height, 8px padding, border-radius 4px, uppercase.
- **At Risk:** amber background (`#F59E0B`), dark navy text.
- **Critical/Non-Compliant:** red background (`#EF4444`), white text.
- **Info:** blue background (`#3B82F6`), white text.
- **Never use pink or purple for status indicators.**

### Tables

- **Header row:** purple `#6E79C2` background, white text, Poppins Medium 12px, height 44px, sticky.
- **Data rows:** 48px height, Inter Regular 13px, dark navy text.
- **Zebra striping:** alternate rows with `#E0DDD0` at 0.2 opacity.
- **Row hover:** background tint (purple at 0.5 opacity).
- **Border-bottom between rows:** 1px `#E0DDD0`.
- **Sortable columns:** Poppins Medium 12px with ↑/↓ chevron (purple if sorted).
- **Status column:** functional colours (green/amber/red), never pink or purple.

### Forms & inputs

- **Label:** Inter Medium 12px, dark navy, above input.
- **Input field:** Inter Regular 13px, dark navy text, 10px vertical + 12px horizontal padding.
- **Input border:** 1px solid `#E0DDD0`.
- **Input border-radius:** 8px.
- **Input background:** white.
- **Placeholder:** muted grey.
- **Focus state:** 2px solid purple `#6E79C2` border (replaces 1px, so outline is ~3px total).
- **Disabled state:** background lighter, opacity 0.6, cursor not-allowed.
- **Error state:** border 1px solid red (`#EF4444`), error text below in red.

### Modals & popovers

- **Overlay:** semi-transparent black (rgba(0,0,0,0.4)).
- **Modal background:** off-white or very light ivory (`#FDFBF9`).
- **Border:** 1px solid `#E0DDD0`.
- **Border-radius:** 12px.
- **Box shadow:** 0 20px 25px -5px rgba(0,0,0,0.1).
- **Padding:** 24px.
- **Title:** Poppins Bold 18px, dark navy.
- **Content:** Inter Regular 13px, dark navy.
- **Close button:** top-right, icon-only, 20px, dark navy, transparent background, hover tint (purple at 8%).
- **Actions:** "Cancel" (secondary button) + "Confirm" (primary button, purple).

### Empty states

- **Icon:** optional, 64px SVG or emoji.
- **Headline:** Poppins Bold 16px, dark navy.
- **Message:** Inter Regular 13px, muted grey, one sentence.
- **Action button:** one primary button (purple) if applicable.
- **Example:** [icon] "No sessions today" [message] [button: "Schedule a session"]

### Loading skeletons

- **Match content type:** table rows, cards, etc.
- **Animation:** pulse (Tailwind `animate-pulse`).
- **Placeholder colour:** `#E0DDD0` at 0.4 opacity.
- **Dimensions:** match real content height/width.
- **Count:** 3–5 skeletons shown, staggered animation.

---

## 8. Accessibility (WCAG 2.1 AA)

- **Colour contrast:** all text meets 4.5:1 for body, 3:1 for large text.
- **Focus indicators:** 2px visible outline, purple `#6E79C2` on all interactive elements.
- **Keyboard navigation:** Tab cycles through interactive elements; arrow keys navigate sidebars/menus; Escape closes popovers/modals.
- **Touch targets:** minimum 44px (buttons, nav items, inputs).
- **Semantic HTML:** proper headings (h1–h6), labels on inputs, alt text on images.
- **ARIA labels:** menu items have `role="menuitem"`, tabs have `role="tab"` + `aria-selected`, buttons describe action.
- **Reduced motion:** respect `prefers-reduced-motion`; remove transitions, keep animations instant.
- **Screen reader support:** all icons have descriptive text or aria-label, status chips have text labels (not colour-only).
- **Language:** plain words, no jargon on worker-facing screens; sentence case; error messages explain the problem + how to fix it.

---

## 9. Implementation checklist

### Phase 1: AppLayout shell (no page migration yet)
- [ ] Sidebar: 220px width, Ivory background, dark navy text, 8 main nav items + footer (Settings/Help/Accessibility).
- [ ] Sidebar: active item has 4px purple left border + light purple tint (not full background).
- [ ] Sidebar: collapse/expand toggle at bottom, smooth 0.3s transition, state persisted in localStorage.
- [ ] Sidebar: collapses to 64px icon-only, labels hidden, icons centred, same 44px item heights.
- [ ] Sidebar mobile (sm): hidden by default, hamburger menu (☰) in top bar triggers drawer (220px, slide from left).
- [ ] Top bar: 56px height, sticky, light ivory/off-white background, 1px bottom border.
- [ ] Top bar left: breadcrumb (if level 2+), Inter 12px, dark navy + purple links.
- [ ] Top bar center: search input with ⌘K indicator, 32px height, purple focus border.
- [ ] Top bar right: notifications bell (badge if unread), profile avatar + dropdown.
- [ ] Top bar mobile (sm): hamburger menu + search icon (toggles overlay) + profile avatar.
- [ ] Right rail (lg+): 280px width, sticky, Ivory background, 1px left border, 1px border widgets.
- [ ] Right rail widgets: "Quick facts" / "Today" / "Related items" (page-specific).
- [ ] Right rail: purple links in widget content, hover underline.
- [ ] Right rail mobile (sm): hidden, content moved to bottom drawer or accordion.
- [ ] Main content: responsive width, Ivory background, proper padding (24px lg / 20px md / 16px sm).
- [ ] All spacing: 44px nav items, 12px widget padding, 16–24px content padding, 12px gaps.
- [ ] Accessibility: keyboard navigation, visible focus indicators (2px purple), 44px touch targets, ARIA labels.
- [ ] Responsive tested at: 1440px (lg), 800px (md), 375px (sm).

### Phase 2: Compliance Centre migration
- [ ] Migrate `src/pages/compliance.tsx` to new AppLayout.
- [ ] Sidebar: "Quality" item active.
- [ ] Top bar: breadcrumb "Compliance > Centre".
- [ ] Right rail: "Quick facts" widget with audit stats, "Today" widget with upcoming expirations.
- [ ] Main content: title + tabs (routed) + content sections (per CareCliQ_Compliance_Centre_Spec.md).
- [ ] Tab bar: 4 tabs, purple underline on active, sticky.
- [ ] Incidents tab: red badge with count.
- [ ] DataTables: purple header, 48px rows, sortable columns (purple chevron if sorted).
- [ ] Status chips: green/amber/red (never pink or purple).
- [ ] Three dots menu: Export, Refresh, Print, Share.
- [ ] Mobile tested: tabs scroll, tables horizontal scroll, rail content in bottom drawer.

### Phase 3: Other Detail pages (participant detail, worker detail, session detail, incident detail, settings)
- [ ] Each page uses new AppLayout.
- [ ] Right rail customized per page (Quick facts for that record).
- [ ] Tabs routed (URLs like `/participants/:id/overview`, etc.).
- [ ] Back button works (browser back).

### Phase 4: Index pages (team, participants list, incidents, billing, credentials, approvals, tasks)
- [ ] Each page uses new AppLayout.
- [ ] Right rail: "Active filters" widget if applicable, "Export/actions" widget.
- [ ] DataTables: purple headers, sortable, status chips (green/amber/red).

### Phase 5: Overview pages (dashboard, overview tabs)
- [ ] Dashboard uses new AppLayout.
- [ ] Right rail: "Quick stats", "Today", "Upcoming actions" widgets.
- [ ] Main content: KPI strip, Action Queue (replaces tabs), cards with proper spacing.

---

## 10. Before & after (visual summary)

### Current (problem state)
```
┌─────────────────────────────────────┐
│ PINK-HEAVY TOP BAR                  │
├─────────────────────────────────────┤
│ SIDEBAR (pink badges, 13+ items)    │ MAIN CONTENT (full width)
│ No collapsible option                │ No right context
│ Active = full pink background        │
│ Flat list, no hierarchy              │
└─────────────────────────────────────┘
```

### New (eCourse-inspired)
```
┌─────────────────────────────────────────────┐
│ CLEAN TOP BAR (search center, profile right) │
├──────────┬────────────────────┬──────────────┤
│ SIDEBAR  │ MAIN CONTENT       │ RIGHT RAIL   │
│ 220px    │ (responsive)       │ 280px        │
│ Ivory    │ Ivory background   │ Contextual   │
│ 8 items  │ White cards        │ Quick facts  │
│ Purple ← │ Dark navy text     │ Today panel  │
│ border   │                    │ Related info │
│ only     │                    │              │
│ Collapse │                    │              │
│ to 64px  │                    │              │
└──────────┴────────────────────┴──────────────┘
```

---

## 11. Git workflow

1. **Feature branch:** `feat/applaayout-refactor-ecourseinspired`.
2. **Phase 1 (AppLayout shell):** implement sidebar, top bar, right rail. Test all breakpoints.
3. **PR with screenshots:** lg desktop (sidebar 220px), lg desktop (sidebar 64px), md tablet, sm mobile. Include sidebar drawer (mobile). Include top bar search focus state (purple border).
4. **Merge to main** (Phase 1).
5. **Follow-up branches per phase:** `feat/compliance-centre-migration`, `feat/detail-pages-migration`, etc.

---

## 12. Additional notes

### Colour rationale
- **Purple primary:** aligns with the eCourse sidebar colour and feels more sophisticated, less aggressive than pink.
- **Pink secondary:** maintains brand recognition, used sparingly (links, subtle highlights) to avoid visual noise.
- **Ivory background:** warm, professional, easier on the eyes than bright white; softer than cream.
- **Dark navy text:** high contrast (WCAG AAA on ivory), readable for long form content and accessibility.

### Design priorities
1. **Clarity:** clean hierarchy, one primary action per screen, sidebar collapsible to reduce noise.
2. **Professional:** muted colours (ivory, purple, dark navy), soft shadows, generous padding.
3. **Accessible:** purple focus rings (24% larger, easier to see than default), 44px touch targets, semantic HTML.
4. **Mobile-first:** sidebar drawer, collapsible rail, responsive grids, full-width forms.

---

**Document version:** 2.0 (complete rewrite) · July 2026 · CareCliQ · CC Tech Australia Pty Ltd
