import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "./button"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe("Button busy while its click is working", () => {
  afterEach(cleanup)

  it("disables itself and shows a spinner until the click's promise settles", async () => {
    const work = deferred()
    const onClick = vi.fn(() => work.promise)
    render(<Button onClick={onClick}>Save</Button>)
    const button = screen.getByRole<HTMLButtonElement>("button", { name: /save/i })

    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    await act(async () => work.resolve())
    expect(button.disabled).toBe(false)
    expect(button.hasAttribute("aria-busy")).toBe(false)
  })

  it("stays busy while a mutation started by the click is running", async () => {
    const work = deferred()
    const send = vi.fn(() => work.promise)
    function Sender() {
      const m = useMutation({ mutationFn: send })
      return <Button onClick={() => m.mutate()}>Send</Button>
    }
    withClient(<Sender />)
    const button = screen.getByRole<HTMLButtonElement>("button", { name: /send/i })

    fireEvent.click(button)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(send).toHaveBeenCalledTimes(1)

    await act(async () => work.resolve())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(button.disabled).toBe(false)
  })

  it("covers a form submitted by the button", async () => {
    const work = deferred()
    function Form() {
      const m = useMutation({ mutationFn: () => work.promise })
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            m.mutate()
          }}
        >
          <Button type="submit">Create</Button>
        </form>
      )
    }
    withClient(<Form />)
    const button = screen.getByRole<HTMLButtonElement>("button", { name: /create/i })
    fireEvent.click(button)
    fireEvent.submit(button.closest("form")!)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(button.disabled).toBe(true)
    await act(async () => work.resolve())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(button.disabled).toBe(false)
  })

  it("leaves plain clicks alone", () => {
    const onClick = vi.fn()
    withClient(<Button onClick={onClick}>Open</Button>)
    const button = screen.getByRole<HTMLButtonElement>("button", { name: /open/i })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(button.disabled).toBe(false)
  })

  it("shows the loading state it is given", () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole<HTMLButtonElement>("button", { name: /save/i })
    expect(button.disabled).toBe(true)
    expect(button.querySelector("[data-button-spinner]")).not.toBeNull()
  })

  it("can opt out", () => {
    const work = deferred()
    const onClick = vi.fn(() => work.promise)
    render(
      <Button busyOnClick={false} onClick={onClick}>
        Next
      </Button>,
    )
    const button = screen.getByRole<HTMLButtonElement>("button", { name: /next/i })
    fireEvent.click(button)
    expect(button.disabled).toBe(false)
  })
})
