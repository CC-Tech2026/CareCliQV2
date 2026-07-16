# CareCliQ Structure & Layout Redesign — Claude Code Prompt (Phase 2)

> **How to use:** Save as `LAYOUT_BRIEF.md` in the repo root alongside `DESIGN_BRIEF.md`. Then tell Claude Code:
> *"Read DESIGN_BRIEF.md (visual system — already agreed) and LAYOUT_BRIEF.md (structure — this phase). Follow LAYOUT_BRIEF.md. Start with Phase 1 and show me the IA proposal before writing code."*

---

## Your role

Act as a senior product designer redesigning the **structure, information architecture, and layout** of CareCliQ (`artifacts/frontend`). The visual system (colours, tokens, typography) is already defined in `DESIGN_BRIEF.md` — do not revisit it. This phase is about *where things live, how pages are shaped, and how users move through the product*.

The stack is React + Vite + Tailwind + Radix/shadcn (`src/components/ui`), wouter for routing, with role-based navigation in `src/components/layout/AppLayout.tsx` (roles: `support_coordinator`, `support_worker`, `allied_health`, `managing_director`) and a `PageShell` layout primitive in `src/components/layout/PageShell.tsx`. Work with this stack — do not introduce new frameworks.

## Design philosophy for this product

CareCliQ is an operational tool used many times a day by busy care coordinators and support workers, many working in English as a second language. The structure must be **task-first, not data-first**: every screen should answer "what do I need to do?" before "what is the state of everything?". Optimise for: fewest clicks to the daily tasks, zero ambiguity about where something lives, and identical anatomy across pages so users only have to learn the product once.

## The 5 layout archetypes — the core of this redesign

Define exactly five page templates as reusable layout components. **Every page in `src/pages` must be refactored to use one of these five.** No page invents its own structure. Build them on top of the existing `AppLayout` + `PageShell`, extending those rather than replacing them.

### Archetype 1 — Overview (dashboards)
For: `dashboard.tsx` (all role variants), `hub` landing pages.
Anatomy, top to bottom:
1. **Greeting + date + role context** (compact, one line).
2. **Action Queue** — the hero of the page. A single prioritised list combining everything currently scattered across the pink AI banner, "Workers needing attention", credential alerts, flagged sessions, and pending approvals. Each row: severity indicator, plain-language description ("Haula's First Aid certificate expires in 12 days"), and one button that deep-links to the fix. Sorted by urgency. This replaces the dashboard-as-copy-of-every-page pattern.
3. **KPI strip** — 4 stat cards max, each clickable (navigates to its source page), each showing trend/delta where data exists. Cut vanity stats: a permanent "Incidents: 0" card earns its place only if incidents are non-zero — prefer contextual cards.
4. **Today panel** — today's sessions/shifts timeline (right rail on xl via `PageShell`, stacked below on smaller screens).
Remove the tab-stack (Team Compliance / Flagged / Incidents / Credentials / Training) from the dashboard entirely — those tabs duplicate dedicated pages. The dashboard links out; it does not replicate.

### Archetype 2 — Index (list pages)
For: `team.tsx`, `patients.tsx`, `sessions.tsx`, `incidents.tsx`, `my-shifts.tsx`, `my-clients.tsx`, `credentials.tsx`, `billing.tsx`, `approvals.tsx`, `tasks.tsx`, `reports.tsx`.
Anatomy:
1. **Page header row**: Poppins title + count, right-aligned single primary action ("New participant").
2. **Filter bar**: search input + filter chips/selects + view toggle where relevant (table/cards). Filters persist in the URL query string.
3. **The list**: one shared `DataTable` component (sortable columns, status chips, row click → detail, kebab menu for secondary actions) OR one shared `CardGrid` for people-centric pages. Pick per page, but only these two.
4. **Empty state** and **loading skeleton** built into the shared components — every list page gets them for free.

### Archetype 3 — Detail (single-record pages)
For: participant detail, `my-client-detail.tsx`, `session-detail.tsx`, `incident-detail.tsx`, `my-shift-detail.tsx`, team-member detail.
Anatomy:
1. **Identity header**: breadcrumb back-link, avatar/icon, name, key status chips, primary + secondary action buttons. Consistent height and structure across all detail pages.
2. **Tab bar** for the record's facets (e.g. participant: Overview / Plan & Goals / Sessions / Documents / Budget). Tabs are routes (`/patients/:id/sessions`) so they're linkable and the back button works.
3. **Content area** with **right context rail** (via `PageShell`): quick facts, related items, recent activity. The rail is the same width and style on every detail page.

### Archetype 4 — Workflow (focused create/edit flows)
For: `session-new.tsx`, `session-live.tsx`, `session-review.tsx`, `incident-new.tsx`, `participant-new.tsx`/`participant-edit.tsx`, onboarding pages, voice-to-note flow.
Anatomy: a **focus mode** — sidebar collapses to icon rail or hides, content is a single centred column (max ~720px), with a step indicator for multi-step flows, sticky footer bar with Back / Save draft / Continue, and an explicit exit that confirms unsaved changes. This is where CareCliQ's core magic (voice memo → compliant note in 30 seconds) happens, so it must be the most distraction-free, mobile-friendly surface in the product. The live compliance score/12-rule feedback appears as a persistent side panel (desktop) or expandable sheet (mobile) during note review — visible while editing, never blocking.

