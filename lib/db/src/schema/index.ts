import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const practitionerSettingsTable = pgTable("practitioner_settings", {
  id: text("id").primaryKey().default("default"),
  signature: text("signature"),
  name: text("name"),
  credentials: text("credentials"),
  avatarId: text("avatar_id"),
  provider: jsonb("provider"),
  sessionDefaults: jsonb("session_defaults"),
  compliance: jsonb("compliance"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertPractitionerSettingsSchema = createInsertSchema(
  practitionerSettingsTable
).omit({ updatedAt: true });

export type InsertPractitionerSettings = z.infer<
  typeof insertPractitionerSettingsSchema
>;
export type PractitionerSettings =
  typeof practitionerSettingsTable.$inferSelect;
