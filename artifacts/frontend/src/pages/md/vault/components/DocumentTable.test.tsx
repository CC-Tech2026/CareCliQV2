import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DocumentTable } from "./DocumentTable";
import type { VaultDocument } from "@/services/vaultService";

afterEach(cleanup);

const base: VaultDocument = {
  id: "s1",
  category: "session_notes",
  folder_label: "Session & Progress Notes",
  title: "Support work note",
  person_name: "Noah Patel",
  person_type: "Participant",
  date: "2026-09-25",
  status: "completed",
  source_table: "sessions",
  source_id: "s1",
  has_stored_file: false,
};

function renderTable(documents: VaultDocument[]) {
  render(
    <DocumentTable
      documents={documents}
      selectedIds={new Set()}
      onToggle={vi.fn()}
      onToggleAll={vi.fn()}
      onDownload={vi.fn()}
    />,
  );
}

it("tells same-titled documents apart by ID, person ID and source", () => {
  renderTable([
    { ...base, doc_id: "SUNR-SN-000047", person_ref: "NDIS 430118562", source_label: "Shift session note" },
    { ...base, id: "s2", source_id: "s2", doc_id: "SUNR-SN-000048", person_ref: "NDIS 430118562", source_label: "Shift session note" },
  ]);
  expect(screen.getByText("SUNR-SN-000047")).toBeTruthy();
  expect(screen.getByText("SUNR-SN-000048")).toBeTruthy();
  expect(screen.getAllByText(/Noah Patel \(NDIS 430118562\) · Shift session note/)).toHaveLength(2);
});

it("shows the version of a document that has been revised", () => {
  renderTable([{ ...base, title: "Risk Management Policy", doc_id: "SUNR-POL-000001", version: 3 }]);
  expect(screen.getByText("v3")).toBeTruthy();
});

it("still lists documents before IDs are assigned", () => {
  renderTable([base]);
  expect(screen.getByText("Support work note")).toBeTruthy();
  expect(screen.queryByText(/SUNR-/)).toBeNull();
});
