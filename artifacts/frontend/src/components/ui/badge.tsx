import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate ",
  {
    variants: {
      variant: {
        default:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary:
          // @replit no hover because we use hover-elevate
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",
          // @replit shadow-xs" - use badge outline variable
        outline: "text-foreground border [border-color:var(--badge-outline)]",
        // ── Status chips — functional colours, not brand pink/purple. Pending founding-team
        // sign-off per DESIGN_BRIEF.md; use only for compliance/status semantics, never decoratively.
        success:
          "rounded-full border-transparent bg-[var(--cc-status-success-bg)] text-[var(--cc-status-success)]",
        warning:
          "rounded-full border-transparent bg-[var(--cc-status-warning-bg)] text-[var(--cc-status-warning)]",
        // Compliance/safety danger severity — real red, not brand pink/purple. Use this, not
        // `destructive` (brand action colour), for status semantics like "non-compliant"/"RP flag".
        danger:
          "rounded-full border-transparent bg-[var(--cc-status-danger-bg)] text-[var(--cc-status-danger)]",
        info:
          "rounded-full border-transparent bg-[var(--cc-status-info-bg)] text-[var(--cc-status-info)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
