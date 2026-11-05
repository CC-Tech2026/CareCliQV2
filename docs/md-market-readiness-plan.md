# Managing director: market-readiness and workflow redesign plan

Review date: 5 November 2026 (Australia/Adelaide)

## Scope and confidence

This is a source-code product/workflow review of the current director experience. It is not a live usability test, security assessment or regulatory certification. Findings below distinguish what is visible in the implementation from changes proposed for validation. No production records were reviewed and no application behaviour was changed by this audit.

Audience assumption: a provider director overseeing coordinators, support workers, participants and multiple branches. Coordinators run routine operations; directors manage exceptions, approvals, resources and organisational outcomes.

## Recommendation

Organise the product around decisions and handoffs before redesigning individual dashboards. The first release should let a director answer four questions quickly:

1. What needs my decision today?
2. Who owns the next action, and when is it due?
3. Can we safely deliver the scheduled support?
4. What is approved, billable, overdue or blocked?

Keep operational work with the responsible coordinator where possible. Provide the director with context, an accountable owner, an escalation path and the evidence needed for a decision.

## Findings grounded in the current code

| Area | Current evidence | Redesign implication |
| --- | --- | --- |
| Navigation | `HubLayout.tsx` has grouped director navigation, nested tabs, a navigation drawer and alternative floating/bottom navigation presentations. `AppLayout.tsx` maintains another director navigation definition with different labels. | One shared navigation model and one default desktop presentation. Validate consistency when entering shared coordinator pages. Preserve existing deep links. |
| Home versus performance | `MDHubView.tsx` contains setup, capacity, participants, workforce, documentation, trends and finance. `md/executive.tsx` separately presents organisation performance and governance triage. | Home should prioritise daily decisions; Performance should own trends and longer-term analysis. Reduce repeated summaries rather than deleting useful data. |
| Alert handoff | `GovernanceTriage.tsx` already has useful record-specific destinations. Some fallback links open a broad workspace. | Keep the deep-link work. Every actionable item should land on the relevant record, retain filters and offer a return to its originating queue. |
| Documentation review and approval | Navigation separates `/sessions`, `/session-review` and `/coordinator/verification`. The verification page describes approving shifts for billing. | Make documentation quality, shift approval and billing eligibility distinct states in one understandable journey. Confirm backend semantics before consolidating screens. |
| Participant journey | Participants navigation enters `/onboard-participant/active`; profile links also use `/patients`. Onboarding workspace switches staff and participant areas. | Establish one Participants entry and a clear transition from intake to active service. Avoid making an active participant look like an onboarding record. |
| Workforce journey | Staff overview, Team/invites, staff onboarding, training and matching tags have separate destinations. | Keep specialist tools, but expose one staff lifecycle and a visible readiness-to-roster summary. Move tags into workforce settings. |
| Compliance and evidence | Compliance already groups quality, evidence overview, checklist and audit packs; the vault is separately navigable. | Build on that consolidation. Explain the relationship between requirement, evidence document, review status and export. A score alone must not imply all evidence is approved. |
| Delivery quality | `service-delivery.tsx` groups shift coverage, participant contact and documentation follow-up, with URL-based filters. | Preserve shareable filters. Decide whether each item is a director escalation or a coordinator work item; avoid another duplicate inbox. |
| Finance | Financial governance, billing, shift verification and travel claims are separate navigation entries. Financial data models distinguish billed, collected, wages, overheads and completeness. | Present a connected approval-to-payment workflow. Preserve unknown/incomplete figures rather than displaying misleading zeroes or confident margins. |
| Visual foundation | `PageKit` and semantic colour tokens already support shared headings, summaries, surfaces and error states. | Reuse these foundations. Avoid a second design system or decorative icon tiles across every section. |

Source paths are under `artifacts/frontend/src/`: `components/layout/HubLayout.tsx`, `components/layout/AppLayout.tsx`, `components/layout/PageKit.tsx`, `components/hub/MDHubView.tsx`, `components/hub/GovernanceTriage.tsx`, and the `pages/md/` files named above. Review routing in `App.tsx` before moving or retiring any destination.

## Proposed information architecture

