import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router, Route, useSearch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ComplianceWorkspace, { LegacyAuditRedirect } from "./compliance-workspace";

vi.mock("@/components/layout/HubLayout", () => ({ HubLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ProtectedRoute", () => ({ ProtectedRoute: ({ children }: any) => children }));
vi.mock("./compliance", () => ({ default: () => <p>Quality metrics loaded</p> }));
vi.mock("./audit-readiness", () => ({ default: () => <p>Evidence workspace loaded</p> }));
afterEach(cleanup);

it("offers all four views inside one compliance workspace", () => {
  const { hook, searchHook } = memoryLocation({ path: "/md/compliance", record: true });
  render(<Router hook={hook} searchHook={searchHook}><ComplianceWorkspace /></Router>);
  expect(screen.getByRole("heading", { name: "Audit & Compliance" })).toBeTruthy();
  expect(screen.getByText("Quality metrics loaded")).toBeTruthy();
  for (const label of ["Evidence overview", "Evidence checklist", "Audit packs"]) {
    fireEvent.click(screen.getByRole("link", { name: new RegExp(label) }));
    expect(screen.getByRole("link", { name: new RegExp(label) }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Evidence workspace loaded")).toBeTruthy();
  }
});

it("preserves checklist filters and the selected item from legacy audit links", async () => {
  function Destination() { return <p>Unified destination: {useSearch()}</p>; }
  const { hook, searchHook } = memoryLocation({ path: "/md/audit-readiness?view=checklist&status=gaps&item=test-item", record: true });
  render(<Router hook={hook} searchHook={searchHook}><Route path="/md/audit-readiness"><LegacyAuditRedirect /></Route><Route path="/md/compliance"><Destination /></Route></Router>);
  const destination = await screen.findByText(/Unified destination:/);
  expect(destination.textContent).toContain("view=checklist");
  expect(destination.textContent).toContain("status=gaps");
  expect(destination.textContent).toContain("item=test-item");
});
