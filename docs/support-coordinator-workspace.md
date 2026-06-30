# Support Coordinator Workspace

This document summarizes the current Support Coordinator workspace implementation and the ticket coverage that was verified in this pass.

## Implemented Areas

- Coordinator access is role-gated through the router and protected route layer.
- The coordinator dashboard is wired to the coordinator-specific dashboard payload and now surfaces team-oriented metrics.
- Team management includes worker stats, worker activation/deactivation, participant assignments, shift assignment, invites, and a worker message action on the backend.
- Team management now surfaces credential warnings, reminder actions, and shift-assignment credential checks.
- Coordinator rostering now has its own dedicated page with calendar and list tabs for scheduling management.
- Participant management is available through the shared participant pages, with coordinator-only creation and editing routes.
- Session review supports flagged session review, AI suggestions, approval, bulk approval, and send-back actions.
- Compliance tracking includes coordinator compliance overview, AI-detected patterns, restrictive-practice flags, credential alerts, and bulk reminders.
- Goals and planning are implemented in the coordinator goals page with review scheduling.
- Participant shift context is implemented through the coordinator-only shift context editor.

## Ticket Coverage

- CARECLIQV2-49: implemented via the participant shift context editor and its save/load flow.
- CARECLIQV2-233: covered by the coordinator workspace dashboard / team-management implementation and the new team-level dashboard metrics.
- CARECLIQV2-235: covered by the dedicated coordinator rostering route, calendar view, and shift list management surface.

## Recent Coordinator Dashboard Improvements

- Added team participants count.
- Added sessions this week.
- Added incidents this month.
- Added workers needing support.
- Routed incident counts through the existing incident service so the dashboard stays aligned with the current schema.
- Added coordinator credential reminder actions for workers with expiring or expired credentials.
- Shift assignment now validates real credential health through worker credential-status checks and blocks assignment when required credentials are missing/invalid.
- Fixed coordinator shift creation payload to align with `shifts` schema fields and always provide `scheduled_end` (defaults to start + 4 hours when omitted).

## Notes

- Existing support worker flows were left unchanged.
- Existing role-based routing and navigation remain in place.
- The coordinator workspace continues to reuse the shared design system and layout patterns used by the rest of the app.
