import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Neutral grey: a loading shape, not a brand-coloured wash that reads as a warning.
      className={cn("animate-pulse rounded-md bg-cc-soft", className)}
      {...props}
    />
  )
}

export { Skeleton }
