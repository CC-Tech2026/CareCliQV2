import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { User, CreditCard } from "lucide-react";
import { SettingsNavigation } from "./SettingsNavigation";
const items = [
  { id: "account", label: "Account", icon: User },
  { id: "billing", label: "Billing & Subscription", icon: CreditCard },
];
afterEach(cleanup);
function Example() {
  const [active, setActive] = useState("account");
  return (
    <SettingsNavigation items={items} active={active} onChange={setActive} />
  );
}
it("changes sections through the phone and tablet picker", () => {
  render(<Example />);
  fireEvent.change(screen.getByRole("combobox", { name: "Settings section" }), {
    target: { value: "billing" },
  });
  expect(
    screen
      .getByRole("button", { name: "Billing & Subscription" })
      .getAttribute("aria-current"),
  ).toBe("page");
});
it("filters navigation without losing the selected section", () => {
  render(<Example />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a setting" }), {
    target: { value: "billing" },
  });
  expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a setting" }), {
    target: { value: "missing" },
  });
  expect(screen.getByRole("status").textContent).toContain(
    "No matching sections",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(
    screen
      .getByRole("button", { name: "Account" })
      .getAttribute("aria-current"),
  ).toBe("page");
});
