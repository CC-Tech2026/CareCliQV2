import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/** In-page training workspace: uses the app shell and normal document scrolling. */
export function TrainingWorkspace({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="w-full space-y-6 pb-8" aria-label={title}>
      <header className="space-y-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Back to modules
        </button>
        <div className="border-b pb-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--cc-plum)]">
            CareCliQ learning
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-foreground outline-none sm:text-3xl"
          >
            {title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </header>
      {children}
      {footer && (
        <footer className="sticky bottom-0 z-10 rounded-2xl border bg-card p-4 shadow-sm sm:px-5">
          {footer}
        </footer>
      )}
    </section>
  );
}
