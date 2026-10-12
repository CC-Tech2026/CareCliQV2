import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Users, FileText } from "lucide-react";
import { ManagementNavigationDrawer } from "./ManagementNavigationDrawer";
const groups = [{ label: "People", items: [{ href: "/staff", label: "Staff", icon: Users }, { href: "/reports", label: "Reports", icon: FileText }] }];
let resize: () => void;
let wide = false;
beforeEach(() => { wide = false; vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return wide; }, addEventListener: (_: string, fn: () => void) => { resize = fn; }, removeEventListener: vi.fn() }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show() { return render(<ManagementNavigationDrawer groups={groups} location="/staff" isActive={href => href === "/staff"} />); }
it("opens an accessible drawer, highlights the current page and filters navigation", () => {
 show(); fireEvent.click(screen.getByRole("button", { name: "Open management navigation" }));
 expect(screen.getByRole("dialog", { name: "Management navigation" })).toBeTruthy();
 expect(screen.getByRole("link", { name: "Staff" }).getAttribute("aria-current")).toBe("page");
 fireEvent.change(screen.getByRole("searchbox"), { target: { value: "reports" } });
 expect(screen.queryByRole("link", { name: "Staff" })).toBeNull();
 expect(screen.getByRole("link", { name: "Reports" })).toBeTruthy();
 fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
 expect(screen.getByRole("status").textContent).toContain("No pages found");
});
it("closes with Escape and returns focus to the trigger", async () => {
 show(); const trigger = screen.getByRole("button", { name: "Open management navigation" }); trigger.focus(); fireEvent.click(trigger);
 fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
 await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
 await waitFor(() => expect(document.activeElement).toBe(trigger));
});
it("closes when the viewport changes to desktop", async () => {
 show(); fireEvent.click(screen.getByRole("button", { name: "Open management navigation" })); wide = true; resize();
 await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
