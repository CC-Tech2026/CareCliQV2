# CareScribe / NDIS MVP Deployment and Migration Runbook

This guide is the source of truth for setting up the database, auth, storage, environment variables, Docker deployment, and validation from a fresh environment through the current sprint-complete build.

## What To Run Now

If your database already has the earlier MVP tables and the app is currently running, run this migration now:

1. `backend/supabase/migrations/010_sprint_completion_security_wallet_toolkit.sql`
2. `backend/supabase/migrations/011_fix_legacy_onboarding_flags.sql`
3. `backend/supabase/migrations/012_sprint_feature_rls_hardening.sql`

Migration `011` also re-applies the access-log alignment columns used by the live dashboard audit trail, so it is safe to run if dashboard reads log `access_logs.participant_id` schema warnings.
Migration `012` enables service-role-only RLS policies for the sprint feature tables, adds missing indexes, and aligns invoice statuses with the production lifecycle.

If you are not sure whether the latest billing and incident migrations were applied, run these in order. They are written to be safe to rerun where possible:

1. `backend/supabase/migrations/008_billing_invoicing_password_reset.sql`
2. `backend/supabase/migrations/009_incident_legal_record_alignment.sql`
3. `backend/supabase/migrations/010_sprint_completion_security_wallet_toolkit.sql`
4. `backend/supabase/migrations/011_fix_legacy_onboarding_flags.sql`
5. `backend/supabase/migrations/012_sprint_feature_rls_hardening.sql`

After those migrations, rerun the demo seed only if you want the Sunshine demo users and sample data refreshed:

1. `backend/supabase/seed/041_demo_data.sql`

## Fresh Database Migration Order

Run these files in Supabase SQL Editor in this exact order:

1. `backend/supabase/migrations/000_init_extensions.sql`
2. `backend/supabase/migrations/001_core_tables.sql`
3. `backend/supabase/migrations/002_organization_members.sql`
4. `backend/supabase/migrations/003_rls_helpers.sql`
5. `backend/supabase/migrations/004_enable_rls.sql`
6. `backend/supabase/migrations/005_core_schema_extensions.sql`
7. `backend/supabase/migrations/006_multilingual_legal_record_alignment.sql`
8. `backend/supabase/migrations/007_access_log_alignment.sql`
9. `backend/supabase/migrations/008_billing_invoicing_password_reset.sql`
10. `backend/supabase/migrations/009_incident_legal_record_alignment.sql`
11. `backend/supabase/migrations/010_sprint_completion_security_wallet_toolkit.sql`
12. `backend/supabase/migrations/011_fix_legacy_onboarding_flags.sql`
13. `backend/supabase/migrations/012_sprint_feature_rls_hardening.sql`

Then run seeds, if needed:

1. `backend/supabase/seed/040_support_items.sql`
2. `backend/supabase/seed/041_demo_data.sql`

## Do Not Use Legacy SQL First

The canonical migration path is:

`backend/supabase/migrations/*.sql`

The SQL files directly under `backend/` are older/manual repair or setup scripts. Do not run them on a normal fresh deployment unless you are repairing a specific environment and know why you need them.

## What Migration 010 Adds

`010_sprint_completion_security_wallet_toolkit.sql` supports the latest sprint-complete work:

- Email/profile/onboarding flags on `public.users`
- Support worker/allied health profile fields
- Profile photo path and URL columns
- Worker onboarding checklist storage
- Credential wallet table and indexes
- Report history table and indexes
- Invoice PDF/status/payment enhancement columns
- Duplicate-active-invoice protection for session invoices
- Toolkit stock table
- Toolkit movement log table
- Restock request table

Migration `011` backfills legacy profile/onboarding flags without marking real non-demo users as email verified. Only the deterministic Sunshine demo users are forced verified because the seed creates confirmed Supabase Auth records.

Migration `012` adds the final RLS and index hardening for:

- Credentials
- Report history
- Toolkit items
- Toolkit movements
- Restock requests
- Finalized invoice status support

## Post-Migration Verification SQL

Run this after migrations 010, 011, and 012:

```sql
select
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'credentials'
  ) as credentials_table,
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'report_history'
  ) as report_history_table,
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'toolkit_items'
  ) as toolkit_items_table,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'profile_photo_url'
  ) as profile_photo_column,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'pdf_url'
  ) as invoice_pdf_column,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'role_specific_profile_completed'
  ) as role_profile_flag_column;
```

All values should return `true`.

## Supabase Storage Buckets

Create these buckets in Supabase Storage:

1. `profile-photos`
2. `credential-files`
3. `invoice-files`
4. `report-files`

The backend uses the Supabase service role for uploads. For production, keep the service role key server-side only.

## Google Cloud Translation

Legal-record translation uses Google Cloud Translation v3 only. Do not configure
any alternate provider, browser translation, or frontend API keys for
legal/compliance translation.