Use one persistent sidebar on desktop, with a compact drawer on smaller screens. Do not make primary navigation depend on hover. Secondary tools belong inside their workspace, not in a competing global dock.

| Main destination | Purpose | Secondary views |
| --- | --- | --- |
| Overview | Decisions, escalations and today's operational exposure | Needs attention; awaiting others; recently resolved |
| Participants | From enquiry to active support and service closure | Intake; active; paused/closed; participant profile |
| Workforce | Who is ready, available and appropriately assigned | Staff; applicants/onboarding; credentials; training; invites |
| Operations | Deliver scheduled support and resolve exceptions | Roster; live shifts; coverage gaps; delivery quality |
| Approvals | One entry for decisions requiring an authorised reviewer | Shift sign-off; requested corrections; travel; approved history |
| Finance | Understand money and progress approved work to payment | Overview; invoices/claims; collections; exceptions |
| Quality & risk | Track incidents, complaints, evidence and follow-up | Incidents/complaints; requirements; evidence checklist; audit packs |
| Reports | Review trends and export information | Performance; service outcomes; workforce; finance |
| Settings | Organisation configuration, not daily work | Branches; permissions/delegation; matching tags; import; templates |

Documents remain reachable through records and Quality & risk. A global document search can stay available without making the vault another daily action queue. Keep branch, date range and organisation context visible where they affect results.

This is a proposed structure, not a requirement to build nine new pages. Reorganise existing destinations and reuse existing components first.

## Workflow blueprints

### Daily director workflow

Open Overview -> inspect prioritised decisions -> open the exact record -> review evidence/context -> approve, request changes or assign/escalate -> see confirmation and next owner -> return to the same filtered queue.

Each work item should show: subject, reason, priority, accountable owner, due date, age, current state and a specific next action. Count unique items rather than repeating the same issue in several cards. Separate "needs my decision" from "waiting on someone else".

### Participant intake to first service

Enquiry -> intake in progress -> readiness checks complete -> authorised activation -> coordinator assigned -> suitably matched worker -> first shift scheduled -> first visit reviewed -> active support.

Readiness checks should expose the organisation's configured requirements, responsible reviewer, outstanding items and documented exceptions. Do not invent statutory requirements in the UI. Preserve consent, agreement and plan evidence on the participant record; verify the existing backend rules before adding any new gate.

### Staff onboarding to deployment

Applicant/invite -> onboarding -> required checks/credentials/training -> reviewer decision -> ready to roster -> assigned shifts -> ongoing expiry/performance follow-up -> suspension or exit.

Separate account activation, employment/onboarding status and readiness for a particular shift. A single green "active" badge should not stand in for all three. Explain exactly what blocks an assignment and who can resolve it.

### Completed shift to payment

Scheduled -> in progress -> submitted -> awaiting reviewer -> changes requested OR approved -> eligible for billing -> invoiced/claimed -> paid OR payment exception.

Requested changes -> worker response -> resubmitted -> reviewer decision. Past approved shifts stay locked for workers. Any exceptional office correction must preserve the original record, reason, actor and audit trail. Define whether changes require reapproval and affect an existing invoice before implementation.

Use "Approved" consistently in worker-facing summaries. Distinguish documentation quality scores from the accountable person's approval decision. Confirm what "verified" means in the existing backend instead of renaming stored states without a migration plan.

### Incident or complaint resolution

Reported -> triaged -> owner assigned -> immediate action -> investigation/follow-up -> reviewer sign-off -> closed -> effectiveness check where applicable.

The director needs outstanding actions and escalation context. Detailed investigation work can stay with the assigned officer. Validate regulatory/reporting requirements separately with the organisation's responsible specialist.

### Evidence to audit pack

Requirement -> supporting evidence linked -> reviewed -> gaps assigned -> resolved -> export prepared -> authorised sharing -> access expiry/revocation.

Show what is missing, outdated or awaiting review. Keep export scope, date and included records explicit. Validate actual export contents and sharing permissions with representative test accounts.

## Prioritised backlog

Priorities below are proposed release priorities, not claims that every listed capability is currently absent.

