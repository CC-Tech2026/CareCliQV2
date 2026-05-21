import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";

type AuthUser = {
  id: string;
  email: string;
  role: string;
  organizationId: string;
};

type ParticipantRow = {
  id: string;
  organization_id: string;
  full_name: string;
  ndis_number: string;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  plan_status: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
  total_budget: string | number | null;
  used_budget: string | number | null;
  primary_disability: string | null;
  biological_sex: string | null;
  goals: unknown;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

const JWT_SECRET = process.env.SESSION_SECRET || "changeme-in-production";
const COORDINATOR_ROLES = new Set(["support_coordinator", "admin"]);
const ASSIGNED_ROLES = new Set(["support_worker", "allied_health"]);
const router: IRouter = Router();

let tablesReady: Promise<void> | null = null;

async function ensureParticipantTables() {
  tablesReady ??= pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS local_participants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      full_name text NOT NULL,
      ndis_number text NOT NULL DEFAULT '',
      date_of_birth date,
      email text,
      phone text,
      address text,
      plan_status text NOT NULL DEFAULT 'active',
      plan_start_date date,
      plan_end_date date,
      total_budget numeric NOT NULL DEFAULT 0,
      used_budget numeric NOT NULL DEFAULT 0,
      primary_disability text,
      biological_sex text,
      allergies text,
      communication_preferences text,
      goals jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_local_participants_org
      ON local_participants (organization_id);

    CREATE TABLE IF NOT EXISTS local_participant_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      participant_id uuid NOT NULL REFERENCES local_participants(id) ON DELETE CASCADE,
      user_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      assignment_role text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      assigned_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (participant_id, user_id, assignment_role)
    );

    CREATE INDEX IF NOT EXISTS idx_local_participant_assignments_user
      ON local_participant_assignments (user_id);
    CREATE INDEX IF NOT EXISTS idx_local_participant_assignments_participant
      ON local_participant_assignments (participant_id);
    CREATE INDEX IF NOT EXISTS idx_local_participant_assignments_org
      ON local_participant_assignments (organization_id);
  `).then(() => undefined);

  await tablesReady;
}

function verifyToken(token: string) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;

  const unsigned = `${header}.${payload}`;
  const expected = createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url");

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof decoded.exp === "number" && decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
}

function getAuthUser(req: Request): AuthUser | null {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;

  const payload = verifyToken(match[1]);
  if (!payload) return null;

  const id = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  const role = typeof payload.role === "string" ? payload.role : "";
  const organizationId = typeof payload.organization_id === "string" ? payload.organization_id : "";

  if (!id || !role || !organizationId) return null;
  return { id, email, role, organizationId };
}

function requireAuth(req: Request, res: Response): AuthUser | null {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ detail: "Authentication required" });
    return null;
  }
  return user;
}

function isCoordinator(user: AuthUser) {
  return COORDINATOR_ROLES.has(user.role);
}

function canUseAssignmentScope(user: AuthUser) {
  return ASSIGNED_ROLES.has(user.role);
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function toParticipant(row: ParticipantRow) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    full_name: row.full_name,
    ndis_number: row.ndis_number,
    date_of_birth: normalizeDate(row.date_of_birth),
    email: row.email,
    phone: row.phone,
    address: row.address,
    plan_status: row.plan_status,
    plan_start_date: normalizeDate(row.plan_start_date),
    plan_end_date: normalizeDate(row.plan_end_date),
    total_budget: normalizeMoney(row.total_budget),
    used_budget: normalizeMoney(row.used_budget),
    primary_disability: row.primary_disability,
    biological_sex: row.biological_sex,
    goals: Array.isArray(row.goals) ? row.goals : [],
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

async function getAccessibleParticipant(user: AuthUser, participantId: string) {
  if (isCoordinator(user)) {
    const result = await pool.query<ParticipantRow>(
      "SELECT * FROM local_participants WHERE id = $1 AND organization_id = $2 LIMIT 1",
      [participantId, user.organizationId],
    );
    return result.rows[0] ?? null;
  }

  if (!canUseAssignmentScope(user)) return null;

  const result = await pool.query<ParticipantRow>(
    `
      SELECT p.*
      FROM local_participants p
      INNER JOIN local_participant_assignments a
        ON a.participant_id = p.id
       AND a.organization_id = p.organization_id
       AND a.status = 'active'
      WHERE p.id = $1
        AND p.organization_id = $2
        AND a.user_id = $3
      LIMIT 1
    `,
    [participantId, user.organizationId, user.id],
  );
  return result.rows[0] ?? null;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  const text = cleanString(value);
  return text || null;
}

function optionalDate(value: unknown) {
  const text = cleanString(value);
  return text || null;
}

router.get("/participants", async (req, res, next) => {
  try {
    await ensureParticipantTables();
    const user = requireAuth(req, res);
    if (!user) return;

    if (isCoordinator(user)) {
      const result = await pool.query<ParticipantRow>(
        "SELECT * FROM local_participants WHERE organization_id = $1 ORDER BY created_at DESC",
        [user.organizationId],
      );
      res.json(result.rows.map(toParticipant));
      return;
    }

    if (!canUseAssignmentScope(user)) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }

    const result = await pool.query<ParticipantRow>(
      `
        SELECT p.*
        FROM local_participants p
        INNER JOIN local_participant_assignments a
          ON a.participant_id = p.id
         AND a.organization_id = p.organization_id
         AND a.status = 'active'
        WHERE p.organization_id = $1
          AND a.user_id = $2
        ORDER BY p.created_at DESC
      `,
      [user.organizationId, user.id],
    );
    res.json(result.rows.map(toParticipant));
  } catch (error) {
    next(error);
  }
});

router.get("/participants/dashboard-stats", async (req, res, next) => {
  try {
    await ensureParticipantTables();
    const user = requireAuth(req, res);
    if (!user) return;

    if (!isCoordinator(user) && !canUseAssignmentScope(user)) {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }

    const rows = isCoordinator(user)
      ? await pool.query<{ total: string; active: string }>(
          `
            SELECT
              count(*)::text AS total,
              count(*) FILTER (WHERE plan_status = 'active')::text AS active
            FROM local_participants
            WHERE organization_id = $1
          `,
          [user.organizationId],
        )
      : await pool.query<{ total: string; active: string }>(
          `
            SELECT
              count(DISTINCT p.id)::text AS total,
              count(DISTINCT p.id) FILTER (WHERE p.plan_status = 'active')::text AS active
            FROM local_participants p
            INNER JOIN local_participant_assignments a
              ON a.participant_id = p.id
             AND a.organization_id = p.organization_id
             AND a.status = 'active'
            WHERE p.organization_id = $1
              AND a.user_id = $2
          `,
          [user.organizationId, user.id],
        );

    const stats = rows.rows[0] ?? { total: "0", active: "0" };
    res.json({
      total_participants: Number(stats.total),
      sessions_this_week: 0,
      notes_missing: 0,
      compliance_alerts: 0,
      active_participants: Number(stats.active),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/participants", async (req, res, next) => {
  try {
    await ensureParticipantTables();
    const user = requireAuth(req, res);
    if (!user) return;

    if (!isCoordinator(user)) {
      res.status(403).json({ detail: "Only coordinators can create participants" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const fullName = cleanString(body.full_name);
    const ndisNumber = cleanString(body.ndis_number);

    if (!fullName || !ndisNumber) {
      res.status(422).json({ detail: "full_name and ndis_number are required" });
      return;
    }

    const result = await pool.query<ParticipantRow>(
      `
        INSERT INTO local_participants (
          organization_id, full_name, ndis_number, date_of_birth, email, phone,
          address, plan_status, plan_start_date, plan_end_date, total_budget,
          used_budget, primary_disability, biological_sex, allergies,
          communication_preferences, goals
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'active'), $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
        RETURNING *
      `,
      [
        user.organizationId,
        fullName,
        ndisNumber,
        optionalDate(body.date_of_birth),
        optionalString(body.email),
        optionalString(body.phone),
        optionalString(body.address),
        optionalString(body.plan_status),
        optionalDate(body.plan_start_date),
        optionalDate(body.plan_end_date),
        normalizeMoney(body.total_budget),
        normalizeMoney(body.used_budget),
        optionalString(body.primary_disability),
        optionalString(body.biological_sex),
        optionalString(body.allergies),
        optionalString(body.communication_preferences),
        JSON.stringify(Array.isArray(body.goals) ? body.goals : []),
      ],
    );

    res.status(201).json(toParticipant(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.get("/participants/:participantId", async (req, res, next) => {
  try {
    await ensureParticipantTables();
    const user = requireAuth(req, res);
    if (!user) return;

    const participant = await getAccessibleParticipant(user, req.params.participantId);
    if (!participant) {
      res.status(403).json({ detail: "Participant access denied" });
      return;
    }

    res.json(toParticipant(participant));
  } catch (error) {
    next(error);
  }
});

router.patch("/participants/:participantId", async (req, res, next) => {
  try {
    await ensureParticipantTables();
    const user = requireAuth(req, res);
    if (!user) return;

    if (!isCoordinator(user)) {
      res.status(403).json({ detail: "Only coordinators can update participants" });
      return;
    }

    const existing = await getAccessibleParticipant(user, req.params.participantId);
    if (!existing) {
      res.status(403).json({ detail: "Participant access denied" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const result = await pool.query<ParticipantRow>(
      `
        UPDATE local_participants SET
          full_name = COALESCE($3, full_name),
          email = COALESCE($4, email),
          phone = COALESCE($5, phone),
          address = COALESCE($6, address),
          plan_status = COALESCE($7, plan_status),
          total_budget = COALESCE($8, total_budget),
          used_budget = COALESCE($9, used_budget),
          primary_disability = COALESCE($10, primary_disability),
          biological_sex = COALESCE($11, biological_sex),
          goals = COALESCE($12::jsonb, goals),
          updated_at = now()
        WHERE id = $1 AND organization_id = $2
        RETURNING *
      `,
      [
        req.params.participantId,
        user.organizationId,
        optionalString(body.full_name),
        optionalString(body.email),
        optionalString(body.phone),
        optionalString(body.address),
        optionalString(body.plan_status),
        body.total_budget === undefined ? null : normalizeMoney(body.total_budget),
        body.used_budget === undefined ? null : normalizeMoney(body.used_budget),
        optionalString(body.primary_disability),
        optionalString(body.biological_sex),
        body.goals === undefined ? null : JSON.stringify(Array.isArray(body.goals) ? body.goals : []),
      ],
    );

    res.json(toParticipant(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.patch("/participants/:participantId/goals", async (req, res, next) => {
  try {
    await ensureParticipantTables();
    const user = requireAuth(req, res);
    if (!user) return;

    if (!isCoordinator(user) && user.role !== "allied_health") {
      res.status(403).json({ detail: "Insufficient permissions" });
      return;
    }

    const existing = await getAccessibleParticipant(user, req.params.participantId);
    if (!existing) {
      res.status(403).json({ detail: "Participant access denied" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const goals = Array.isArray(body.goals) ? body.goals : [];
    const result = await pool.query<ParticipantRow>(
      `
        UPDATE local_participants
        SET goals = $3::jsonb, updated_at = now()
        WHERE id = $1 AND organization_id = $2
        RETURNING *
      `,
      [req.params.participantId, user.organizationId, JSON.stringify(goals)],
    );

    res.json(toParticipant(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete("/participants/:participantId", async (req, res, next) => {
  try {
    await ensureParticipantTables();
    const user = requireAuth(req, res);
    if (!user) return;

    if (!isCoordinator(user)) {
      res.status(403).json({ detail: "Only coordinators can delete participants" });
      return;
    }

    const result = await pool.query(
      "DELETE FROM local_participants WHERE id = $1 AND organization_id = $2",
      [req.params.participantId, user.organizationId],
    );

    if (result.rowCount === 0) {
      res.status(403).json({ detail: "Participant access denied" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
