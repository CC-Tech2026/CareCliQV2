CareScribe Supabase auth email setup

Required environment:

- `FRONTEND_URL` or `FRONTEND_BASE_URL`: public frontend URL, for example `https://app.carescribe.example`.
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_AUTO_CONFIRM_EMAIL=false` in production.

Supabase dashboard settings:

1. Open Authentication > URL Configuration.
2. Set Site URL to the production frontend URL.
3. Add redirect URLs:
   - `http://localhost:3000/login?verified=1`
   - `http://localhost:3000/reset-password`
   - `http://localhost:3000/verify-email`
   - your production `/login?verified=1`
   - your production `/reset-password`
   - your production `/verify-email`
4. Open Authentication > SMTP if using custom mail and configure the provider.
5. Create storage buckets:
   - `profile-photos`
   - `credential-files`
   - `invoice-files`
   - `report-files`

Google SMTP invitation email:

- `EMAIL_ENABLED=true`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USERNAME=<workspace-email>`
- `SMTP_PASSWORD=<google-app-password>`
- `SMTP_FROM_EMAIL=<workspace-email>`
- `SMTP_USE_STARTTLS=true`

Use a Google App Password generated from the sending account; do not use the normal account password.
