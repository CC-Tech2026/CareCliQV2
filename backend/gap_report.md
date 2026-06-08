# CareCliQ — Backend DB Gap Report

_Generated: 2026-06-07_

---

## Summary

The backend Python code references **13 tables** that do not exist in any SQL setup
file (`supabase_setup.sql` or `supabase_patch_missing_tables.sql`).  
Fix: run **`backend/supabase_patch_features.sql`** in the Supabase SQL Editor.

---

## 1. Missing Tables (Critical — will cause 500 errors)

| Table | Used by | Impact if missing |
|---|---|---|
| `billing_subscriptions` | `billing_service.py` → `GET /api/billing/subscription` | **500** — no try/except around insert |
| `credentials` | `credentials.py` → `GET /api/credentials/me` | **500** on list/create |
| `invoices` | `billing_service.py` → `GET /api/billing/invoices` | **500** on any billing call |
| `practitioner_settings` | `settings.py` → `GET /api/settings/practitioner` | **500** on upsert |
| `report_history` | `reports.py` → `GET /api/reports/history` | **500** on list/generate |
| `restock_requests` | `toolkit.py` → `POST /api/toolkit/me/restock-request` | **500** on any toolkit call |
| `session_attachments` | `sessions.py` → attachment upload | **500** on photo/file upload |
| `toolkit_items` | `toolkit.py` → `GET /api/toolkit/me` | **500** on any toolkit call |
| `toolkit_movements` | `toolkit.py` → use/assign/restock | **500** on any toolkit write |

## 2. Missing Tables (Non-fatal — try/except returns empty)

| Table | Used by | Impact if missing |
|---|---|---|
| `access_logs` | `access_log_service.py` | No NDIS s.66 audit trail recorded |
| `practitioner_allocations` | `allocation_service.py` | Participant-practitioner links not stored |
| `security_events` | `access_log_service.py` | No breach-detection events stored |
| `session_messages` | `message_service.py` | Live session chat not persisted |

## 3. Tables in SQL setup but NOT referenced by code

| Table | Notes |
|---|---|
| `support_items` | Reference data only — harmless |
| `note_embeddings` | Placeholder for future vector search |

## 4. Tables already in supabase_patch_missing_tables.sql ✓

`organizations`, `organization_members`, `invitations` — already patched.

## 5. Column gaps on pre-existing tables

All `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements that the backend requires are
already in `supabase_setup.sql` and `supabase_patch_missing_tables.sql`.  
Notable ones: `patients.biological_sex`, `sessions.is_ready_for_billing`,
`sessions.organization_id`, `users.organization_id`, `users.coordinator_id`.

## 6. Frontend API endpoints — route coverage

All frontend API calls found by static analysis have a corresponding Python route
in the backend. No missing routes detected.

---

## Fix

Run `backend/supabase_patch_features.sql` **after**
`supabase_setup.sql` and `supabase_patch_missing_tables.sql`.

```
Supabase Dashboard → SQL Editor → New query → paste → Run
```
