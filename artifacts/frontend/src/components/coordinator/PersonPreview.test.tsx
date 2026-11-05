import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PersonPreview } from "./PersonPreview";
import { PersonDetailsProvider } from "./PersonDetails";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "md1", organizationId: "org1", role: "managing_director" },
  }),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: unknown[]) => ({
    data: key.includes("participant")
      ? {
          id: "p1",
          full_name: "Ava Participant",
          phone: "0400 123 456",
          email: "ava@example.test",
        }
      : [
          {
            id: "w1",
            full_name: "Sam Taylor",
            phone: "0400 111 222",
            email: "sam@example.test",
            avg_compliance: 95,
          },
        ],
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/team/WorkerDetail", () => ({
  WorkerDetail: ({ worker, onBack }: any) => (
    <div>
      <p>Worker record: {worker.full_name}</p>
      <button onClick={onBack}>Back to roster</button>
    </div>
  ),
}));
vi.mock("@/pages/patients", () => ({
  ParticipantDetail: ({ id, syncUrl }: any) => (
    <p>
      Participant record: {id}, URL sync {String(syncUrl)}
    </p>
  ),
}));
afterEach(cleanup);
function view(children: React.ReactNode) {
  return render(
    <PersonDetailsProvider>
      <p>Current calendar week</p>
      {children}
    </PersonDetailsProvider>,
  );
}

it("shows worker contact details and opens the full profile without navigating", async () => {
  const openShift = vi.fn();
  const originalUrl = window.location.href;
  view(
    <div onClick={openShift}>
      <PersonPreview
        id="w1"
        name="Sam Taylor"
        kind="worker"
        scheduledHours={12}
        maxHours={30}
      />
    </div>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Quick details for Sam Taylor" }),
  );
  expect(await screen.findByText("12.0 hours / 30 hour limit")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "0400 111 222" }).getAttribute("href"),
  ).toBe("tel:0400111222");
  expect(
    screen.getByRole("link", { name: "sam@example.test" }).getAttribute("href"),
  ).toBe("mailto:sam@example.test");
  fireEvent.click(screen.getByRole("button", { name: "Open worker details" }));
  expect(await screen.findByText("Worker record: Sam Taylor")).toBeTruthy();
  expect(window.location.href).toBe(originalUrl);
  expect(openShift).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to roster" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Current calendar week")).toBeTruthy();
});

it("shows participant contact details and keeps URL synchronisation off in the full panel", async () => {
  view(<PersonPreview id="p1" name="Ava Participant" kind="participant" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Quick details for Ava Participant" }),
  );
  expect(
    await screen.findByRole("link", { name: "ava@example.test" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Open participant details" }),
  );
  expect(
    await screen.findByText("Participant record: p1, URL sync false"),
  ).toBeTruthy();
});

it("offers the compact preview on keyboard focus and dismisses it", async () => {
  view(<PersonPreview id="w1" name="Sam Taylor" kind="worker" />);
  fireEvent.focus(
    screen.getByRole("button", { name: "Quick details for Sam Taylor" }),
  );
  expect(
    await screen.findByRole("button", { name: "Open worker details" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Open worker details" }),
    ).toBeNull(),
  );
});

it("keeps unassigned entries as plain text", () => {
  view(
    <PersonPreview
      id="00000000-0000-0000-0000-000000000000"
      name="Unassigned"
      kind="worker"
    />,
  );
  expect(screen.getByText("Unassigned")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("opens a mouse-hover preview without a click", async () => {
  view(<PersonPreview id="w1" name="Sam Taylor" kind="worker" />);
  const event = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(
    screen.getByRole("button", { name: "Quick details for Sam Taylor" }),
    event,
  );
  expect(
    await screen.findByRole("link", { name: "sam@example.test" }),
  ).toBeTruthy();
});
