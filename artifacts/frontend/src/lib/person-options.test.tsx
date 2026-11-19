import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { participantOption, staffOption } from "./person-options";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = vi.fn();
afterEach(cleanup);

const liamA = {
  id: "p-1", full_name: "Liam Carter", ndis_number: "431990001", phone: "0400 100 201",
  date_of_birth: "1992-05-14", address: "12 Smith St, Glenelg, SA 5045", email: "liam@example.com",
};
const liamB = { id: "p-2", full_name: "Liam Carter", ndis_number: "431990777", address: "3 Hill Rd, Elizabeth, SA 5112" };
const zoe = { id: "p-3", full_name: "Zoe Mitchell", preferred_name: "Zo", ndis_number: "431990002" };

describe("participantOption", () => {
  it("tells same-named participants apart by NDIS number and suburb", () => {
    expect(participantOption(liamA).detail).toBe("NDIS 431990001 · Glenelg");
    expect(participantOption(liamB).detail).toBe("NDIS 431990777 · Elizabeth");
    expect(participantOption(zoe).detail).toBe("NDIS 431990002 · Prefers Zo");
  });
});

describe("staffOption", () => {
  it("shows the role and the staff ID and suburb", () => {
    const o = staffOption({ id: "w-1", full_name: "Aisha Rahman", employee_id: "1042", suburb: "Norwood", role: "support_worker" });
    expect(o.label).toBe("Aisha Rahman");
    expect(o.detail).toBe("Support worker · ID 1042 · Norwood");
  });
});

describe("a participant picker", () => {
  function open(onValueChange = vi.fn()) {
    render(
      <SearchableSelect
        value=""
        onValueChange={onValueChange}
        options={[liamA, liamB, zoe].map(participantOption)}
        placeholder="Choose a participant"
        searchPlaceholder="Search"
        emptyText="No participant matches"
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    return onValueChange;
  }
  const names = () => screen.getAllByRole("option").map((o) => o.textContent);

  it("finds a participant by NDIS number, with or without spaces", () => {
    const onValueChange = open();
    const search = screen.getByPlaceholderText("Search");
    fireEvent.change(search, { target: { value: "431 990 777" } });
    expect(names()).toEqual(["Liam CarterNDIS 431990777 · Elizabeth"]);
    fireEvent.click(screen.getByRole("option"));
    expect(onValueChange).toHaveBeenCalledWith("p-2");
  });

  it("finds a participant by phone, date of birth, suburb or preferred name", () => {
    open();
    const search = screen.getByPlaceholderText("Search");
    fireEvent.change(search, { target: { value: "0400100201" } });
    expect(names()).toHaveLength(1);
    fireEvent.change(search, { target: { value: "14/05/1992" } });
    expect(names()).toHaveLength(1);
    fireEvent.change(search, { target: { value: "liam elizabeth" } });
    expect(names()).toEqual(["Liam CarterNDIS 431990777 · Elizabeth"]);
    fireEvent.change(search, { target: { value: "zo" } });
    expect(names()).toHaveLength(1);
  });
});
