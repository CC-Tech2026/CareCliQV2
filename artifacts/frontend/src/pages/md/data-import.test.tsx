import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DataImportPage from "./data-import";

const { apiFetch, requireReAuth } = vi.hoisted(() => ({ apiFetch: vi.fn(), requireReAuth: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));
vi.mock("@/hooks/useReAuth", () => ({ useReAuth: () => ({ requireReAuth, modal: null }) }));
vi.mock("@/components/layout/HubLayout", () => ({ HubLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const PARSED = {
  headers: ["Client Name", "NDIS No.", "DOB"],
  rows: [["Mia Thompson", "430123456", "12/03/1985"], ["Jack Nguyen", "123", "01/01/1990"]],
  suggested_mapping: { full_name: "Client Name", ndis_number: "NDIS No.", date_of_birth: "DOB" },
};
const RESULTS = [
  { row: 1, status: "ready", errors: [], warnings: [], record: { full_name: "Mia Thompson" } },
  { row: 2, status: "error", errors: ["NDIS number should be 9 digits."], warnings: [], record: { full_name: "Jack Nguyen" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  requireReAuth.mockImplementation((action: () => Promise<unknown>) => action());
});
afterEach(cleanup);

function upload() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "clients.csv", { type: "text/csv" })] } });
}

it("takes a participant export from upload to the onboarding board", async () => {
  apiFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/data-import/parse") return json(PARSED);
    if (url === "/api/data-import/participants/preview") return json({ results: RESULTS });
    if (url === "/api/data-import/participants") {
      const body = JSON.parse(String(init?.body));
      expect(body.records[0]).toEqual({ full_name: "Mia Thompson", ndis_number: "430123456", date_of_birth: "12/03/1985" });
      return json({ imported: 1, results: RESULTS });
    }
    throw new Error(`unexpected ${url}`);
  });
  render(<DataImportPage />);
  upload();

  expect(await screen.findByText("Match your columns")).toBeTruthy();
  expect((screen.getByLabelText("Column for NDIS number") as HTMLSelectElement).value).toBe("NDIS No.");
  fireEvent.click(screen.getByRole("button", { name: /Check 2 rows/ }));

  expect(await screen.findByText("NDIS number should be 9 digits.")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Download rows to fix/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add 1 participant to onboarding" }));

  expect(await screen.findByText("1 participant is on your onboarding board")).toBeTruthy();
  expect(requireReAuth).not.toHaveBeenCalled();
});

it("won't check rows until the required columns are chosen", async () => {
  apiFetch.mockImplementation(() => json({ ...PARSED, suggested_mapping: { full_name: "Client Name" } }));
  render(<DataImportPage />);
  upload();
  expect(await screen.findByText(/Choose a column for NDIS number, Date of birth/)).toBeTruthy();
  expect((screen.getByRole("button", { name: /Check 2 rows/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("asks for the password before emailing staff invitations", async () => {
  apiFetch.mockImplementation((url: string) => {
    if (url === "/api/data-import/parse") return json({ headers: ["Email"], rows: [["ava@example.com"]], suggested_mapping: { email: "Email" } });
    if (url === "/api/data-import/staff/preview") return json({ results: [{ row: 1, status: "ready", errors: [], warnings: [], record: { email: "ava@example.com", role: "support_worker" } }] });
    if (url === "/api/data-import/staff") return json({ imported: 1, results: [] });
    throw new Error(`unexpected ${url}`);
  });
  render(<DataImportPage />);
  fireEvent.click(screen.getByRole("tab", { name: /Staff/ }));
  upload();
  fireEvent.click(await screen.findByRole("button", { name: /Check 1 row/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Send 1 invitation" }));
  await waitFor(() => expect(requireReAuth).toHaveBeenCalledOnce());
  expect(await screen.findByText("1 invitation was sent")).toBeTruthy();
});
