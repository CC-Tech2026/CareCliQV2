import { useState, useMemo } from "react";
import { Search, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

export type ParticipantItem = {
  participant_id: string;
  participant_name: string;
  active_goals_count?: number;
  tasks_count?: number;
};

interface ParticipantAZFilterProps {
  participants: ParticipantItem[];
  selectedParticipantId?: string;
  onParticipantSelect: (participantId: string) => void;
  showActiveGoalsBadge?: boolean;
  isLoading?: boolean;
}

export function ParticipantAZFilter({
  participants,
  selectedParticipantId,
  onParticipantSelect,
  showActiveGoalsBadge = true,
  isLoading = false,
}: ParticipantAZFilterProps) {
  const [search, setSearch] = useState("");
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);

  // Filter participants by search and letter
  const filtered = useMemo(() => {
    let list = participants;
    
    // Filter by search
    if (search.trim()) {
      list = list.filter((p) =>
        p.participant_name.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    // Filter by letter
    if (selectedLetter) {
      list = list.filter((p) =>
        p.participant_name.toLowerCase().startsWith(selectedLetter.toLowerCase())
      );
    }
    
    return list.sort((a, b) => a.participant_name.localeCompare(b.participant_name));
  }, [participants, search, selectedLetter]);

  // Get available letters
  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    participants.forEach((p) => {
      const first = p.participant_name.charAt(0).toUpperCase();
      if (/[A-Z]/.test(first)) letters.add(first);
    });
    return Array.from(letters).sort();
  }, [participants]);

  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  return (
    <div className="space-y-4">
      {/* Search box */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: MUTED }} />
        <Input
          placeholder="Search participants…"
          className="rounded-xl pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedLetter(null);
          }}
        />
      </div>

      {/* A-Z alphabet strip */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => {
            setSelectedLetter(null);
            setSearch("");
          }}
          className="rounded-full px-2.5 py-1 text-xs font-bold transition-colors"
          style={{
            background: selectedLetter === null && !search ? PLUM : SOFT,
            color: selectedLetter === null && !search ? "#fff" : MUTED,
            border: `1px solid ${BORDER}`,
          }}
        >
          All
        </button>
        {allLetters.map((letter) => {
          const isAvailable = availableLetters.includes(letter);
          const isSelected = selectedLetter === letter;
          return (
            <button
              key={letter}
              onClick={() => {
                setSelectedLetter(isSelected ? null : letter);
                setSearch("");
              }}
              className="rounded-full px-2 py-1 text-xs font-bold transition-colors"
              style={{
                background: isSelected ? PLUM : isAvailable ? SOFT : "var(--cc-soft)",
                color: isSelected ? "#fff" : isAvailable ? TEXT : MUTED,
                border: `1px solid ${BORDER}`,
                opacity: isAvailable ? 1 : 0.5,
                cursor: isAvailable ? "pointer" : "not-allowed",
              }}
            >
              {letter}
            </button>
          );
        })}
      </div>

      {/* Participant list */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="text-sm text-center py-8" style={{ color: MUTED }}>
            Loading participants…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-center py-8" style={{ color: MUTED }}>
            {participants.length === 0 ? "No participants found" : "No matching participants"}
          </div>
        ) : (
          filtered.map((participant) => {
            const isSelected = selectedParticipantId === participant.participant_id;
            const activeGoals = participant.active_goals_count ?? 0;
            const tasksCount = participant.tasks_count ?? 0;
            
            return (
              <button
                key={participant.participant_id}
                onClick={() => onParticipantSelect(participant.participant_id)}
                className={cn(
                  "w-full flex items-center justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-cc-soft",
                  isSelected ? "bg-cc-active-bg" : "bg-cc-surface",
                )}
                style={{ borderColor: isSelected ? PLUM : BORDER }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-black shrink-0 text-white"
                    style={{ background: PLUM }}
                  >
                    {participant.participant_name[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="font-black text-[14px]" style={{ color: TEXT }}>
                      {participant.participant_name}
                    </p>
                    {showActiveGoalsBadge && (
                      <p className="text-[11px]" style={{ color: MUTED }}>
                        {activeGoals} active goal{activeGoals !== 1 ? "s" : ""}
                        {tasksCount > 0 ? ` · ${tasksCount} task${tasksCount !== 1 ? "s" : ""}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <ChevronDown size={16} className="shrink-0 ml-2" style={{ color: PLUM }} />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
