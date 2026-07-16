# Partially-Implemented Features Audit

**Date**: 2025-06-21  
**Scope**: Coordinator-to-worker messaging, safety escalation, evidence audit trail, and incomplete features

---

## 1. Coordinator-to-Worker Messaging

### Status: ⚠️ BACKEND EXISTS, FRONTEND UI MISSING

#### What's Implemented

**Backend**:
- Endpoint: `POST /api/coordinator/workers/{worker_id}/message` [coordinator.py:784-820]
- Model: `WorkerMessageBody` with title and message fields
- Functionality:
  - Verifies worker exists in organization
  - Sends in-app notification via `notify_coordinator_message()`
  - Respects notification preferences (email/push/SMS)
  - Returns delivery status

**Notification Service**:
- Handler: `notify_coordinator_message()` in [notification_service.py]
- Event type: `"coordinator_message"` with alert_type mapping
- Channels: push, email, sms (configurable per worker)

**Database**:
- No dedicated table for coordinator messages; uses generic notification/alert system
- Stored as notifications with event type "coordinator_message"

#### What's Missing

1. **Frontend UI Page**: No page to send coordinator-to-worker messages
   - Contrast: `POST /api/coordinator/shifts/{shift_id}/message` is fully implemented with UI in [coordinator-live.tsx]
   - Missing: Worker list detail page with message-sending capability
   - Missing: Direct messaging interface (currently only shift-specific messaging exists)

2. **API Client Integration**: No `sendWorkerMessage()` exported in [coordinatorService.ts]
   - Location: [coordinatorService.ts:782-820] has `sendShiftMessage()` but NOT `sendWorkerMessage()`
   - Findings: Search for "sendWorkerMessage" returns 0 results in frontend codebase

3. **UI Component**: No messaging modal or form for sending individual worker messages
   - Context: Shift messaging UI exists in [coordinator-live.tsx:85-180] but is shift-scoped
   - Missing: Team management page (team.tsx) has no messaging capability

#### Risk Level: 🔴 **MEDIUM**

**Coordinator Confusion**: Coordinators may not realize they can send individual messages to workers because:
- The UI is not discoverable
- Only shift-specific messaging is visible in the live coordinator dashboard
- Team management page shows no messaging option
- Endpoint exists but is "invisible" to users

**Data Leak**: If URL structure becomes known, coordinators could theoretically message any worker without UI validation:
```python
# Line 791-804: Only checks organization membership, not visibility/scope
member = supabase.table("organization_members")
    .select("user_id")
    .eq("organization_id", org_id)
    .eq("user_id", worker_id)
    .maybe_single()
    .execute()
```

#### File References

