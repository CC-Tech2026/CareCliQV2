# Service Key Rotation Procedure

## When to rotate

- Suspected key compromise or accidental exposure
- Departing team member had access to production secrets
- Routine security rotation (recommended every 90 days)
- After a failed CI run that may have logged secrets

---

## Steps

### 1. Generate new key in Supabase

1. Open **Supabase Dashboard → Project Settings → API**
2. Under **Service Role Key**, click **Regenerate**
3. Copy the new key — it is shown only once

### 2. Update environment variables

**Docker / self-hosted:**
```bash
# In your .env or docker-compose environment
SUPABASE_SERVICE_ROLE_KEY=<new-key>
```

**CI (GitHub Actions):**
1. Go to **Repo → Settings → Secrets and variables → Actions**
2. Update `SUPABASE_SERVICE_ROLE_KEY` with the new value

### 3. Redeploy the backend

```bash
docker compose build backend && docker compose up -d backend
```

Verify the backend is healthy:
```bash
curl https://<your-domain>/api/health
```

### 4. Verify old key is invalidated

The old key is immediately invalidated when you regenerate in Supabase. Confirm by making a request with the old key — it should return `401`.

### 5. Rotate anon key (if also compromised)

Repeat steps 1–3 for the **anon key** (`SUPABASE_ANON_KEY`). Note: the anon key is safe to expose publicly but should still be rotated if compromised.

---

## What NOT to do

- Never commit either key to git
- Never log the service role key (check backend startup logs)
- Never pass `SUPABASE_SERVICE_ROLE_KEY` to the frontend build — only `VITE_`-prefixed vars are safe for the browser bundle

---

## Verification checklist

- [ ] New key works: `GET /api/health` returns 200
- [ ] Old key is dead: request with old key returns 401
- [ ] CI secrets updated and isolation tests pass
- [ ] No key visible in frontend bundle (`grep -r "service_role" artifacts/frontend/dist/`)
