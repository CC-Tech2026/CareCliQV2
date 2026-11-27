import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { QueryClientContext } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        // The main action: Charcoal Navy (a lighter navy in dark mode), the same
        // colour as PageKit's ctaClass and the navy variant.
        default:
           "bg-[var(--cc-cta)] text-white border border-[var(--cc-cta)] hover:opacity-90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
        // Same as default; kept so existing variant="navy" buttons keep working.
        navy:
  "border-none text-white bg-[var(--cc-cta)] hover:opacity-90 active:opacity-80",
      },
      size: {
        // WCAG 2.1 AA — 44px minimum touch targets
        default: "min-h-11 md:min-h-9 px-4 py-2",
        sm: "min-h-10 rounded-md px-3 text-xs",
        lg: "min-h-12 rounded-md px-8",
        icon: "touch-target h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner and blocks clicks, e.g. `loading={save.isPending}`. */
  loading?: boolean
  /**
   * On by default: while something this click started is still working, the
   * button shows a spinner and ignores more clicks, so nothing is sent twice.
   * "Something" is a promise returned by onClick, or a React Query mutation
   * started by the click (directly, through a handler, or by the form it
   * submits). Turn off for buttons that should stay clickable meanwhile.
   */
  busyOnClick?: boolean
}

// Long enough for a slow upload; a stuck request never locks a button for good.
const BUSY_LIMIT_MS = 60_000

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  )
}

/** Busy from a click until the work it started has finished. */
function useClickBusy() {
  const client = React.useContext(QueryClientContext)
  const [busy, setBusy] = React.useState(false)
  const busyRef = React.useRef(false)
  const stopWatching = React.useRef<(() => void) | null>(null)

  const finish = React.useCallback(() => {
    stopWatching.current?.()
    stopWatching.current = null
    busyRef.current = false
    setBusy(false)
  }, [])

  React.useEffect(() => () => stopWatching.current?.(), [])

  const begin = React.useCallback(() => {
    busyRef.current = true
    setBusy(true)
  }, [])

  const run = React.useCallback(
    (click: () => unknown) => {
      const cache = client?.getMutationCache()
      const before = cache ? new Set(cache.getAll()) : null
      const result = click()

      if (isThenable(result)) {
        begin()
        const limit = window.setTimeout(finish, BUSY_LIMIT_MS)
        stopWatching.current = () => window.clearTimeout(limit)
        Promise.resolve(result).then(finish, finish)
        return
      }
      if (!cache || !before) return

      // A form submits just after its button's click, so look for new saves
      // once the click has finished.
      window.setTimeout(() => {
        const started = cache.getAll().filter((m) => !before.has(m))
        if (!started.length) return
        const done = () =>
          started.every(
            (m) =>
              m.state.status === "success" ||
              m.state.status === "error" ||
              !cache.getAll().includes(m),
          )
        if (done()) return
        begin()
        const unsubscribe = cache.subscribe(() => {
          if (done()) finish()
        })
        const limit = window.setTimeout(finish, BUSY_LIMIT_MS)
        stopWatching.current = () => {
          unsubscribe()
          window.clearTimeout(limit)
        }
      }, 0)
    },
    [client, begin, finish],
  )

  return { busy, busyRef, run }
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      busyOnClick = true,
      disabled,
      onClick,
      children,
      ...props
    },
    ref,
  ) => {
    const { busy, busyRef, run } = useClickBusy()

    if (asChild) {
      // Links and other wrapped elements: no spinner (Slot takes one child).
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          onClick={onClick}
          {...props}
        >
          {children}
        </Slot>
      )
    }

    const isBusy = loading || busy
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (isBusy || busyRef.current) {
        event.preventDefault()
        return
      }
      if (!busyOnClick) {
        onClick?.(event)
        return
      }
      run(() => onClick?.(event))
    }

    return (
      <button
        className={cn(
          buttonVariants({ variant, size, className }),
          // Many buttons draw their own spinner while saving; show just one.
          isBusy &&
            "cursor-progress disabled:opacity-80 [&>.animate-spin:not([data-button-spinner])]:hidden",
        )}
        ref={ref}
        disabled={disabled || isBusy}
        aria-busy={isBusy || undefined}
        onClick={handleClick}
        {...props}
      >
        {isBusy ? (
          <Loader2
            aria-hidden="true"
            data-button-spinner=""
            className="animate-spin"
          />
        ) : null}
        {isBusy && size === "icon" ? (
          <span className="sr-only">Working</span>
        ) : (
          children
        )}
      </button>
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