- **Backend Endpoint**: [backend/app/api/coordinator.py#L784-L820](backend/app/api/coordinator.py#L784-L820)
- **Shift Message (working example)**: [backend/app/api/coordinator.py#L2693-L2726](backend/app/api/coordinator.py#L2693-L2726)
- **Frontend Service**: [artifacts/frontend/src/services/coordinatorService.ts#L782-L820](artifacts/frontend/src/services/coordinatorService.ts#L782-L820)
- **Shift Messaging UI (reference)**: [artifacts/frontend/src/pages/coordinator-live.tsx#L85-L180](artifacts/frontend/src/pages/coordinator-live.tsx#L85-L180)
- **Team Page (missing integration)**: [artifacts/frontend/src/pages/team.tsx](artifacts/frontend/src/pages/team.tsx)
- **Notification Service**: [backend/app/services/notification_service.py#L27-L35](backend/app/services/notification_service.py#L27-L35)

#### Recommendation

**Priority**: MEDIUM  
1. Add `sendWorkerMessage()` export to [coordinatorService.ts](artifacts/frontend/src/services/coordinatorService.ts)
2. Add "Send Message" action in team.tsx worker row context menu
3. Create a `WorkerMessagesModal` component similar to shift messaging
4. Test that notification preferences are respected (don't bypass worker settings)

---

## 2. Safety Escalation / Emergency Alerts

### Status: ✅ PARTIALLY IMPLEMENTED (Core exists, gaps in logic)

#### What's Implemented

**Backend - Emergency Stop**:
- Endpoint: `POST /api/coordinator/shifts/{shift_id}/emergency-stop` [coordinator.py:2555-2598]
- Functionality:
  - Sets `emergency_flagged = True` on shift
  - Records timestamp and note
  - Creates high-severity "emergency" alert
  - Notifies worker via in-app notification
  - Alert type: `"emergency"` with severity `"critical"`

**Backend - Shift Flagging**:
- Endpoint: `POST /api/coordinator/shifts/{shift_id}/flag` [coordinator.py:2527-2547]
- Allows custom alert creation with configurable severity (warning/error/info)

**Frontend - Emergency Stop**:
- Function: `emergencyStopShift()` [coordinatorService.ts#L810-L820]
- UI: Implemented in [coordinator-live.tsx#L503](coordinator-live.tsx#L503)
- Component: Red "SOS" button in live shift cards

**Check-In Service** (CARECLIQV2-197):
- Implements GPS geofence verification
- Implements QR code check-in validation
- Tables: `participant_check_in_codes`, `shift_check_ins` [migrations/048_shift_check_in.sql]
- Functionality: Validates worker arrival within 100m radius or QR token match

**Alert System**:
- Alert types tracked: emergency, shift_overlap, no_session_started, no_notes_recorded, etc.
- Database: `alerts` table with `alert_type` and `severity` fields [migrations/001_core_tables.sql#L136-L147]

#### What's Missing / Incomplete

1. **Lone Worker / Missed Check-in Detection**: 
   - ❌ No explicit lone worker alert logic
   - ❌ No "missed check-in" escalation (scheduled vs. actual arrival)
   - ❌ No automatic escalation if check-in window closes without verification
   - Code inspection: [check_in_service.py] has validation but no escalation triggers
   - Database: `shift_check_ins` table exists but no "alert_on_miss" automation

2. **Automatic Alert Generation**:
   - ⚠️ Partially implemented (auto-generates some alerts for no_session/no_notes)
   - Missing: Auto-escalate to "emergency" after threshold times
   - Missing: Chain-of-escalation logic (warning → alert → emergency)
   - Code: [coordinator.py#L2330-2370] generates alerts conditionally but no escalation thresholds

3. **Alert Acknowledgment**:
   - Database: `alerts.is_read` field exists
   - Missing: No "acknowledged_by" or "acknowledged_at" tracking
   - Missing: No escalation if coordinator doesn't acknowledge critical alert within timeframe
   - Impact: Critical emergency could go unnoticed if coordinator misses it

4. **Event Type Enum**:
   - EVENT_ALERT_TYPES defined in [notification_service.py#L27-L35]:
   ```python
   EVENT_ALERT_TYPES = {
       "shift_reminder": "shift_reminder",
       "shift_change": "shift_change",
       "coordinator_message": "coordinator_message",
       "feedback_received": "feedback",
       "certification_expiry": "credential_expiry",
   }
   ```
   - Not mapped: `"emergency"`, `"panic"`, `"check_in_missed"`, `"lone_worker"`
   - Finding: Emergency alerts are hardcoded as literal "emergency", not mapped through EVENT_ALERT_TYPES

#### Risk Level: 🟡 **HIGH**

**Safety Risk**: 
- Coordinators can manually trigger emergency stop but system doesn't auto-escalate missed check-ins
- If a lone worker has an accident and doesn't check in, no alert fires automatically
- Late-arriving worker (after 30-min window) has no special handling
- Coordinator must manually monitor each shift; no "at-risk" dashboard

**Confusion**: 
- Mixed alert naming: some use alert_type strings, some use hardcoded "emergency"
- No clear escalation ladder visible to coordinator

#### File References

- **Emergency Stop Endpoint**: [backend/app/api/coordinator.py#L2555-L2598](backend/app/api/coordinator.py#L2555-L2598)
- **Flag Shift Endpoint**: [backend/app/api/coordinator.py#L2527-L2547](backend/app/api/coordinator.py#L2527-L2547)
- **Frontend Emergency Stop**: [artifacts/frontend/src/services/coordinatorService.ts#L810-L820](artifacts/frontend/src/services/coordinatorService.ts#L810-L820)
- **Frontend UI Usage**: [artifacts/frontend/src/pages/coordinator-live.tsx#L503](artifacts/frontend/src/pages/coordinator-live.tsx#L503)
- **Check-in Service**: [backend/app/services/check_in_service.py](backend/app/services/check_in_service.py)
- **Check-in Tables**: [backend/supabase/migrations/048_shift_check_in.sql#L24-L58](backend/supabase/migrations/048_shift_check_in.sql#L24-L58)
- **Alert Types**: [backend/app/services/notification_service.py#L27-L35](backend/app/services/notification_service.py#L27-L35)
- **Alert Table**: [backend/supabase/migrations/001_core_tables.sql#L136-L147](backend/supabase/migrations/001_core_tables.sql#L136-L147)

#### Recommendation

**Priority**: HIGH  
1. Add auto-escalation logic: if shift_check_ins has no successful check-in after scheduled_start + 30 minutes, create alert
2. Implement "missed_check_in" alert type in EVENT_ALERT_TYPES
3. Add "acknowledged_at" and "acknowledged_by" fields to alerts table
4. Build "At-Risk Shifts" widget for coordinator dashboard (shifts without check-in)
5. Add configurable escalation thresholds (SLA for coordinator response to critical alerts)

---

## 3. Evidence Audit Trail / Chain of Custody

### Status: ❌ NOT IMPLEMENTED (Basic tracking only)

#### What's Implemented

**Backend - Evidence Upload**:
- Service: `upload_session_evidence_media()` [evidence_upload_service.py#L72-L199]
- Uploads to object storage at path: `{org_id}/{session_id}/evidence/{evidence_id}.{ext}`
- Stores metadata in `sessions.task_evidence` JSON array
- Fields tracked:
  - `evidence_id`, `task_id`, `type` (photo/voice)
  - `file_size_bytes`, `mime_type`
  - `created_at`, `storage_provider`, `file_url`
  - **But NOT uploader_id, hash, or timestamp from database**

**Database - Session Attachments Table**:
- Table: `session_attachments` [migrations/006_multilingual_legal_record_alignment.sql#L108-L122]
- Fields: `uploaded_by`, `file_name`, `file_path`, `public_url`, `mime_type`, `size_bytes`, `created_at`
- Usage: For general file attachments (not task evidence)
- Code: Creates record in sessions.py line 204: `"uploaded_by": get_user_id(current_user)`

**Evidence Metadata Stored**:
```python
# From evidence_upload_service.py lines 148-161
record: dict[str, Any] = {
    "evidence_id": eid,
    "task_id": item.get("task_id"),
    "type": etype,
    "file_size_bytes": len(raw_bytes),
    "mime_type": mime_type,
    "storage_path": storage_path,
    "storage_provider": stored.provider,
    "file_url": file_url,
    "created_at": item.get("created_at") or _now_iso(),  # CLIENT TIMESTAMP
    "synced": True,
}
```

#### What's Missing

1. **No File Hash / Integrity Verification**:
   - ❌ No SHA256 hash computed or stored
   - ❌ No "file_hash" field in `task_evidence` metadata
   - ❌ No chain-of-custody hash validation on download
   - Impact: Cannot detect if evidence file was tampered with after upload
   - Risk: In legal proceedings, evidence integrity is compromised without hash verification

2. **No Uploader ID in Task Evidence**:
   - ❌ `sessions.task_evidence` JSON does NOT include uploader_id
   - ⚠️ `session_attachments` table does track `uploaded_by`, but task evidence doesn't
   - Impact: Cannot audit who uploaded each piece of evidence
   - Code: session_attachments.py line 204 tracks uploader, but evidence_upload_service.py does NOT

3. **No Server-Side Timestamp**:
   - ❌ Uses `item.get("created_at") or _now_iso()` — accepts CLIENT timestamp
   - ❌ No immutable server_timestamp field
   - Impact: Coordinator could manipulate evidence upload times
   - Code: [evidence_upload_service.py#L158]

4. **No Access Audit Log**:
   - ❌ No tracking of who viewed/downloaded evidence
   - ❌ No "viewed_by" or "downloaded_by" fields
   - Impact: Evidence access is not logged for compliance

5. **No Revision History**:
   - ❌ Evidence cannot be versioned or tracked if modified
   - ❌ No "replaced_by", "superseded_at", or similar fields
   - Impact: Cannot detect if evidence was replaced

6. **Task Evidence Not in session_attachments**:
   - Task evidence (photos/voice) stored only in `sessions.task_evidence` JSON
   - Not stored in `session_attachments` table (which does have audit fields)
   - Two separate storage systems without unified audit trail

#### Database Schema Gaps

**session_attachments** (has some audit fields):
```sql
CREATE TABLE public.session_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid,
    uploaded_by uuid,           -- ✓ Uploader tracked
    file_name text,
    file_path text,
    mime_type text,
    size_bytes bigint,
    created_at timestamptz,    -- ✓ Server timestamp
    -- MISSING: file_hash, verified_by, access_log
);
```

**sessions.task_evidence** (JSON metadata, no audit):
```json
{
    "evidence_id": "...",
    "task_id": "...",
    "type": "photo",
    "file_size_bytes": 2048576,
    "mime_type": "image/jpeg",
    "created_at": "...",      -- ⚠️ Client timestamp
    "storage_path": "...",
    -- MISSING: uploader_id, file_hash, server_timestamp, viewed_by
}
```

#### Risk Level: 🔴 **CRITICAL**

**Legal/Compliance Risk**:
- Evidence from field visits MUST maintain chain of custody for legal proceedings
- Without hashing: evidence can be forged, replaced, or modified without detection
- Without uploader tracking: cannot determine who captured evidence
- Without timestamps: timeline disputes are unresolvable
- **NDIS compliance requirement**: Audit trail must be comprehensive and immutable

**Incident Example**:
1. Worker uploads photo as evidence of participant injury
2. Coordinator downloads and forwards to external party
3. No way to verify photo wasn't edited after original upload
4. In litigation, evidence is inadmissible without integrity proof

#### File References

- **Evidence Upload Service**: [backend/app/services/evidence_upload_service.py#L72-L199](backend/app/services/evidence_upload_service.py#L72-L199)
- **Record Creation (no uploader)**: [backend/app/services/evidence_upload_service.py#L148-L161](backend/app/services/evidence_upload_service.py#L148-L161)
- **Session Attachments Schema**: [backend/supabase/migrations/006_multilingual_legal_record_alignment.sql#L108-L122](backend/supabase/migrations/006_multilingual_legal_record_alignment.sql#L108-L122)
- **Session Attachments Insert (has uploader)**: [backend/app/api/sessions.py#L195-L220](backend/app/api/sessions.py#L195-L220)
- **Evidence Sync (no audit fields)**: [backend/app/services/shift_service.py#L2040-L2105](backend/app/services/shift_service.py#L2040-L2105)

#### Recommendation

**Priority**: CRITICAL  
1. Add `file_hash` (SHA256), `server_timestamp`, `uploader_id` to task_evidence metadata
2. Create separate `evidence_audit_log` table with fields:
   - `evidence_id`, `action` (uploaded/viewed/verified), `actor_id`, `timestamp`, `ip_address`
3. Compute and store file hash before storage (immutable after upload)
4. Migrate `sessions.task_evidence` to proper `session_evidence` table with audit columns
5. Add evidence integrity check endpoint (recompute hash on download, verify match)
6. Implement evidence download audit logging

---

## 4. Other Incomplete Features

### A. Hardcoded Defaults in Compliance Engine

**Location**: [backend/app/services/compliance_engine.py#L39](backend/app/services/compliance_engine.py#L39)

```python
# Hardcoded defaults — mirrors 015_compliance_rules_seed.sql
```

**Risk**: If seed data doesn't match hardcoded values, compliance scoring is inconsistent

---

### B. Missing Coordinator Team Scoping

**Location**: [backend/app/api/coordinator.py#L134-L200](backend/app/api/coordinator.py#L134-L200)

**Status**: In rollout, may be incomplete

**Code**:
```python
scoped_ids: set[str] | None = None
if coordinator_user is not None:
    ids = get_coordinator_team_ids(coordinator_user, supabase)
    scoped_ids = set(ids)  # may be empty — that's intentional
```

**Risk**: Coordinators with no linked workers return empty team (blocking feature during rollout)

---

### C. Updated_at Trigger Bug in Sessions

**Location**: [backend/app/api/coordinator.py#L492-L510](backend/app/api/coordinator.py#L492-L510)

**Comment in code**:
```python
# updated_at trigger bug: update is actually applied despite the error;
# treat as success rather than corrupting data with delete+insert.
```

**Risk**: Workaround for trigger bug masks underlying schema issue

---

### D. Evidence Sync Without Validation

**Location**: [backend/app/services/shift_service.py#L2040-L2105](backend/app/services/shift_service.py#L2040-L2105)

**Issue**: Merges evidence from client sync without strict validation

```python
for item in evidence_items:
    eid = str(item.get("evidence_id") or "")
    # Just merges into existing list, no deduplication or integrity check
```

---

## Summary Table

| Feature | Backend Endpoint | Frontend UI | Database | Status | Risk |
|---------|-----------------|------------|----------|--------|------|
| **Coordinator-Worker Messaging** | ✅ Yes | ❌ No | ⚠️ Generic | Endpoint only | MEDIUM |
| **Emergency Stop** | ✅ Yes | ✅ Yes | ✅ Yes | Working | — |
| **Shift Flag/Alert** | ✅ Yes | ✅ Yes | ✅ Yes | Working | — |
| **Lone Worker Alert** | ❌ No | ❌ No | ⚠️ Tables only | Incomplete | HIGH |
| **Missed Check-in Auto-Escalation** | ❌ No | ❌ No | ⚠️ Tables only | Not implemented | HIGH |
| **Evidence Hash/Integrity** | ❌ No | ❌ No | ❌ No | Not implemented | CRITICAL |
| **Evidence Uploader Audit** | ⚠️ Partial | ❌ No | ⚠️ Attachments only | Incomplete | CRITICAL |
| **Evidence Access Log** | ❌ No | ❌ No | ❌ No | Not implemented | CRITICAL |
| **Check-in Verification (GPS/QR)** | ✅ Yes | ⚠️ Partial | ✅ Yes | Mostly working | — |

---

## Action Items by Priority

### 🔴 CRITICAL (Compliance/Legal Risk)
- [ ] Add file hashing to evidence uploads
- [ ] Add uploader_id to task_evidence metadata
- [ ] Create evidence_audit_log table
- [ ] Implement evidence integrity verification on download

### 🟠 HIGH (Safety Risk)
- [ ] Implement auto-escalation for missed check-ins
- [ ] Add "At-Risk Shifts" dashboard widget
- [ ] Map emergency events to consistent alert_type enum
- [ ] Add alert acknowledgment tracking

### 🟡 MEDIUM (UX/Discoverability)
- [ ] Add sendWorkerMessage() to frontend service
- [ ] Build coordinator-to-worker messaging UI
- [ ] Add message action to team member rows

### 🔵 LOW (Technical Debt)
- [ ] Resolve updated_at trigger bug properly
- [ ] Unify evidence storage (task_evidence vs session_attachments)
- [ ] Review hardcoded compliance defaults
