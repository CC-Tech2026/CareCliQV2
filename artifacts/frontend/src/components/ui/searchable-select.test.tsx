import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchableSelect } from "./searchable-select";

// jsdom has neither; cmdk and the popover use them.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

const options = [
  { value: "w-1", label: "Sam Nguyen", keywords: "Sam Nguyen 1042 Glenelg" },
  { value: "w-2", label: "Sam Nguyen", keywords: "Sam Nguyen 2210 Elizabeth" },
  { value: "w-3", label: "Aisha Rahman", keywords: "Aisha Rahman 3001 Norwood" },
];

function open(onValueChange = vi.fn()) {
  render(
    <SearchableSelect
      value=""
      onValueChange={onValueChange}
      options={options}
      placeholder="Choose a worker"
      searchPlaceholder="Search"
      emptyText="No results"
    />,
  );
  fireEvent.click(screen.getByRole("combobox"));
  return onValueChange;
}

it("lists two people with the same name separately and picks the right one", () => {
  const onValueChange = open();
  const sams = screen.getAllByRole("option", { name: /Sam Nguyen/ });
  expect(sams).toHaveLength(2);
  fireEvent.click(sams[1]);
  expect(onValueChange).toHaveBeenCalledWith("w-2");
});

it("finds someone by staff ID or suburb, word by word, not fuzzily", () => {
  open();
  const search = screen.getByPlaceholderText("Search");
  fireEvent.change(search, { target: { value: "2210" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.change(search, { target: { value: "sam glenelg" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  // "1042" mustn't match "Aisha Rahman 3001 Norwood" just by sharing digits.
  fireEvent.change(search, { target: { value: "1042" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Sam Nguyen"]);
  fireEvent.change(search, { target: { value: "nobody" } });
  expect(screen.getByText("No results")).toBeTruthy();
});
