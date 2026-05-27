import { useQuery } from "@tanstack/react-query";
import { Mail, UserPlus, Users } from "lucide-react";
import { getCoordinatorTeam } from "@/services/coordinatorService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

export default function Team() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ["coordinator", "team"], queryFn: getCoordinatorTeam });

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Coordinator</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Team</h1>
        </div>
        <button className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white" style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}>
          <UserPlus size={16} />
          Invite Worker
        </button>
      </div>

      <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="mb-4 flex items-center gap-2">
          <Users size={18} style={{ color: PLUM }} />
          <h2 className="text-lg font-black" style={{ color: TEXT }}>Organisation Members</h2>
        </div>
        {isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading team...</p>}
        {error && <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>}
        <div className="grid gap-3">
          {data.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
              <div className="min-w-0">
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>{member.full_name}</p>
                <p className="inline-flex items-center gap-1 truncate text-xs font-medium" style={{ color: MUTED }}>
                  <Mail size={12} /> {member.email || "No email recorded"}
                </p>
              </div>
              <span className="rounded-full px-3 py-1 text-xs font-black capitalize" style={{ background: "#F5F3FC", color: PLUM }}>
                {(member.role || "member").replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
