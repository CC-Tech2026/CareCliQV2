import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { practitionerSettingsTable } from "@workspace/db/schema";
import {
  GetPractitionerSettingsResponse,
  SavePractitionerSettingsBody,
  SavePractitionerSettingsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// All practitioner-settings routes require a valid backend-issued session and
// are scoped to the authenticated user (rows keyed by the user id).
router.use(requireAuth);

router.get("/settings/practitioner", async (req, res) => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(practitionerSettingsTable)
    .where(eq(practitionerSettingsTable.id, userId))
    .limit(1);
  if (rows.length === 0) {
    const data = GetPractitionerSettingsResponse.parse({ id: userId });
    res.json(data);
    return;
  }
  const row = rows[0];
  const data = GetPractitionerSettingsResponse.parse({
    id: row.id,
    signature: row.signature ?? null,
    name: row.name ?? null,
    credentials: row.credentials ?? null,
    avatarId: row.avatarId ?? null,
    provider: row.provider ?? null,
    sessionDefaults: row.sessionDefaults ?? null,
    compliance: row.compliance ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
  });
  res.json(data);
});

router.put("/settings/practitioner", async (req, res) => {
  const userId = req.userId!;
  const body = SavePractitionerSettingsBody.parse(req.body);

  const existing = await db
    .select()
    .from(practitionerSettingsTable)
    .where(eq(practitionerSettingsTable.id, userId))
    .limit(1);

  const current = existing[0] ?? {
    signature: null,
    name: null,
    credentials: null,
    avatarId: null,
    provider: null,
    sessionDefaults: null,
    compliance: null,
  };

  const merged = {
    signature: body.signature !== undefined ? (body.signature ?? null) : current.signature,
    name: body.name !== undefined ? (body.name ?? null) : current.name,
    credentials:
      body.credentials !== undefined
        ? (body.credentials ?? null)
        : current.credentials,
    avatarId:
      body.avatarId !== undefined
        ? (body.avatarId ?? null)
        : current.avatarId,
    provider:
      body.provider !== undefined
        ? (body.provider ?? null)
        : (current.provider as typeof body.provider ?? null),
    sessionDefaults:
      body.sessionDefaults !== undefined
        ? (body.sessionDefaults ?? null)
        : (current.sessionDefaults as typeof body.sessionDefaults ?? null),
    compliance:
      body.compliance !== undefined
        ? (body.compliance ?? null)
        : (current.compliance as typeof body.compliance ?? null),
  };

  const upserted = await db
    .insert(practitionerSettingsTable)
    .values({ id: userId, ...merged })
    .onConflictDoUpdate({
      target: practitionerSettingsTable.id,
      set: { ...merged, updatedAt: new Date() },
    })
    .returning();

  const row = upserted[0];
  const data = SavePractitionerSettingsResponse.parse({
    id: row.id,
    signature: row.signature ?? null,
    name: row.name ?? null,
    credentials: row.credentials ?? null,
    avatarId: row.avatarId ?? null,
    provider: row.provider ?? null,
    sessionDefaults: row.sessionDefaults ?? null,
    compliance: row.compliance ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
  });
  res.json(data);
});

export default router;
