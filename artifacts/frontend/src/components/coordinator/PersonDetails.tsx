import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { jsonFetch } from "@/services/http";
import {
  getCoordinatorWorkerStats,
  type WorkerStats,
} from "@/services/coordinatorService";
import { WORKER_STATS_KEY } from "@/lib/query-keys";

const WorkerProfile = lazy(() =>
  import("@/components/team/WorkerDetail").then((m) => ({
    default: m.WorkerDetail,
  })),
);
const ParticipantProfile = lazy(() =>
  import("@/pages/patients").then((m) => ({ default: m.ParticipantDetail })),
);
export type PersonRef = {
  id: string;
  name: string;
  kind: "worker" | "participant";
  worker?: WorkerStats;
};
type Contact = {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
};
const DetailsContext = createContext<((person: PersonRef) => void) | null>(
  null,
);
export function usePersonDetails() {
  return useContext(DetailsContext);
}

/** Reuse authorised API/cache entries, fetching only when a preview is opened. */
export function usePersonContact(person: PersonRef, enabled: boolean) {
  const workerQuery = useOrgQuery(WORKER_STATS_KEY, {
    queryFn: getCoordinatorWorkerStats,
    enabled: enabled && person.kind === "worker" && !person.worker,
    staleTime: 60_000,
  });
  const participantQuery = useOrgQuery<Contact>(["participant", person.id], {
    queryFn: () =>
      jsonFetch<Contact>("/api/participants/" + encodeURIComponent(person.id)),
    enabled: enabled && person.kind === "participant",
    staleTime: 60_000,
  });
  const worker =
    person.worker ||
    (Array.isArray(workerQuery.data)
      ? workerQuery.data.find((w) => w.id === person.id)
      : undefined);
  return {
    contact: person.kind === "worker" ? worker : participantQuery.data,
    worker,
    loading:
      person.kind === "worker"
        ? !person.worker && workerQuery.isFetching
        : participantQuery.isFetching,
    error:
      person.kind === "worker"
        ? !person.worker && workerQuery.isError
        : participantQuery.isError,
    retry:
      person.kind === "worker" ? workerQuery.refetch : participantQuery.refetch,
  };
}

function PersonDetailsBody({
  person,
  onClose,
}: {
  person: PersonRef;
  onClose: () => void;
}) {
  const data = usePersonContact(person, true);
  if (person.kind === "participant")
    return (
      <Suspense fallback={<p role="status">Loading participant profile...</p>}>
        <ParticipantProfile
          id={person.id}
          onRefreshList={() => {}}
          syncUrl={false}
        />
      </Suspense>
    );
  if (data.error || (!data.loading && !data.worker))
    return (
      <div role="alert" className="space-y-3 py-4">
        <p>Worker details could not be loaded.</p>
        <button
          className="text-cc-plum underline"
          onClick={() => void data.retry()}
        >
          Try again
        </button>
      </div>
    );
  if (!data.worker)
    return (
      <p role="status" className="py-4">
        Loading worker profile...
      </p>
    );
  return (
    <Suspense fallback={<p role="status">Loading worker profile...</p>}>
      <WorkerProfile
        worker={data.worker}
        onBack={onClose}
        scrollContext="panel"
      />
    </Suspense>
  );
}

/** The drawer lives outside transient hover cards, so it survives their dismissal. */
export function PersonDetailsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [person, setPerson] = useState<PersonRef | null>(null);
  useEffect(() => {
    setPerson(null);
  }, [user?.id, user?.organizationId]);
  return (
    <DetailsContext.Provider value={setPerson}>
      {children}
      <Sheet
        open={!!person}
        onOpenChange={(open) => {
          if (!open) setPerson(null);
        }}
      >
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-3xl"
          onClick={(e) => e.stopPropagation()}
        >
          <SheetHeader className="mb-4 pr-6">
            <SheetTitle>{person?.name}</SheetTitle>
            <SheetDescription>
              Profile details. Close this panel to return to your unchanged
              roster.
            </SheetDescription>
          </SheetHeader>
          {person ? (
            <PersonDetailsBody
              key={person.kind + person.id}
              person={person}
              onClose={() => setPerson(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </DetailsContext.Provider>
  );
}

export function PersonDetailsButton({
  person,
  children,
}: {
  person: PersonRef;
  children: ReactNode;
}) {
  const showDetails = usePersonDetails();
  return (
    <button
      type="button"
      disabled={!showDetails}
      className="min-h-8 text-xs font-semibold text-cc-plum underline underline-offset-4 disabled:opacity-50"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        showDetails?.(person);
      }}
    >
      {children}
    </button>
  );
}
