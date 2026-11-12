import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OpenShiftsPanel } from "./OpenShiftsPanel";
import type { CoordinatorShiftRecord } from "@/services/coordinatorService";

// 2 Oct 2026, 11:30 am in Adelaide (daylight saving, UTC+10:30).
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-02T01:00:00Z"));

afterEach(() => cleanup());

const shift = (over: Partial<CoordinatorShiftRecord>) =>
  ({
    id: "s",
    worker_id: "00000000-0000-0000-0000-000000000000",
    participant_name: "Priya Singh",
    status: "unassigned",
    timezone: "Australia/Adelaide",
    shift_type: "standard_support",
    ...over,
  }) as CoordinatorShiftRecord;

const shifts = [
  shift({ id: "late", participant_name: "Liam Carter", scheduled_start: "2026-10-01T22:30:00Z", scheduled_end: "2026-10-02T00:30:00Z" }),
  shift({ id: "mon-1", scheduled_start: "2026-10-04T23:30:00Z", scheduled_end: "2026-10-05T02:30:00Z" }),
  shift({ id: "mon-2", participant_name: "Zoe Mitchell", scheduled_start: "2026-10-05T04:30:00Z", scheduled_end: "2026-10-05T06:30:00Z" }),
];

it("lists open shifts by day, started ones first, with a way to fill each", () => {
  const onFindWorker = vi.fn();
  const onShowOnRoster = vi.fn();
  render(
    <OpenShiftsPanel
      open
      onOpenChange={() => {}}
      shifts={shifts}
      loading={false}
      onFindWorker={onFindWorker}
      onShowOnRoster={onShowOnRoster}
      onAddOpenShift={() => {}}
    />,
  );
  const started = screen.getByRole("region", { name: "Started without a worker" });
  expect(within(started).getByText("Liam Carter")).toBeTruthy();

  const monday = screen.getByRole("heading", { name: /Monday 5 October/ });
  expect(monday.textContent).toContain("2 open");
  const mondaySection = monday.closest("section") as HTMLElement;
  expect(within(mondaySection).getByText("Priya Singh")).toBeTruthy();
  expect(within(mondaySection).getByText(/10:00\s*am to 1:00\s*pm · 3h/i)).toBeTruthy();

  fireEvent.click(within(mondaySection).getAllByRole("button", { name: /Find a worker/ })[0]);
  expect(onFindWorker).toHaveBeenCalledWith(expect.objectContaining({ id: "mon-1" }));
  fireEvent.click(within(mondaySection).getAllByRole("button", { name: /Show on roster/ })[1]);
  expect(onShowOnRoster).toHaveBeenCalledWith(expect.objectContaining({ id: "mon-2" }));
});

it("says so when every shift has a worker", () => {
  render(
    <OpenShiftsPanel open onOpenChange={() => {}} shifts={[]} loading={false}
      onFindWorker={() => {}} onShowOnRoster={() => {}} onAddOpenShift={() => {}} />,
  );
  expect(screen.getByText("No open shifts. Every shift has a worker.")).toBeTruthy();
});
