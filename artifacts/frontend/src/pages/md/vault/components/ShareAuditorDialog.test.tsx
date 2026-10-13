import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareAuditorDialog, type ShareSource } from "./ShareAuditorDialog";

type ZipOptions = { extras?: { name: string; content: string }[]; folderFor?: (ref: { category: string; id: string }) => string | undefined };
const buildVaultZip = vi.fn(async (refs: unknown[], _progress?: unknown, _options?: ZipOptions) => ({
  blob: new Blob(["zip"]),
  documentCount: refs.length,
}));
vi.mock("@/lib/vaultZip", () => ({
  buildVaultZip: (refs: unknown[], progress: unknown, options: ZipOptions) => buildVaultZip(refs, progress, options),
  triggerBlobDownload: vi.fn(),
}));
vi.mock("@/services/vaultService", () => ({
  logShareEvent: vi.fn(async () => undefined),
  fetchVaultFolders: vi.fn(async () => []),
  fetchFolderDocuments: vi.fn(async () => []),
  fetchCustomizableFields: vi.fn(async () => ({ session_notes: ["Notes", "Signature"] })),
  fetchDocumentFile: vi.fn(async () => ({ filename: "doc.pdf", blob: new Blob(["%PDF"], { type: "application/pdf" }) })),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { full_name: "Alex Director", role: "managing_director" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  buildVaultZip.mockClear();
});

const recent = new Date(Date.now() - 10 * 86400000).toISOString();
const old = new Date(Date.now() - 400 * 86400000).toISOString();

const notes: ShareSource = {
  key: "session_notes",
  label: "Session & Progress Notes",
  count: 2,
  load: async () => [
    { category: "session_notes", id: "n1", title: "Support work note", person_name: "Lily Parker", date: recent, folder_label: "Session & Progress Notes" },
    { category: "session_notes", id: "n2", title: "Support work note", person_name: "Noah Patel", date: old, folder_label: "Session & Progress Notes" },
  ],
};
const incidents: ShareSource = {
  key: "incident_reports",
  label: "Incident Reports",
  count: 1,
  load: async () => [{ category: "incident_reports", id: "i1", title: "Fall", date: recent, folder_label: "Incident Reports" }],
};

const downloadButton = () => screen.getByRole("button", { name: /Download pack/ }) as HTMLButtonElement;

it("opens with the folder ticked and previewed, so Download is one click away", async () => {
  render(<ShareAuditorDialog open onOpenChange={vi.fn()} targetDescription="Session & Progress Notes" preselect={[notes]} folderOptions={[incidents]} />);
  await waitFor(() => expect(downloadButton().textContent).toContain("(2)"));
  expect(await screen.findByTitle("Support work note")).toBeTruthy(); // the big preview

  fireEvent.click(downloadButton());
  await waitFor(() => expect(buildVaultZip).toHaveBeenCalled());
  const [, , options] = buildVaultZip.mock.calls[0];
  expect(options!.extras!.map((e) => e.name)).toEqual(["00 Cover note.html", "Document register.csv"]);
});

it("narrows to a time period and takes in another folder", async () => {
  render(<ShareAuditorDialog open onOpenChange={vi.fn()} targetDescription="Notes" preselect={[notes]} folderOptions={[incidents]} />);
  await waitFor(() => expect(downloadButton().textContent).toContain("(2)"));

  fireEvent.change(screen.getByLabelText("Time period"), { target: { value: "3m" } });
  await waitFor(() => expect(downloadButton().textContent).toContain("(1)")); // the old note drops out

  fireEvent.click(screen.getByRole("button", { name: /Add a folder/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Incident Reports/ }));
  await waitFor(() => expect(downloadButton().textContent).toContain("(2)"));
});

it("hides a field in one document, then in every ticked document like it", async () => {
  render(<ShareAuditorDialog open onOpenChange={vi.fn()} targetDescription="Notes" preselect={[notes]} folderOptions={[]} />);
  await waitFor(() => expect(downloadButton().textContent).toContain("(2)"));

  fireEvent.click(await screen.findByRole("button", { name: "Signature" }));
  fireEvent.click(screen.getByRole("button", { name: /Apply to all 2 ticked/ }));
  expect(screen.getAllByText(/1 hidden/)).toHaveLength(2);

  fireEvent.click(downloadButton());
  await waitFor(() => expect(buildVaultZip).toHaveBeenCalled());
  const [refs] = buildVaultZip.mock.calls[0];
  expect(refs).toEqual([
    { category: "session_notes", id: "n1", exclude_fields: ["Signature"] },
    { category: "session_notes", id: "n2", exclude_fields: ["Signature"] },
  ]);
});
