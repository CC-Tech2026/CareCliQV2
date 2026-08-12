# Part B — Feature Discovery Audit: Partially-Implemented Features
**Session 2, Part B | Discovery/Reporting Only (No Code Changes)**  
**Date**: 2026-06-21

---

## Executive Summary

Audit of the CareCliQ coordinator workspace revealed **3 partially-implemented features** and **1 critical compliance gap**:

| Feature | Status | Risk | Impact |
|---------|--------|------|--------|
| Coordinator-to-Worker Messaging | Backend exists, **UI missing** | Medium | Coordinators can't message workers outside shift context |
| Safety Escalation (Auto-Alert) | Manual only, **auto-trigger missing** | **High** | Missed check-ins won't auto-escalate to coordinator |
| Evidence Audit Trail | Basic storage, **chain-of-custody missing** | **Critical** | No tamper detection; fails NDIS compliance audit |
| Incomplete features (other) | Multiple | Low | Minor confusing UI patterns |

**Recommended Action**: Address Evidence Audit Trail (Critical) and Safety Escalation (High) before next release. Coordinator-to-Worker Messaging can be Phase 2.

---

## Feature 1: Coordinator-to-Worker Messaging

### Current Implementation Status

**Backend: ✅ Complete**
- Endpoint: `POST /api/coordinator/workers/{worker_id}/message` (coordinator.py:784-820)
- Creates notification record with title, message, optional delivery channels (in_app, email, SMS)
- Respects worker notification preferences
- Full organization-level authorization checks

**Frontend: ❌ UI Missing**
- Backend API integration exists but **no page or modal** to send messages
- Messaging only available in **shift context** (coordinator-live.tsx) for sending messages *during* a shift
- No direct-message UI on worker profiles or team settings
- `sendWorkerMessage()` API client method not called anywhere in UI

### What Coordinators Experience

**Current**: Can send task-specific messages to workers *during an active shift* via the live shift chat modal
**Missing**: Cannot send standalone messages to workers (e.g., "Reminder: credential expires next week" or "Please contact me when you're available")

### Code References