| Priority | Work package | Definition of done |
| --- | --- | --- |
| P0 | Agree lifecycle/state vocabulary | One documented state/transition matrix for participant, staff, shift, review and invoice; actors and reopening rules are explicit. |
| P0 | Verify complete approval-to-billing flow | A seeded test shift can be submitted, returned, resubmitted, approved and billed. Worker access closes at the correct transitions; duplicate billing is prevented. |
| P0 | Verify permissions and branch/org scope | Director, delegated coordinator and worker accounts cannot see or mutate another organisation's records or bypass approval restrictions through a direct URL/API. |
| P0 | Make missing and failed data unmistakable | Failed requests, empty data, stale results and zero values have distinct displays on decision-making screens. |
| P1 | Unify navigation | One shared definition; stable labels and selected states; keyboard-accessible navigation; old links redirect correctly; browser Back retains context. |
| P1 | Redesign Overview as a decision queue | Prioritised items have owner, reason, due date and a record-specific action; metrics link to their source; repeated alerts are consolidated. |
| P1 | Create an Approvals entry | Reviewers understand what they are approving, evidence supporting it, requested corrections and downstream billing effect. |
| P1 | Organise participant and workforce lifecycles | A user can identify current stage, blockers, accountable person and next step without visiting unrelated tools. |
| P1 | Reconcile operational exceptions | Coverage, documentation and delivery-quality items have a clear owner and escalation path; the same item is not independently closed in different queues. |
| P2 | Rationalise reporting | Timeframe, branch, definitions, data completeness and export context are visible. Trends stay out of the daily decision queue unless they require action. |
| P2 | Standardise presentation | Shared page headings, filters, table actions, detail panels, confirmations and status wording; reduce ornamental cards and icon clusters. |
| P2 | Improve first-organisation setup | Guided setup reaches first participant, ready worker, rostered shift and completed approval without dummy data being mistaken for real records. |

## Release acceptance walkthrough

Use a dedicated test organisation and synthetic records. Record the expected state before and after every action.

1. New director configures organisation/branch context and delegates an appropriate capability.
2. Participant completes intake; a reviewer identifies and resolves an incomplete readiness item.
3. Worker completes onboarding; an expired/missing requirement produces an understandable assignment block.
4. Coordinator rosters support; director follows an uncovered-shift escalation to its exact record.
5. Worker completes a shift; reviewer requests a correction; worker resubmits; reviewer approves.
6. Worker sees Approved and cannot reopen through history, cached screens, notifications or direct links.
7. Approved work progresses to an invoice; duplicate attempts and rejected/overdue payments have clear outcomes.
8. Incident/complaint is assigned, followed up and closed with an accountable record.
9. Evidence gap is resolved and an audit pack contains exactly the selected records.
10. Repeat key tasks using keyboard navigation, a narrower viewport and a second branch; test stale data, API failure and interrupted saves.

Product usability targets to validate with representative directors: identify the most urgent decision within 30 seconds; navigate from queue to the specific record without searching a second list; explain the next owner after a decision. These are proposed targets, not measured results.

## Delivery order

1. Workflow workshop and state matrix: confirm ownership and approvals with a director and coordinator.
2. Navigation map and low-fidelity Overview/Approvals prototypes: test with realistic cases before implementing polished visuals.
3. One vertical slice: shift submission -> requested changes -> approval -> invoice eligibility. Prove the handoffs across director, coordinator and worker.
4. Participant and workforce lifecycle slices; then incidents/evidence.
5. Apply the shared visual system and complete the release walkthrough.

Recommended first redesign: Overview plus Approvals. Do not start by reskinning every director page. The first meaningful milestone is a director who can find a real decision, complete it, see who acts next and trust the resulting status.

## Still to validate

- Live screen layout, navigation behaviour, loading performance and representative data volumes.
- Which current alerts already support assignment, due dates and closure persistence.
- Whether session review, shift verification and billing currently share the same authoritative decision.
- Exact readiness requirements and documented override authority for each provider.
- Delegated-role behaviour across shared coordinator screens and exported documents.
- Empty-organisation onboarding, customer support/help content, tenant setup and recovery behaviour.
- Regulatory, privacy, accessibility and security release obligations with the responsible specialists.
