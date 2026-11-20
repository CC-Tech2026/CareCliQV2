import * as React from "react"
import { Loader2, MapPin } from "lucide-react"

import { Input } from "@/components/ui/input"
import { apiFetch } from "@/lib/api-fetch"
import { cn } from "@/lib/utils"

/** A picked address, split the way our forms store it. */
export type PickedAddress = {
  formatted: string
  street: string
  suburb: string
  state: string
  postcode: string
  country: string
  lat: number | null
  lng: number | null
}

type Suggestion = {
  id: string
  main: string
  secondary: string
  description: string
  address?: PickedAddress
}

export interface AddressAutocompleteProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value: string
  onChange: (value: string) => void
  /** Called with the full address when a suggestion is picked. */
  onPick?: (address: PickedAddress) => void
  /**
   * What the box holds after a pick: the whole one-line address ("full"), or
   * just the street when suburb, state and postcode have their own fields.
   */
  fill?: "full" | "street"
}

const DEBOUNCE_MS = 250
const MIN_CHARS = 3

function newSession() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * An address box that suggests real Australian addresses while you type,
 * and fills the rest of the address when you pick one. Typing your own
 * address still works: suggestions only help, they never block. If the
 * server can't search (no Maps key, signed out, offline) it's a plain box.
 */
export const AddressAutocomplete = React.forwardRef<HTMLInputElement, AddressAutocompleteProps>(
  ({ value, onChange, onPick, fill = "full", className, onKeyDown, onBlur, onFocus, id, ...props }, ref) => {
    const autoId = React.useId()
    const inputId = id ?? `address-${autoId}`
    const listId = `${inputId}-suggestions`
    const [open, setOpen] = React.useState(false)
    const [items, setItems] = React.useState<Suggestion[]>([])
    const [active, setActive] = React.useState(-1)
    const [searching, setSearching] = React.useState(false)
    const [picking, setPicking] = React.useState(false)
    const [available, setAvailable] = React.useState(true)
    const session = React.useRef(newSession())
    const lastQuery = React.useRef("")
    const typed = React.useRef(false)
    const request = React.useRef(0)

    // Look up suggestions shortly after typing stops.
    React.useEffect(() => {
      if (!typed.current || !available) return
      const q = value.trim()
      if (q.length < MIN_CHARS) {
        setItems([])
        setSearching(false)
        return
      }
      if (q === lastQuery.current) return
      const mine = ++request.current
      setSearching(true)
      const timer = window.setTimeout(async () => {
        try {
          const params = new URLSearchParams({ q, session: session.current })
          const res = await apiFetch(`/api/address/suggest?${params}`)
          if (mine !== request.current) return
          if (!res.ok) {
            // Signed out or not allowed: behave as a plain box from now on.
            if (res.status === 401 || res.status === 403) setAvailable(false)
            setItems([])
            return
          }
          const body = (await res.json()) as { available: boolean; suggestions: Suggestion[] }
          if (!body.available) {
            setAvailable(false)
            setItems([])
            return
          }
          lastQuery.current = q
          setItems(body.suggestions ?? [])
          setActive(-1)
          setOpen(true)
        } catch {
          if (mine === request.current) setItems([])
        } finally {
          if (mine === request.current) setSearching(false)
        }
      }, DEBOUNCE_MS)
      return () => window.clearTimeout(timer)
    }, [value, available])

    const pick = async (s: Suggestion) => {
      setOpen(false)
      setItems([])
      let address = s.address
      if (!address) {
        setPicking(true)
        try {
          const params = new URLSearchParams({ id: s.id, session: session.current })
          const res = await apiFetch(`/api/address/details?${params}`)
          if (res.ok) address = ((await res.json()) as { address: PickedAddress }).address
        } catch {
          // Fall through: keep what the suggestion said.
        } finally {
          setPicking(false)
        }
      }
      // A pick ends the paid-for search session; the next search starts anew.
      session.current = newSession()
      typed.current = false
      const text = address ? (fill === "street" ? address.street || address.formatted : address.formatted) : s.description
      lastQuery.current = text
      onChange(text)
      if (address) onPick?.(address)
    }

    const showList = open && available && (items.length > 0 || (!searching && value.trim().length >= MIN_CHARS && lastQuery.current === value.trim()))

    return (
      <div className="relative">
        <div className="relative">
          <Input
            ref={ref}
            id={inputId}
            value={value}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            className={cn("pr-9", className)}
            onChange={(e) => {
              typed.current = true
              setOpen(true)
              onChange(e.target.value)
            }}
            onFocus={(e) => {
              if (items.length) setOpen(true)
              onFocus?.(e)
            }}
            onBlur={(e) => {
              // Let a click on a suggestion land first.
              window.setTimeout(() => setOpen(false), 150)
              onBlur?.(e)
            }}
            onKeyDown={(e) => {
              if (showList && items.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setActive((i) => (i + 1) % items.length)
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setActive((i) => (i <= 0 ? items.length - 1 : i - 1))
                  return
                }
                if (e.key === "Enter" && active >= 0) {
                  e.preventDefault()
                  void pick(items[active])
                  return
                }
              }
              if (e.key === "Escape" && showList) {
                e.preventDefault()
                setOpen(false)
                return
              }
              onKeyDown?.(e)
            }}
            {...props}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-cc-muted" aria-hidden="true">
            {searching || picking ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          </span>
        </div>

        {showList ? (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-cc-border bg-cc-surface shadow-lg"
          >
            <ul id={listId} role="listbox" aria-label="Suggested addresses" className="max-h-72 overflow-y-auto py-1">
              {items.map((s, i) => (
                <li
                  key={s.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void pick(s)}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm",
                    i === active ? "bg-cc-soft" : "",
                  )}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cc-muted" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-cc-text">{s.main}</span>
                    {s.secondary ? <span className="block truncate text-xs text-cc-muted">{s.secondary}</span> : null}
                  </span>
                </li>
              ))}
              {!items.length ? (
                <li className="px-3 py-2.5 text-sm text-cc-muted" role="presentation">
                  No matching address. Keep typing, or enter it as written.
                </li>
              ) : null}
            </ul>
            <p className="border-t border-cc-border px-3 py-1.5 text-right text-[11px] text-cc-muted">Powered by Google</p>
          </div>
        ) : null}
      </div>
    )
  },
)
AddressAutocomplete.displayName = "AddressAutocomplete"
