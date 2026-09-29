import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { KpiCard, StatCard } from "./stat-card";

afterEach(cleanup);

it("a KpiCard with href is a link to the list behind the number", () => {
  const location = memoryLocation({ path: "/compliance", record: true });
  render(
    <Router hook={location.hook}>
      <KpiCard label="Open incidents" value={3} href="/incidents?tab=open" />
    </Router>,
  );
  const link = screen.getByRole("link", { name: "Open incidents: 3" });
  fireEvent.click(link);
  expect(location.history.at(-1)).toBe("/incidents?tab=open");
});

it("a KpiCard with onClick is a keyboard-reachable button", () => {
  const onClick = vi.fn();
  render(<KpiCard label="Overdue" value={2} onClick={onClick} />);
  fireEvent.click(screen.getByRole("button", { name: "Overdue: 2" }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("a StatCard with onClick is a button", () => {
  const onClick = vi.fn();
  render(<StatCard label="Active now" value={5} onClick={onClick} />);
  fireEvent.click(screen.getByRole("button", { name: "Active now: 5" }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("tiles without href or onClick stay plain", () => {
  render(<KpiCard label="Total" value={9} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("9")).toBeTruthy();
});