### Archetype 5 — Board (dense operational surfaces)
For: `coordinator-rostering.tsx`, `coordinator-live.tsx`, `coordinator-shift-verification.tsx`.
Anatomy: full-width (no max-width cap, no rail), compact toolbar row (date range, view switcher, filters), and the board/calendar/timeline itself owning the remaining viewport height with internal scrolling. Density is allowed here; whitespace rules relax deliberately.

## Navigation & information architecture

1. **Slim the coordinator sidebar.** Current: 13+ items in 5 groups. Target: ≤8 top-level items. Propose the consolidation in Phase 1 — a starting hypothesis to critique:
   - **Dashboard**
   - **Participants**
   - **Team** (absorbs Credentials and worker training/compliance views as tabs on Team + team-member detail)
   - **Schedule** (absorbs Rostering, Live Monitoring, Shift Verification as views/tabs of one scheduling surface)
   - **Quality** (absorbs Compliance, Incidents, Audit Pack as tabs — they share one job: "keep us audit-ready")
   - **Invoices**
   - **Reports**
   - Footer zone: Settings, Toolkit, Accessibility, Help.
   Deep pages stay as routes; they just stop being top-level nav noise. Adjust worker/allied-health/MD navs with the same consolidation logic (e.g. worker: Dashboard, My Shifts, My Clients, My Compliance, plus footer items).
2. **Top bar owns global, sidebar owns places.** Top bar: global search/quick-jump (⌘K command palette using the existing quick-jump), notifications, actions inbox, profile. Nothing page-specific lives in the top bar. Remove duplicate nav (e.g. Compliance/Rostering appearing both in top bar and sidebar — one home each).
3. **Breadcrumbs on every level-2+ page**, generated from the route, sitting above the page title.
4. **URL structure mirrors the IA.** Propose renamed routes where they mislead (e.g. `/patients` for a page labelled "Participants" — NDIS language matters to this audience; keep redirects for old routes).

## Cross-cutting structural rules

- **One primary action per page**, placed top-right of the page header in Archetypes 1–3, in the sticky footer in Archetype 4. Everything else is secondary/kebab.
- **Consistent spatial rhythm**: same page padding, same header height, same gap scale on every page (take values from `DESIGN_BRIEF.md` tokens).
- **Responsive behaviour per archetype**, defined once: Overview stacks rail below; Index tables become card lists under `md`; Detail tabs become a horizontal scroll; Workflow is already single-column; Board gets horizontal scroll with a sticky toolbar. The worker experience must be excellent on mobile — workers use this between sessions on their phones (check `worker-mobile` components and align rather than duplicate).
- **Decompose the monoliths.** `dashboard.tsx` (1,182 lines), `compliance.tsx` (701), `team.tsx` (652) must be broken into archetype template + small feature components. No page file over ~300 lines after refactor.
- **Skeletons, empty states, and error states are part of every archetype template**, not per-page afterthoughts. Empty states name the next action ("No sessions today — schedule one").

## Process — phases with check-ins

**Phase 1 — IA proposal (no code).** Map every file in `src/pages` to: (a) an archetype, (b) its place in the new nav, (c) any route rename. Produce this as a table plus an ASCII sitemap per role. Flag pages that should merge or die. Show me before coding.

**Phase 2 — Archetype templates.** Build the five layout templates as components (e.g. `src/components/layout/templates/`), each with header, content slots, rail slot, skeleton, and empty-state support. Add them to the `/design-system` reference page from Phase 3 of the visual refactor.

**Phase 3 — Navigation.** Implement the consolidated sidebar (all roles), top bar with command palette, and breadcrumbs. Keep old routes redirecting.

**Phase 4 — Page migration.** Migrate pages archetype-by-archetype: Overview first (rebuild the coordinator dashboard around the Action Queue), then Index pages, Detail pages, Workflows, Boards. Summarise each batch.

**Phase 5 — Walkthrough audit.** Trace the 5 most common journeys end-to-end and report friction: (1) coordinator morning triage → resolve a compliance flag, (2) worker records a session note by voice → review → submit, (3) coordinator rosters next week's shifts, (4) incident reported → reviewed → closed, (5) new participant onboarded. Fix what the walkthroughs expose.

At every phase, if existing behaviour or data constraints conflict with this brief, surface the trade-off and recommend before proceeding.

## Definition of done

- Every page in `src/pages` uses one of the five archetype templates; none defines its own bespoke structure.
- Coordinator sidebar ≤8 top-level items; each role's nav consolidated on the same logic; no duplicate nav entries between top bar and sidebar.
- Dashboard is an Action Queue + KPI strip + Today panel, with no duplicated page content; deep-links from every queue item.
- All record tabs are routed URLs; breadcrumbs everywhere below level 1; old routes redirect.
- No page file over ~300 lines; skeletons/empty/error states everywhere via the templates.
- The five key journeys in Phase 5 complete without dead ends, ambiguity, or layout inconsistency, on desktop and mobile.
