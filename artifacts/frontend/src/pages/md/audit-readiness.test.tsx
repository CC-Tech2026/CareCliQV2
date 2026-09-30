import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import AuditReadinessPage from "./audit-readiness";
import { outstandingItemsCsv, type AuditChecklist, type AuditItem } from "@/services/auditReadinessService";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: mocks.api }));
vi.mock("@/components/layout/HubLayout", () => ({
  HubLayout: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));

function item(overrides: Partial<AuditItem>): AuditItem {
  return {
    id: "GOV-RISK:organisation:org",
    requirement_code: "GOV-RISK",
    area: "governance",
    title: "Risk management",
    critical: true,
    subject_type: "organisation",
    subject_id: null,
    subject_name: "Sunshine Care",
    status: "missing",
    applies_reason: "Applies to every registered provider.",
    due_date: null,
    next_action: "Add or link evidence.",
    evidence: [],
    not_applicable: null,
    ...overrides,
  };
}

const items: AuditItem[] = [
  item({}),
  item({
    id: "STAFF-SCREENING:worker:w1",
    requirement_code: "STAFF-SCREENING",
    area: "staff",
    title: "NDIS Worker Screening clearance",
    subject_type: "worker",
    subject_id: "w1",
    subject_name: "Wren Walker",
    status: "current",
    next_action: "No action needed.",
  }),
  item({
    id: "GOV-POLICIES:organisation:org",
    requirement_code: "GOV-POLICIES",
    title: "Governance and operational policies",
    critical: false,
    status: "awaiting_review",
    next_action: "Check the evidence and approve or reject it.",
    evidence: [{
      source_table: "governance_documents", source_id: "g1", title: "Governance policy", kind: "auto",
      status: "awaiting_review", detail: "Needs review by an authorised person.", date: "2026-02-01",
      due_date: null, vault_category: "governance_operational", reviewable: true, link_id: null,
      review_status: null, reviewed_by: null, reviewed_at: null, review_note: null,
    }],
  }),
];

const checklist: AuditChecklist = {
  generated_at: "2026-09-30T00:00:00Z",
  profile_configured: false,
  summary: {
    total: 3,
    applicable: 3,
    counts: { missing: 1, awaiting_review: 1, current: 1, due_soon: 0, overdue: 0, not_applicable: 0 },
    readiness_percent: 33,
    critical_gaps: 1,
    by_area: [
      { area: "staff", label: "Staff and key personnel", total: 1, ready: 1, gaps: 0 },
      { area: "governance", label: "Governance and policies", total: 2, ready: 0, gaps: 1 },
    ],
  },
  items,
};

function renderAt(path: string) {
  mocks.api.mockImplementation((url: string) => {
    const body = url.endsWith("/checklist") ? checklist : url.endsWith("/requirements") ? { requirements: [] } : {};
    return Promise.resolve({ ok: true, json: async () => body });
  });
  const { hook, searchHook } = memoryLocation({ path, record: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook} searchHook={searchHook}>
        <AuditReadinessPage />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("reports evidence readiness without claiming compliance", async () => {
  renderAt("/md/audit-readiness");
  expect(await screen.findByText("33%")).toBeTruthy();
  expect(screen.getByText(/doesn't determine compliance/)).toBeTruthy();
  expect(screen.queryByText(/NDIS compliant/i)).toBeNull();
  // Profile not set up yet: prompt for it.
  expect(screen.getByRole("button", { name: "Set up audit profile" })).toBeTruthy();
});

it("critical gaps tile opens the checklist filtered to them", async () => {
  renderAt("/md/audit-readiness");
  fireEvent.click(await screen.findByRole("button", { name: /Critical gaps/ }));
  expect(await screen.findByText("1 of 3 items")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Risk management/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Worker Screening/ })).toBeNull();
});

it("opens an item's side panel with its evidence and next action", async () => {
  renderAt("/md/audit-readiness?view=checklist");
  fireEvent.click(await screen.findByRole("button", { name: /Governance and operational policies/ }));
  const panel = await screen.findByRole("dialog");
  expect(within(panel).getByText("Check the evidence and approve or reject it.")).toBeTruthy();
  expect(within(panel).getByText("Governance policy")).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Approve" })).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Mark not applicable" })).toBeTruthy();
});

it("outstanding items CSV leaves out what's already current", () => {
  const csv = outstandingItemsCsv(items).split("\n");
  expect(csv[0]).toBe("Area,Requirement,Critical,For,Status,Due,Next action");
  expect(csv).toHaveLength(3);
  expect(csv.some((line) => line.includes("Worker Screening"))).toBe(false);
});