- Backend endpoint: [backend/app/api/coordinator.py:784-820](backend/app/api/coordinator.py#L784-L820)
- Backend model: `WorkerMessageBody` (line 779-781)
- Frontend service stub: Not found in coordinatorService.ts (but `sendBulkReminders()` exists at line 296)
- Frontend UI: Not implemented

### Risk Assessment

- **Severity**: Medium
- **Coordinator Confusion**: Moderate — messaging endpoint exists but coordinators can't access it
- **Data Loss Risk**: None
- **Compliance Impact**: None

---

## Feature 2: Safety Escalation & Emergency Alerts

### Current Implementation Status

**Backend: ⚠️ Partially Implemented**
- Manual emergency stop via `emergencyStopShift()` (coordinator.py:2555) ✅
- Shift flagging for compliance review ✅
- Alert system exists (GET/POST /api/alerts, POST /api/alerts/mark-all-read) ✅
- Alert service normalizes and filters by org_id ✅

**Missing Automation**
- ❌ **No auto-escalation on missed check-in**: Worker clocked in but didn't start session after 30 min → no auto-alert to coordinator
- ❌ **No lone-worker detection**: Real-time check-in monitoring, auto-alert if worker goes offline mid-shift
- ❌ **No alert acknowledgment tracking**: Alerts marked as read but no "acknowledged at" timestamp
- ❌ **Limited alert types**: Only compliance, resource, budget alerts; no "safety" or "emergency" alert types in schema

**Frontend: ⚠️ Partially Implemented**
- Alert bell icon shows unread count (settings.tsx, coordinator-live.tsx)
- Alert list exists but not prominent in coordinator pages
- No real-time push notifications for emergency alerts
- No dedicated "Safety Alerts" section with special handling

### What Coordinators Experience

**Current**: 
- Can manually stop a shift if worker reports emergency ✅
- See compliance/resource alerts in notification bell
- Flagged sessions appear in compliance dashboard

**Missing**:
- If worker is assigned to a shift but doesn't start session within 30 min → **coordinator is NOT notified**
- If worker goes offline mid-shift → **no auto-alert**
- No "escalation protocol" — all alerts treated equally

### Code References

- Manual emergency stop: [backend/app/api/coordinator.py:2555](backend/app/api/coordinator.py#L2555)
- Alert creation: [backend/app/api/alerts.py](backend/app/api/alerts.py)
- Alert service: [backend/app/services/alert_service.py](backend/app/services/alert_service.py)
- Check-in service: [backend/app/services/check_in_service.py](backend/app/services/check_in_service.py)
- Frontend alerts: [artifacts/frontend/src/pages/settings.tsx:309-370](artifacts/frontend/src/pages/settings.tsx#L309-L370)

### Risk Assessment

- **Severity**: **High**
- **Coordinator Confusion**: High — coordinators may assume system auto-alerts on check-in timeout; system is passive
- **Safety Risk**: High — missed check-in protocol is manual, not automated
- **Compliance Impact**: Medium — NDIS funding rules require timely incident reporting
- **Real-world scenario**: Worker assigned 9:00–12:00 shift → clocks in at 9:15 but never starts session → coordinator finds out *if* they manually check the shift list 3 hours later

---

## Feature 3: Evidence Audit Trail (Chain of Custody) — 🔴 CRITICAL

### Current Implementation Status

**Backend: ⚠️ Partial — **Critical Gaps**

Evidence stored in two places with different schemas:

#### **Table 1: `task_evidence` (line 108+ in migration)**
```sql
CREATE TABLE task_evidence (
  id uuid PRIMARY KEY,
  task_id uuid REFERENCES tasks(id),
  file_url text NOT NULL,
  file_name text,
  file_size integer,
  mime_type text,
  created_at timestamp DEFAULT NOW(),
  -- ❌ MISSING: uploader_id, evidence_hash, tamper_flag
);
```

**Missing Critical Fields**:
- ❌ `uploader_id` — cannot prove WHO uploaded file (chain of custody broken)
- ❌ `file_hash` (SHA256/MD5) — cannot detect if file was tampered with post-upload
- ❌ `upload_timestamp_verified` — timestamp not server-verified (client timestamp accepted)
- ❌ `access_log` — cannot audit who viewed/accessed evidence

#### **Table 2: `session_attachments`** (contrast)
```sql
CREATE TABLE session_attachments (
  id uuid PRIMARY KEY,
  session_id uuid REFERENCES sessions(id),
  file_url text,
  file_name text,
  file_size int,
  mime_type text,
  uploaded_by uuid REFERENCES auth.users(id),  -- ✅ HAS uploader
  created_at timestamp DEFAULT NOW(),
  -- ⚠️ STILL MISSING: file_hash, tamper detection
);
```

#### **File Upload Service** (backend/app/services/evidence_upload_service.py:148-161)
```python
# ❌ Current implementation:
result = {
    "evidence_id": str(uuid.uuid4()),
    "file_name": file.filename,
    "file_size": file.size,
    "mime_type": file.content_type,
    "url": upload_url,
    "created_at": datetime.utcnow().isoformat(),  # ❌ Client time accepted
}
# NOT HASHED, NOT VERIFIED, NOT IMMUTABLE
```

### NDIS Compliance Gap

NDIS evidence requirements (from replit.md + funding rules):
1. **Immutable storage** — evidence cannot be modified post-upload ✅ (cloud storage handles)
2. **Chain of custody** — proves WHO uploaded WHEN and file integrity ❌ **MISSING**
3. **Tamper detection** — cryptographic hash proves file wasn't altered ❌ **MISSING**
4. **Access audit** — log of who accessed evidence for regulatory audit ❌ **MISSING**

**Compliance Risk**: Auditor asks "Who uploaded this photo? When? Has it been modified?" → System cannot answer → **Funding rejection**.

### What Coordinators Experience

**Current**:
- Upload evidence during session ✅
- Evidence appears in session detail ✅
- File is stored safely ✅

**Missing**:
- If evidence file is accidentally overwritten by participant → coordinator won't know
- If upload timestamp is wrong (participant's device clock off) → no verification
- Auditor asks "What's the chain of custody?" → no documented uploader or hash

### Code References

- Schema: [backend/supabase/migrations/006_multilingual_legal_record_alignment.sql:108](backend/supabase/migrations/006_multilingual_legal_record_alignment.sql#L108)
- Upload service: [backend/app/services/evidence_upload_service.py:148-161](backend/app/services/evidence_upload_service.py#L148-L161)
- Frontend upload: [artifacts/frontend/src/components/shifts/EvidenceSyncBanner.tsx](artifacts/frontend/src/components/shifts/EvidenceSyncBanner.tsx)
- Session attachments (better schema): [backend/supabase/migrations/*_sessions.sql](backend/supabase/migrations/)

### Risk Assessment

- **Severity**: 🔴 **Critical**
- **Compliance Impact**: Critical — NDIS audit will flag missing chain of custody
- **Legal Risk**: High — evidence without tamper detection inadmissible in disputes
- **Coordinator Confusion**: Medium — coordinators may assume evidence is audited
- **Real-world scenario**: Evidence file uploaded at 2:15 PM. Participant later claims "That was changed after I left." Coordinator cannot prove it wasn't (no hash, no uploader log).

---

## Feature 4: Other Incomplete Patterns

### Alert Type Enums (Minor)
- Alert types hardcoded in frontend/backend
- No enum or feature flag system to add custom alert types
- **Risk**: Low — works as-is but not extensible

### Settings Sidebar Breakpoint Fix (Now Complete ✅)
- Fixed in Part A — sidebar now hides at `lg:` breakpoint instead of cramping tablet view

---

## Priority Matrix: What to Fix First

| # | Feature | Severity | Effort | Impact | Recommendation |
|---|---------|----------|--------|--------|-----------------|
| 1 | **Evidence Audit Trail** | 🔴 Critical | High | Compliance, Legal | **PHASE 1 (Before Next Release)** |
| 2 | **Safety Auto-Escalation** | 🟠 High | Medium | Safety, UX | **PHASE 1** |
| 3 | Coordinator-to-Worker Messaging | 🟡 Medium | Low | Convenience, UX | PHASE 2 |
| 4 | Alert Acknowledgment Tracking | 🟡 Medium | Low | UX Polish | PHASE 3 |

---

## Action Items

### CRITICAL (Phase 1 — Before Release)
- [ ] Add `uploader_id` field to `task_evidence` table (FK to auth.users)
- [ ] Add `file_hash` (SHA256) field for tamper detection
- [ ] Implement server-side timestamp verification (reject client timestamps > 60s skew)
- [ ] Add `access_log` table to track evidence views (user_id, timestamp, IP)
- [ ] Update evidence upload service to compute and store SHA256 hash
- [ ] Add evidence integrity verification endpoint (coordinator can verify file matches stored hash)

### HIGH (Phase 1)
- [ ] Implement auto-alert on 30-min check-in timeout (background job or trigger)
- [ ] Add "lone worker offline" detection (if worker position not updated for 60 min)
- [ ] Create "Safety Alerts" section in coordinator dashboard (separate from compliance)
- [ ] Add alert acknowledgment timestamp tracking

### MEDIUM (Phase 2)
- [ ] Create "Send Message" page in coordinator workspace (call `/api/coordinator/workers/{worker_id}/message`)
- [ ] Add messaging modal to worker profile card
- [ ] Add message delivery status (pending, sent, read)

### LOW (Phase 3)
- [ ] Parameterize alert types (enum or database configuration)
- [ ] Add push notifications for emergency alerts
- [ ] Add alert filtering/search

---

## Session Summary

### Part A: Responsiveness Fixes ✅ COMPLETE
- Fixed 6 issues across coordinator-rostering, compliance, coordinator-live, settings
- All 3 "Blocks Tablet Use" critical issues resolved
- Zero new errors introduced

### Part B: Feature Discovery ✅ COMPLETE
- Identified 3 partially-implemented features
- **1 Critical compliance gap** (evidence audit trail)
- **1 High-risk safety gap** (auto-escalation missing)
- Documented with code references and risk assessment
- Provided prioritized action items

### Deliverables for User Review
1. ✅ Responsiveness audit table (completed, fixes implemented)
2. ✅ Feature discovery report (this document)
3. ✅ All code changes tested and error-free

---

**Next Steps**: User approval to create PR with Part A fixes + share findings with development team for feature planning.
