# CareCliQ AppLayout & Navigation Refactor — Claude Code Prompt

> **How to use:** Open Claude Code in VS Code and paste this entire prompt, or save it as `APPLAYOUT_REFACTOR.md` and say: *"Read DESIGN_BRIEF.md, LAYOUT_BRIEF.md, and APPLAAYOUT_REFACTOR.md. Follow the sequence below. Start with Phase 1 audit before changing code."*

---

## Your role

Act as a frontend engineer fixing the **AppLayout chrome and primary navigation** to comply with DESIGN_BRIEF.md and implement the consolidated IA from LAYOUT_BRIEF.md. The problem: the current `src/components/layout/AppLayout.tsx` uses pink (`--cc-coral` / #E8457A) as a structural colour throughout the sidebar and top bar — nav borders, incident indicators, alert backgrounds, badge backgrounds, button text — which violates the brand handbook rule: **"Never use pink as a solid fill for large background sections."** Pink should appear only as accent (focus rings, links, small badges, active states), not in the chrome itself.

Your job: redesign the sidebar and top bar to be neutral chrome (cream/navy) with pink reserved for deliberate accents, implement the consolidated navigation (≤8 items), and build the reusable layout templates that all five archetypes will use.

## The two fixes this phase makes

**1. Chrome redesign (AppLayout.tsx).**
- Sidebar: cream background (`--cc-bg` / #FDF6EE), navy text/icons, subtle borders, one pink accent (active nav item gets a pink left border or pill highlight, not a full background).
- Top bar: near-white or very light cream, navy text/icons, soft shadows for separation, no pink elements except the logo.
- Nav structure: 13+ items → ≤8 top-level items (Dashboard, Participants, Team, Schedule, Quality, Invoices, Reports, plus footer Settings/Help/Accessibility).
- Remove: duplicate nav items between sidebar and top bar, incident badges in the chrome (move them to the page content where they belong), any full-width pink fills.
- Keep: the role-based logic, the search/quick-jump, notification/profile dropdowns, the collapse/expand toggle.

**2. Layout templates (new component library).**
Build five reusable layout components in `src/components/layout/templates/`:
- `OverviewTemplate.tsx` — dashboard shell: greeting + action queue + KPI strip + today panel (right rail on lg+, stacked below on smaller).
- `IndexTemplate.tsx` — list pages: header + filter bar + shared DataTable OR CardGrid + empty/skeleton states.
- `DetailTemplate.tsx` — record pages: identity header + routed tab bar + content + right context rail.
- `WorkflowTemplate.tsx` — forms & flows: centered column (max ~720px), step indicator, sticky footer bar (Back / Save draft / Continue), compliance feedback as collapsible side panel (desktop) or bottom sheet (mobile).
- `BoardTemplate.tsx` — dense surfaces: full-width, compact toolbar, internal scrolling board/calendar.

Each template:
- Accepts children and slot props (header, content, rail, footer, etc.).
- Includes built-in skeleton, empty state, and error state support.
- Uses only tokens from DESIGN_BRIEF.md (no hardcoded colours).
- Responsive rules baked in (the brief defines how each stacks on mobile).
- Is demonstrated on a `/design-system` reference page showing all states.

## Process — strict sequence

**Phase 1 — Audit & IA proposal (no code).**
1. List every file in `src/pages` with its current structure and destination archetype (e.g. `dashboard.tsx` → Overview, `team.tsx` → Index, `participant-detail.tsx` → Detail).
2. Propose the consolidated nav for each role (coordinator: 8 items max, worker: Dashboard/My Shifts/My Clients/My Compliance + footer, allied-health: their equivalent, MD: their equivalent).
3. Flag any pages that should be merged or deprecated (e.g. if Compliance and Audit Pack are both tabs of Quality, are their current pages deleted or kept as deep routes?).
4. Map any route renames that serve the IA (e.g. `/participants` instead of `/patients`; keep 301 redirects).
Show this in a markdown table and ASCII sitemap per role. Do not write code. Show me before proceeding.

**Phase 2 — AppLayout chrome refactor.**
1. Open `src/components/layout/AppLayout.tsx`.
2. Replace all `--cc-coral` / pink usage in the sidebar and top bar:
   - Sidebar: cream background, navy text, subtle grey borders (`--cc-border`). Active nav item: pink left border (3–4px) or a pink pill-shaped highlight, not a full background fill.
   - Top bar: near-white or very light cream, navy text/icons, soft shadow for separation. Logo sits in top-left. Global search / quick-jump in center. Notifications / actions inbox / profile in top-right. No pink.
   - Remove incident badges, alert backgrounds, and status indicators from the chrome — they belong on pages, not in the persistent layout.
3. Preserve all functionality: role-based nav, search, notifications, profile, collapse/expand, translations.
4. Test that the refactored AppLayout passes all role variants (coordinator, worker, allied-health, MD).
Show me a screenshot or component demo before proceeding.

**Phase 3 — Build the five layout templates.**
1. Create `src/components/layout/templates/OverviewTemplate.tsx`, `IndexTemplate.tsx`, `DetailTemplate.tsx`, `WorkflowTemplate.tsx`, `BoardTemplate.tsx`.
2. Each template:
   - Accepts children and named slots (header, content, rail, footer, etc.).
   - Wraps the app shell (AppLayout) once; pages are routed content inside.
   - Includes responsive behaviour per the brief (Overview: rail below on sm, Index: table → card list under md, Detail: tabs scroll on sm, Workflow: already single-column, Board: horizontal scroll on sm).
   - Has built-in skeleton, empty state, and error state support (page can pass `isLoading`, `isEmpty`, `hasError` props and the template renders them).
   - Uses only tokens; no hardcoded values.
3. Create a `/design-system` page (a simple index route or dedicated component) that shows all five templates with every state and a token reference guide (colours, fonts, spacing).
Show me the reference page and ask which template should be migrated first (recommendation: start with Overview / Dashboard).

**Phase 4 — Consolidate navigation (all roles).**
Implement the new nav structure in AppLayout.tsx:
- Coordinator: Dashboard | Participants | Team | Schedule | Quality | Invoices | Reports | [Settings/Help/Accessibility in footer].
- Worker: Dashboard | My Shifts | My Clients | My Compliance | [Settings/Help in footer].
- Allied-health: Dashboard | My Clients | My Sessions | My Compliance | [Settings/Help in footer].
- MD: Dashboard | Team | Reports | [Settings/Help in footer].
Ensure breadcrumbs appear on all pages below level 1, and all route renames include 301 redirects.

**Phase 5 — Migrate the demo path (dashboard + voice-to-note + compliance).**
This is your demo readiness step. Refactor the three pages Cauthan will show:
1. `coordinator-dashboard.tsx` → use OverviewTemplate + rebuild as Action Queue (not tabs).
2. `session-new.tsx` / `session-live.tsx` / `session-review.tsx` → use WorkflowTemplate for the full voice-to-note flow.
3. A compliance summary (TBD which page) → use an archetype (likely Detail or Overview-variant).
Report: tap counts, accessibility scan, mobile responsiveness test, and go/no-go for demo.

## What NOT to do

- Do not rename `AppLayout.tsx` or `PageShell.tsx` — extend them, don't replace them.
- Do not introduce new colours or tokens — work only with what DESIGN_BRIEF.md defines.
- Do not migrate all pages at once. Phase 5 is demo-path-only; the rest follows after the trial launches.
- Do not leave dead code. If a page is deprecated, delete it or mark it as archived.

## Definition of done (after Phase 5)

- AppLayout chrome is neutral: cream sidebar, near-white top bar, navy text, pink appears only as focused accent (active nav item, focus rings, links).
- Consolidated nav ≤8 items (coordinator), per-role variants implemented, breadcrumbs on all level-2+ pages, old routes redirect.
- Five layout templates built and demonstrated on `/design-system`; all states shown (loading, empty, error, normal).
- Demo path (dashboard, voice-to-note, compliance) migrated to templates, no more than 6 taps for the happy path, mobile-responsive, accessible.
- Remaining pages still use the old structure but can be migrated in Phase 6 after the trial is live.
