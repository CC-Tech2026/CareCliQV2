import { useEffect, useRef, useState } from "react";
import { usePersonContact, usePersonDetails } from "./PersonDetails";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { WorkerStats } from "@/services/coordinatorService";

type Props = {
  id?: string | null;
  name: string;
  kind: "worker" | "participant";
  worker?: WorkerStats;
  scheduledHours?: number;
  maxHours?: number | null;
  className?: string;
};

/** Contact data loads on demand; full profiles stay in the roster drawer. */
export function PersonPreview({
  id,
  name,
  kind,
  worker,
  scheduledHours,
  maxHours,
  className,
}: Props) {
  const showDetails = usePersonDetails();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const openingDetails = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoringFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => () => clear(), []);
  const show = () => {
    clear();
    setOpen(true);
  };
  const leave = () => {
    clear();
    if (!pinned.current) timer.current = setTimeout(() => setOpen(false), 250);
  };
  const person = { id: id || "", name, kind, worker };
  const data = usePersonContact(
    person,
    open && Boolean(id) && id !== "00000000-0000-0000-0000-000000000000",
  );
  if (!id || id === "00000000-0000-0000-0000-000000000000")
    return <span className={className}>{name}</span>;
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        clear();
        pinned.current = value;
        setOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={
            "max-w-full rounded-sm text-left underline decoration-current/30 underline-offset-4 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cc-plum " +
            (className || "")
          }
          aria-label={"Quick details for " + name}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              clear();
              timer.current = setTimeout(show, 250);
            }
          }}
          onPointerLeave={leave}
          onFocus={() => {
            if (!restoringFocus.current) show();
          }}
          onBlur={leave}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ")
              event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            clear();
            pinned.current = true;
            setOpen(true);
          }}
        >
          {name}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-60 max-w-[calc(100vw-2rem)] rounded-lg p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (openingDetails.current) {
            openingDetails.current = false;
            return;
          }
          restoringFocus.current = true;
          triggerRef.current?.focus();
          restoringFocus.current = false;
        }}
        onPointerEnter={clear}
        onPointerLeave={leave}
        onFocusCapture={clear}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            leave();
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h3 className="break-words text-sm font-semibold text-cc-text">
          {name}
        </h3>
        <p className="mt-0.5 text-[11px] text-cc-muted">
          {kind === "worker" ? "Worker" : "Participant"}
          {worker?.is_active != null
            ? worker.is_active
              ? " / Active"
              : " / Inactive"
            : ""}
        </p>
        {scheduledHours != null || worker?.avg_compliance != null ? (
          <dl className="mt-2 space-y-1.5 text-xs">
            {scheduledHours != null ? (
              <div>
                <dt className="text-[10px] text-cc-muted">
                  Scheduled this week
                </dt>
                <dd>
                  {scheduledHours.toFixed(1)} hours
                  {maxHours != null ? " / " + maxHours + " hour limit" : ""}
                </dd>
              </div>
            ) : null}
            {worker?.avg_compliance != null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-cc-muted">Documentation</dt>
                <dd>{Math.round(worker.avg_compliance)}%</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div className="mt-2 space-y-1 text-xs">
          {data.contact?.phone ? (
            <a
              className="block text-cc-plum underline"
              href={"tel:" + data.contact.phone.replace(/[^+0-9]/g, "")}
            >
              {data.contact.phone}
            </a>
          ) : null}
          {data.contact?.email ? (
            <a
              className="block break-all text-cc-plum underline"
              href={"mailto:" + data.contact.email}
            >
              {data.contact.email}
            </a>
          ) : null}
          {data.loading && !data.contact ? (
            <p role="status" className="text-cc-muted">
              Loading contact details...
            </p>
          ) : data.error ? (
            <button
              className="text-cc-plum underline"
              onClick={() => void data.retry()}
            >
              Retry contact details
            </button>
          ) : !data.contact?.phone && !data.contact?.email ? (
            <p className="text-cc-muted">No contact details recorded</p>
          ) : null}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-cc-border pt-1.5">
          <button
            type="button"
            className="inline-flex min-h-8 items-center text-xs font-semibold text-cc-plum underline underline-offset-4"
            disabled={!showDetails}
            onClick={() => {
              clear();
              openingDetails.current = true;
              pinned.current = false;
              setOpen(false);
              showDetails?.(person);
            }}
          >
            Open {kind === "worker" ? "worker" : "participant"} details
          </button>
          <button
            type="button"
            className="min-h-8 px-1 text-xs text-cc-muted hover:text-cc-text"
            onClick={() => {
              pinned.current = false;
              setOpen(false);
            }}
          >
            Close
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
