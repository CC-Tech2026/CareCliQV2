import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&_h5]:text-[var(--cc-text)] [&_[data-slot=alert-description]]:text-[var(--cc-text)] [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
        // ── Low-intensity status banners: soft tint background + coloured left border + navy
        // text. Never a full saturated fill. Icon carries the colour; body copy stays navy so
        // status is never conveyed by colour alone.
        success:
          "border-l-4 bg-[var(--cc-status-success-bg)] border-y-transparent border-r-transparent border-l-[var(--cc-status-success)] [&>svg]:text-[var(--cc-status-success)]",
        warning:
          "border-l-4 bg-[var(--cc-status-warning-bg)] border-y-transparent border-r-transparent border-l-[var(--cc-status-warning)] [&>svg]:text-[var(--cc-status-warning)]",
        danger:
          "border-l-4 bg-[var(--cc-status-danger-bg)] border-y-transparent border-r-transparent border-l-[var(--cc-status-danger)] [&>svg]:text-[var(--cc-status-danger)]",
        info:
          "border-l-4 bg-[var(--cc-status-info-bg)] border-y-transparent border-r-transparent border-l-[var(--cc-status-info)] [&>svg]:text-[var(--cc-status-info)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="alert-description"
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
