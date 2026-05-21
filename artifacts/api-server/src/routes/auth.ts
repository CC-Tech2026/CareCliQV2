import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { Router, type IRouter, type Request } from "express";
import { pool } from "@workspace/db";

const scrypt = promisify(scryptCallback);

type AccountType = "independent_worker" | "allied_health" | "small_provider";
type UserRole = "support_worker" | "allied_health" | "support_coordinator" | "admin";

const ACCOUNT_TYPE_TO_ROLE: Record<AccountType, UserRole> = {
  independent_worker: "support_worker",
  allied_health: "allied_health",
  small_provider: "support_coordinator",
};

const VALID_ACCOUNT_TYPES = new Set(Object.keys(ACCOUNT_TYPE_TO_ROLE));
const JWT_SECRET = process.env.SESSION_SECRET || "changeme-in-production";
const TOKEN_TTL_SECONDS = 60 * 60 * 24;
const ENABLE_DEMO_USERS = process.env.ENABLE_DEMO_USERS === "true";
const EXPOSE_RESET_LINK = process.env.EXPOSE_RESET_LINK === "true";

const router: IRouter = Router();

async function ensureAuthTables() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS local_auth_organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id uuid,
      organization_name text NOT NULL,
      provider_type text,
      registration_status text,
      team_size text,
      participant_volume text,
      contact_number text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS local_auth_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      full_name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'support_worker',
      account_type text NOT NULL DEFAULT 'independent_worker',
      onboarding_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      onboarding_complete boolean NOT NULL DEFAULT false,
      organization_id uuid REFERENCES local_auth_organizations(id) ON DELETE SET NULL,
      is_active boolean NOT NULL DEFAULT true,
      last_login timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS local_auth_password_resets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES local_auth_users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  if (!ENABLE_DEMO_USERS) return;

  let existingOrg = (
    await pool.query("SELECT id FROM local_auth_organizations WHERE organization_name = $1 ORDER BY created_at ASC LIMIT 1", [
      "Sunshine Demo",
    ])
  ).rows[0];

  if (!existingOrg) {
    existingOrg = (
      await pool.query(
        `
          INSERT INTO local_auth_organizations (organization_name, provider_type, registration_status, team_size, participant_volume)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        ["Sunshine Demo", "ndis_provider", "registered", "demo", "demo"],
      )
    ).rows[0];
  }

  if (!existingOrg?.id) return;

  const demoUsers = [
    {
      email: "sarah@sunshine-demo.com",
      password: "Sarahsunshine#2026",
      fullName: "Sarah Sunshine",
      role: "support_coordinator" as UserRole,
      accountType: "small_provider" as AccountType,
    },
    {
      email: "amara@sunshine-demo.com",
      password: "Amarasunshine#2026",
      fullName: "Amara Sunshine",
      role: "support_worker" as UserRole,
      accountType: "independent_worker" as AccountType,
    },
    {
      email: "daniel@sunshine-demo.com",
      password: "Danielsunshine#2026",
      fullName: "Daniel Sunshine",
      role: "allied_health" as UserRole,
      accountType: "allied_health" as AccountType,
    },
  ];

  for (const demo of demoUsers) {
    const passwordHash = await hashPassword(demo.password);
    await pool.query(
      `
        INSERT INTO local_auth_users (
          email, password_hash, full_name, role, account_type,
          organization_id, onboarding_complete, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, true, true)
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          account_type = EXCLUDED.account_type,
          organization_id = EXCLUDED.organization_id,
          onboarding_complete = true,
          is_active = true,
          updated_at = now()
      `,
      [demo.email, passwordHash, demo.fullName, demo.role, demo.accountType, existingOrg.id],
    );
  }
}

function hashOpaqueToken(token: string) {
  return createHmac("sha256", JWT_SECRET).update(token).digest("hex");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signToken(payload: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(body)}`;
  const signature = createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function verifyToken(token: string) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;

  const unsigned = `${header}.${payload}`;
  const expected = createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof decoded.exp === "number" && decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
}

function getBearerPayload(req: Request) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return verifyToken(match[1]);
}

function toClientUser(row: Record<string, any>) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name || "",
    role: row.role || "support_worker",
    account_type: row.account_type || "independent_worker",
    organization_id: row.organization_id || null,
    onboarding_complete: Boolean(row.onboarding_complete),
  };
}

function tokenFor(row: Record<string, any>) {
  return signToken({
    sub: row.id,
    email: row.email,
    role: row.role || "support_worker",
    account_type: row.account_type || "independent_worker",
    organization_id: row.organization_id || null,
  });
}

