import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { practitionerSettingsTable } from "@workspace/db/schema";
import {
  GetPractitionerSettingsResponse,
  SavePractitionerSettingsBody,
  SavePractitionerSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/settings/practitioner", async (req, res) => {
  const rows = await db.select().from(practitionerSettingsTable).limit(1);
  if (rows.length === 0) {
    const data = GetPractitionerSettingsResponse.parse({ id: "default" });
    res.json(data);
    return;
  }
  const row = rows[0];
  const data = GetPractitionerSettingsResponse.parse({
    id: row.id,
    signature: row.signature ?? null,
    name: row.name ?? null,
    credentials: row.credentials ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
  });
  res.json(data);
});

router.put("/settings/practitioner", async (req, res) => {
  const body = SavePractitionerSettingsBody.parse(req.body);

  const existing = await db
    .select()
    .from(practitionerSettingsTable)
    .limit(1);

  const current = existing[0] ?? {
    signature: null,
    name: null,
    credentials: null,
  };

  const merged = {
    signature: body.signature !== undefined ? (body.signature ?? null) : current.signature,
    name: body.name !== undefined ? (body.name ?? null) : current.name,
    credentials:
      body.credentials !== undefined
        ? (body.credentials ?? null)
        : current.credentials,
  };

  const upserted = await db
    .insert(practitionerSettingsTable)
    .values({ id: "default", ...merged })
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
    updated_at: row.updatedAt?.toISOString() ?? null,
  });
  res.json(data);
});

export default router;
