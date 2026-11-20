import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const apiFetch = vi.fn()
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

import { AddressAutocomplete, type PickedAddress } from "./address-autocomplete"

const ADELAIDE: PickedAddress = {
  formatted: "24 King William St, Adelaide SA 5000",
  street: "24 King William Street",
  suburb: "Adelaide",
  state: "SA",
  postcode: "5000",
  country: "AU",
  lat: -34.92,
  lng: 138.6,
}

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body })
}

function Harness({ onPick, fill }: { onPick?: (a: PickedAddress) => void; fill?: "full" | "street" }) {
  const [value, setValue] = useState("")
  return <AddressAutocomplete aria-label="Address" value={value} onChange={setValue} onPick={onPick} fill={fill} />
}

async function typeAndWait(text: string) {
  const box = screen.getByRole<HTMLInputElement>("combobox", { name: "Address" })
  fireEvent.change(box, { target: { value: text } })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 320))
  })
  return box
}

describe("AddressAutocomplete", () => {
  afterEach(() => {
    cleanup()
    apiFetch.mockReset()
  })

  it("suggests addresses while typing and fills the rest on pick", async () => {
    apiFetch.mockImplementation((url: string) =>
      url.startsWith("/api/address/suggest")
        ? json({ available: true, suggestions: [{ id: "pn:1", main: "24 King William Street", secondary: "Adelaide SA", description: "24 King William Street, Adelaide SA" }] })
        : json({ address: ADELAIDE }),
    )
    const onPick = vi.fn()
    render(<Harness onPick={onPick} fill="street" />)
    const box = await typeAndWait("24 King Wil")

    const option = screen.getByRole("option", { name: /24 King William Street/ })
    await act(async () => {
      fireEvent.click(option)
    })
    expect(onPick).toHaveBeenCalledWith(ADELAIDE)
    expect(box.value).toBe("24 King William Street")
    expect(screen.queryByRole("option")).toBeNull()
  })

  it("picks with the keyboard", async () => {
    apiFetch.mockImplementation((url: string) =>
      url.startsWith("/api/address/suggest")
        ? json({ available: true, suggestions: [{ id: "gc:1", main: "24 King William St", secondary: "Adelaide SA 5000", description: ADELAIDE.formatted, address: ADELAIDE }] })
        : json({}, 500),
    )
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    const box = await typeAndWait("24 King")
    fireEvent.keyDown(box, { key: "ArrowDown" })
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" })
    })
    // Suggestions that come complete need no second lookup.
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(ADELAIDE)
    expect(box.value).toBe(ADELAIDE.formatted)
  })

  it("waits for three letters before searching", async () => {
    render(<Harness />)
    await typeAndWait("24")
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it("is a plain box when the server can't search", async () => {
    apiFetch.mockImplementation(() => json({ available: false, suggestions: [] }))
    render(<Harness />)
    const box = await typeAndWait("24 King")
    await typeAndWait("24 King William")
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(box.value).toBe("24 King William")
  })
})
