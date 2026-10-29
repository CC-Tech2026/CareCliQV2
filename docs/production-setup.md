# Production setup: app.carecliq.com.au

Production is kept completely separate from dev so real customers' records never sit alongside demo, test and pilot data.

| | Dev (today) | Production |
|---|---|---|
| Web app | carecliq-dev.pages.dev (builds `develop`) | **app.carecliq.com.au** (builds `main`) |
| API | carecliq-api-dev.fly.dev (`fly.toml`) | **api.carecliq.com.au**, Fly app `carecliq-api` (`fly.production.toml`) |
| Database | Supabase `sndwllbtmguzduuazahd` | new Supabase project `carecliq-prod`, Sydney |
| Stripe | test mode | live mode |
| Migrations | pasted by hand | applied automatically on every deploy (`DATABASE_URL` secret) |

Steps marked **(you)** need your accounts; the rest are run from this repo.

## 1. Database

1. **(you)** Apply `temp/dev-db-catch-up-2026-10-29.sql` to the **dev** project (Supabase → SQL Editor → paste → Run), so the schema copied in step 4 is complete.
2. **(you)** Create a Supabase project: name `carecliq-prod`, region **Sydney (ap-southeast-2)**, a strong database password kept in your password manager.
3. **(you)** In the new project, Authentication → URL Configuration: Site URL `https://app.carecliq.com.au`; add `https://app.carecliq.com.au/**` to Redirect URLs. Authentication → SMTP: the same sender as dev, so password-reset emails come from CareCliQ.
4. **(you)** Create `.env.production` in the repo root (git-ignored, never committed) with the new project's values, from Project Settings → API and → Database → Connection string → **Session pooler**:
   ```
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
   Add the **dev** project's Session pooler URL to `.env` as `DEV_DATABASE_URL=...`.
5. Start Docker Desktop, then:
   ```
   .venv/Scripts/python -m backend.scripts.bootstrap_production_db           # checks only
   .venv/Scripts/python -m backend.scripts.bootstrap_production_db --apply
   ```
   This copies the dev schema (structure only), storage buckets and shared reference data (NDIS price catalogue, public holidays, SCHADS award tables, compliance rules, help content), then marks every current migration as applied. No organisation, user or participant data is copied. It refuses to run against a database that already has organisations.

## 2. API (api.carecliq.com.au)

1. Create the app and its secrets. Generate **new** values for `SESSION_SECRET` and `PII_ENCRYPTION_KEY`; never reuse dev's (dev's key would decrypt production data).
   ```
   flyctl apps create carecliq-api
   flyctl secrets set --app carecliq-api --stage DATABASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... SESSION_SECRET=... PII_ENCRYPTION_ENABLED=true PII_ENCRYPTION_KEY=... EMAIL_ENABLED=true SMTP_HOST=... SMTP_PORT=587 SMTP_USERNAME=... SMTP_PASSWORD=... SMTP_FROM_EMAIL=... SMTP_FROM_NAME=CareCliQ OPENAI_API_KEY=... STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... NOTIFICATION_SCHEDULER_ENABLED=true
   ```
   Copy the remaining keys (Google, Firebase/Expo, storage) from `flyctl secrets list --app carecliq-api-dev` as needed.
2. Deploy from `main`, in a clean checkout:
   ```
   flyctl deploy --config fly.production.toml --remote-only
   flyctl certs add api.carecliq.com.au --app carecliq-api
   ```
   `certs add` prints the DNS records for step 4.

## 3. Web app (app.carecliq.com.au)

**(you)** Cloudflare → Workers & Pages → Create → Pages → connect the GitHub repo. Copy the build command and output folder from the existing dev project's settings, and set:

- Production branch: `main`
- Environment variables: `VITE_API_URL=https://api.carecliq.com.au`, `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the **production** project's), `SUPABASE_REGION=ap-southeast-2`
- Custom domains → add `app.carecliq.com.au`

## 4. DNS (you, at Namecheap)

carecliq.com.au uses Namecheap DNS. Domain List → carecliq.com.au → Advanced DNS → add:

| Type | Host | Value |
|---|---|---|
| CNAME | `app` | the `<project>.pages.dev` address Cloudflare shows |
| CNAME | `api` | `carecliq-api.fly.dev` |
| CNAME | `_acme-challenge.api` | the value `flyctl certs add` printed |

The root `carecliq.com.au` record is the marketing site: leave it alone.

## 5. Stripe live

1. Switch the Stripe dashboard to live mode and copy the live secret key.
2. Create the plans and webhook exactly as test mode has them (dry run first):
   ```
   STRIPE_SECRET_KEY=sk_live_... .venv/Scripts/python -m backend.scripts.setup_stripe_plans --webhook-url https://api.carecliq.com.au/api/platform-billing/webhook
   STRIPE_SECRET_KEY=sk_live_... .venv/Scripts/python -m backend.scripts.setup_stripe_plans --webhook-url https://api.carecliq.com.au/api/platform-billing/webhook --apply
   ```
3. Set the live `STRIPE_SECRET_KEY` and the printed `STRIPE_WEBHOOK_SECRET` on `carecliq-api`.
4. **(you)** Do what the script reports under "Dashboard settings": add the Australian GST registration and save the Customer Portal settings.

## 6. Go-live check

- Sign up at app.carecliq.com.au/get-started with a real card, finish director setup, check the welcome email arrives, then cancel and refund in Stripe.
- Sign in, add a participant through onboarding, report an incident, open the compliance centre.
- `flyctl logs --app carecliq-api` shows no errors; `https://api.carecliq.com.au/api/health` returns OK.