router.post("/auth/register", async (req, res, next) => {
  try {
    await ensureAuthTables();

    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.full_name || "").trim();
    const accountType = String(req.body?.account_type || "independent_worker") as AccountType;

    if (!email || !password || !fullName) {
      res.status(400).json({ detail: "Email, password, and full name are required." });
      return;
    }
    if (!VALID_ACCOUNT_TYPES.has(accountType)) {
      res.status(400).json({ detail: "Invalid account type." });
      return;
    }

    const existing = await pool.query("SELECT id FROM local_auth_users WHERE email = $1", [email]);
    if (existing.rowCount) {
      res.status(409).json({ detail: "An account with this email already exists. Please sign in." });
      return;
    }

    const passwordHash = await hashPassword(password);
    const role = ACCOUNT_TYPE_TO_ROLE[accountType];
    const inserted = await pool.query(
      `
        INSERT INTO local_auth_users (email, password_hash, full_name, role, account_type)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, email, full_name, role, account_type, organization_id, onboarding_complete
      `,
      [email, passwordHash, fullName, role, accountType],
    );

    res.status(201).json({
      message: "Account created successfully.",
      user_id: inserted.rows[0].id,
      account_type: accountType,
      role,
      email_confirmed: true,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    await ensureAuthTables();

    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const result = await pool.query("SELECT * FROM local_auth_users WHERE email = $1 AND is_active = true", [email]);
    const user = result.rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ detail: "Invalid email or password" });
      return;
    }

    await pool.query("UPDATE local_auth_users SET last_login = now() WHERE id = $1", [user.id]);
    res.json({
      access_token: tokenFor(user),
      token_type: "bearer",
      user: toClientUser(user),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/complete-onboarding", async (req, res, next) => {
  try {
    await ensureAuthTables();

    const tokenPayload = getBearerPayload(req);
    const userId = tokenPayload?.sub;
    if (typeof userId !== "string") {
      res.status(401).json({ detail: "Not authenticated" });
      return;
    }

    const accountType = String(req.body?.account_type || "independent_worker") as AccountType;
    if (!VALID_ACCOUNT_TYPES.has(accountType)) {
      res.status(400).json({ detail: "Invalid account type." });
      return;
    }

    let organizationId: string | null = null;
    let orgCreated = false;

    if (accountType === "small_provider" && req.body?.organization_name) {
      const org = await pool.query(
        `
          INSERT INTO local_auth_organizations (
            owner_user_id, organization_name, provider_type, registration_status,
            team_size, participant_volume, contact_number
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `,
        [
          userId,
          String(req.body.organization_name),
          req.body.provider_type || null,
          req.body.registration_status || null,
          req.body.team_size || null,
          req.body.participant_volume || null,
          req.body.contact_number || null,
        ],
      );
      organizationId = org.rows[0].id;
      orgCreated = true;
    }

    const updated = await pool.query(
      `
        UPDATE local_auth_users
        SET account_type = $2,
            role = $3,
            onboarding_data = $4::jsonb,
            onboarding_complete = true,
            organization_id = COALESCE($5::uuid, organization_id),
            updated_at = now()
        WHERE id = $1
        RETURNING id, email, full_name, role, account_type, organization_id, onboarding_complete
      `,
      [
        userId,
        accountType,
        ACCOUNT_TYPE_TO_ROLE[accountType],
        JSON.stringify(req.body?.onboarding_data || {}),
        organizationId,
      ],
    );

    const user = updated.rows[0];
    if (!user) {
      res.status(404).json({ detail: "User not found" });
      return;
    }

    res.json({
      success: true,
      message: "Onboarding complete.",
      org_created: orgCreated,
      organization_id: user.organization_id || null,
      access_token: tokenFor(user),
      token_type: "bearer",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ message: "Logged out successfully" });
});

router.post("/auth/password-reset/request", async (req, res, next) => {
  try {
    await ensureAuthTables();

    const email = String(req.body?.email || "").trim().toLowerCase();
    const result = await pool.query("SELECT id, email FROM local_auth_users WHERE email = $1 AND is_active = true", [email]);
    const user = result.rows[0];

    let resetUrl: string | undefined;
    if (user) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashOpaqueToken(token);
      await pool.query(
        `
          INSERT INTO local_auth_password_resets (user_id, token_hash, expires_at)
          VALUES ($1, $2, now() + interval '1 hour')
        `,
        [user.id, tokenHash],
      );
      const baseUrl = String(req.body?.redirect_base || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
      resetUrl = `${baseUrl || ""}/reset-password?token=${encodeURIComponent(token)}`;
      if (EXPOSE_RESET_LINK) {
        console.info("password reset requested", { email: user.email, resetUrl });
      }
    }

    res.json({
      message: "If an account exists for that email, a password reset link has been generated.",
      ...(EXPOSE_RESET_LINK && resetUrl ? { reset_url: resetUrl } : {}),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/password-reset/confirm", async (req, res, next) => {
  try {
    await ensureAuthTables();

    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (!token || password.length < 8) {
      res.status(400).json({ detail: "Reset token and a password of at least 8 characters are required." });
      return;
    }

    const tokenHash = hashOpaqueToken(token);
    const reset = await pool.query(
      `
        SELECT id, user_id
        FROM local_auth_password_resets
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        LIMIT 1
      `,
      [tokenHash],
    );
    const row = reset.rows[0];
    if (!row) {
      res.status(400).json({ detail: "Invalid or expired reset link." });
      return;
    }

    const passwordHash = await hashPassword(password);
    await pool.query("UPDATE local_auth_users SET password_hash = $1, updated_at = now() WHERE id = $2", [passwordHash, row.user_id]);
    await pool.query("UPDATE local_auth_password_resets SET used_at = now() WHERE id = $1", [row.id]);
    res.json({ message: "Password updated successfully." });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/me", async (req, res, next) => {
  try {
    await ensureAuthTables();

    const tokenPayload = getBearerPayload(req);
    const userId = tokenPayload?.sub;
    if (typeof userId !== "string") {
      res.status(401).json({ detail: "Not authenticated" });
      return;
    }

    const result = await pool.query(
      "SELECT id, email, full_name, role, account_type, organization_id, onboarding_complete FROM local_auth_users WHERE id = $1",
      [userId],
    );
    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ detail: "User not found" });
      return;
    }

    res.json({ user: toClientUser(user) });
  } catch (error) {
    next(error);
  }
});

export default router;