1. In Google Cloud, enable the Cloud Translation API for the production project.
2. Create a service account with permission to call Cloud Translation.
3. Download the JSON key onto the backend server only, for example:

```text
/secure/carescribe/google-credentials.json
```

4. Never commit the JSON key. The repo ignores `google-credentials*.json`,
`service-account*.json`, and `*google*.json`.
5. Set these backend environment variables and restart the backend:

```env
GOOGLE_CLOUD_PROJECT_ID=your-google-cloud-project-id
GOOGLE_APPLICATION_CREDENTIALS=/secure/carescribe/google-credentials.json
GOOGLE_TRANSLATE_LOCATION=global
```

Supported legal-record translation languages are exactly:

```text
English, Hindi, Tagalog, Nepali, Arabic, Swahili, Mandarin, Vietnamese, Punjabi
```

## Supabase Auth Configuration

In Supabase Dashboard, open Authentication > URL Configuration.

Set Site URL:

```text
http://localhost:3000
```

For production, use your real frontend URL.

Add redirect URLs:

```text
http://localhost:3000/login?verified=1
http://localhost:3000/reset-password
http://localhost:3000/verify-email
https://your-production-domain/login?verified=1
https://your-production-domain/reset-password
https://your-production-domain/verify-email
```

Set `AUTH_AUTO_CONFIRM_EMAIL=false` in production so users must verify email before full access.

## Environment Variables

Copy `.env.example` to `.env`, then set real values:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SESSION_SECRET=replace-with-long-random-secret
FRONTEND_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
AUTH_AUTO_CONFIRM_EMAIL=false
REAUTH_TOKEN_EXPIRE_MINUTES=10
VITE_IDLE_TIMEOUT_MINUTES=15
VITE_IDLE_WARNING_SECONDS=120
GOOGLE_CLOUD_PROJECT_ID=your-google-cloud-project-id
GOOGLE_APPLICATION_CREDENTIALS=/secure/carescribe/google-credentials.json
GOOGLE_TRANSLATE_LOCATION=global
```

For automatic Google Workspace/Gmail invite email:

```env
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-google-workspace-email@example.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM_EMAIL=your-google-workspace-email@example.com
SMTP_FROM_NAME=CareScribe
SMTP_USE_STARTTLS=true
```

Use a Google App Password, not the normal account password.

## Local Docker Deployment

Build and start:

```powershell
docker compose build --pull=false
docker compose up -d --no-build
```

Check containers:

```powershell
docker compose ps
docker compose logs backend --tail 80
docker compose logs frontend --tail 40
```

Expected:

- Backend healthy on `http://localhost:8000`
- Frontend available on `http://localhost:3000`

## Validation Commands

Frontend and workspace:

```powershell
corepack pnpm run typecheck
corepack pnpm run build
```

Backend in Docker:

```powershell
docker compose exec -T backend sh -c "uv pip install pytest && python -m pytest -q"
docker compose exec -T backend python -m compileall backend/app
```

Note: the root package currently has no `npm test` or `npm run lint` script, so those commands will report missing scripts.

## Demo Logins

After running `041_demo_data.sql`, these demo accounts are available:

```text
sarah@sunshine-demo.com / Sarahsunshine#2026
amara@sunshine-demo.com / Amarasunshine#2026
daniel@sunshine-demo.com / Danielsunshine#2026
```

If one login fails after rerunning the seed, rerun `041_demo_data.sql` after all migrations and verify Supabase Auth user/identity rows were created.

## Jira Completion Checks

Before marking the sprint items Done in Jira, verify:

- Support coordinator sees org dashboard, team, credentials, toolkit, invoices, reports, audit/compliance, incidents, settings.
- Support worker sees only dashboard, My Clients, My Compliance, NDIS Plan, Credentials, Toolkit.
- Support worker does not see Session in sidebar.
- Start Session and New Note appear only inside selected client detail.
- Worker cannot access billing, reports, team, global compliance, all participants, or all sessions by direct URL.
- Email verification blocks app access until verified.
- Worker profile completion and onboarding checklist persist after refresh.
- Profile photo upload persists after refresh.
- Credential upload/review persists.
- Toolkit use/restock flows persist.
- Invoice finalize/paid/PDF actions require re-auth.
- Report PDF generation requires re-auth and saves report history.
- Idle timeout warning appears before auto logout.

## Troubleshooting

If Docker build tries to pull base images and DNS fails, use:

```powershell
docker compose build --pull=false
docker compose up -d --no-build
```

If password reset or verification links open the wrong place, check:

- `FRONTEND_URL`
- `FRONTEND_BASE_URL`
- Supabase Auth redirect URLs
- Supabase Site URL

If upload endpoints fail, check that the storage buckets exist and the backend has a valid `SUPABASE_SERVICE_ROLE_KEY`.
