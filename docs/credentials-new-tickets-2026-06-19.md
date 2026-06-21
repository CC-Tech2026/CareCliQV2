# Worker Credentials - Proposed New Tickets (2026-06-19)

## CARECLIQV2-302 - Shift Credential Requirements Matrix
Priority: High
Status: Completed

Problem:
- Shift assignment currently validates whether at least one worker credential is valid, but does not enforce shift-type-specific credential requirements.

Deliverables:
- Add `shift_credential_requirements` table with:
  - `shift_type`
  - `required_credential_type`
  - `minimum_status`
  - `organization_id`
- Add coordinator API endpoints to manage requirements per shift type.
- Integrate matrix checks into shift assignment validation.

Acceptance Criteria:
- Coordinator can define required credentials by shift type.
- Shift assignment fails with explicit missing requirement details when rules are not met.
- Validation supports org-scoped requirement sets.

Implementation Notes (2026-06-19):
- Completed backend migration, service logic, coordinator CRUD endpoints, and shift assignment enforcement.
- Completed frontend credentials workspace inline management UI for listing/adding/removing matrix rules.

## CARECLIQV2-303 - Credential Compliance Scoring + Escalations
Priority: High

Problem:
- Credential states are visible but not consistently escalated through notifications and dashboard thresholds.

Deliverables:
- Add severity scoring for credential risks (expiring soon, expired, rejected).
- Add escalation thresholds for coordinator dashboards and notifications.
- Support reminder cadence policies (for example: D-30, D-14, D-7, expired).

Acceptance Criteria:
- Dashboard displays severity buckets and total risk score.
- Scheduled reminders send according to configured cadence.
- Expired credentials trigger elevated alerts and assignment-block context.

## CARECLIQV2-304 - Credential Evidence Audit Trail
Priority: Medium

Problem:
- Review decisions exist but evidence lifecycle and reviewer audit trace are not explicit enough for audit exports.

Deliverables:
- Add credential review history table:
  - reviewer ID
  - previous/new status
  - notes
  - timestamp
  - source action
- Add endpoint to retrieve review timeline per credential.
- Expose timeline in coordinator credential view.

Acceptance Criteria:
- Every review decision appends immutable history.
- Coordinator can inspect full review timeline.
- Data export includes review trail metadata.

## CARECLIQV2-305 - Credential Expiry Calendar View
Priority: Medium

Problem:
- Expiring credentials are listed but not visualized over time for team planning.

Deliverables:
- Add calendar-style view in credentials workspace.
- Support filters by worker, credential type, status, and date range.
- Add quick actions for reminders from date clusters.

Acceptance Criteria:
- Coordinator can view upcoming expiries by day/week/month.
- Reminder actions are available from calendar entries.
- Filters update view without full page reload.

## CARECLIQV2-306 - Worker Credential Submission Guidance
Priority: Low

Problem:
- Workers can upload credentials, but guidance for accepted formats and review expectations is minimal.

Deliverables:
- Add inline guidance for supported document types and quality checks.
- Add submission checklist and status explanation copy.
- Add lightweight validation hints before upload.

Acceptance Criteria:
- Workers see clear upload requirements before submission.
- Invalid submission rate decreases in analytics.
- Support tickets about upload/review confusion are reduced.
