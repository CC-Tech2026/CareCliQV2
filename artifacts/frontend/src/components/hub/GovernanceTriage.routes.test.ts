import { expect, it } from "vitest";
import { attentionRoute } from "./GovernanceTriage";
import type { HubComplianceAlert } from "@/services/hubService";

const alert: HubComplianceAlert = { id: "alert", title: "Follow up", detail: "", severity: "high", action_label: "Review" };
it.each([
  [{ source: "incidents", incident_id: "incident-1" }, "/incidents/incident-1"],
  [{ source: "invoices", invoice_id: "invoice-1" }, "/billing?workspace=invoices&invoiceId=invoice-1"],
  [{ source: "credentials", worker_id: "worker-1" }, "/md/staff?workerId=worker-1&tab=credentials"],
  [{ source: "worker-compliance", worker_id: "worker-1" }, "/md/staff?workerId=worker-1&tab=shifts"],
  [{ source: "worker-notes", worker_id: "worker-1" }, "/md/staff?workerId=worker-1&tab=shifts"],
  [{ source: "shifts", shift_id: "shift-1" }, "/md/schedule?shiftId=shift-1"],
  [{ source: "participants", participant_id: "person-1" }, "/patients?id=person-1&tab=overview"],
])("opens the affected record for %j", (fields, path) => {
  expect(attentionRoute({ ...alert, ...fields })).toBe(path);
});
it("preserves custom destinations for other alert types", () => {
  expect(attentionRoute({ ...alert, source: "applicants" }, () => "/md/onboarding")).toBe("/md/onboarding");
});
