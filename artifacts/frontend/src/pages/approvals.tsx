import { useState, useMemo } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { SectionInfo } from "@/components/ui/section-info";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "var(--cc-border)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

// Mock data for approvals
const MOCK_APPROVALS = [
  { id: 1, name: "Liam Tierney", time: "9:30am - 4:30pm", date: "21 24hr", status: "pending", approved: false },
  { id: 2, name: "Mick Salley", time: "7:30am - 4:00pm", date: "22 24hr", status: "pending", approved: false },
  { id: 3, name: "Ava Mitchell", time: "6:00am - 2:00pm", date: "23 24hr", status: "pending", approved: false },
  { id: 4, name: "Haya Collins", time: "7:30am - 4:00pm", date: "24 24hr", status: "pending", approved: false },
];

const DAY_KEYS = [
  "approvals.day.monday",
  "approvals.day.tuesday",
  "approvals.day.wednesday",
  "approvals.day.thursday",
  "approvals.day.friday",
] as const;

const TAB_KEYS = [
  { id: "favorites", key: "approvals.tab.favorites" },
  { id: "pending", key: "approvals.tab.pending" },
  { id: "recent", key: "approvals.tab.recent" },
  { id: "people", key: "approvals.tab.people" },
  { id: "timesheets", key: "approvals.tab.timesheets" },
  { id: "flexibility", key: "approvals.tab.flexibility" },
] as const;

const STAFF_SCHEDULE = [
  {
    name: "Emma Bangladeshs",
    initials: "EB",
    slots: [
      { time: "7:00 AM - 4:00 PM" },
      { time: "7:00 AM - 4:00 PM" },
      { time: "7:00 AM - 4:00 PM" },
      { time: "7:00 AM - 4:00 PM" },
      { time: "7:00 AM - 4:00 PM" },
    ],
  },
  {
    name: "James Chen",
    initials: "JC",
    slots: [
      { time: "7:00 AM - 4:00 PM" },
      { time: "3:30 AM - 4:00 PM" },
      { time: "3:30 AM - 4:00 PM" },
      { time: "7:00 AM - 4:00 PM" },
      { time: "3:30 AM - 4:00 PM" },
    ],
  },
  {
    name: "Isla",
    initials: "IL",
    slots: [
      { time: "3:00 AM - 3:00 AM" },
      { time: "9:30 AM - 12:00 PM" },
      { time: "9:30 AM - 12:00 PM" },
      { time: "3:00 AM - 3:00 AM" },
      { text: "off" },
    ],
  },
  {
    name: "Liam Chen",
    initials: "LC",
    slots: [
      { time: "9:00 AM - 5:00 PM" },
      { time: "9:00 AM - 5:00 PM" },
      { time: "9:00 AM - 5:00 PM" },
      { time: "9:00 AM - 5:00 PM" },
      { time: "9:00 AM - 5:00 PM" },
    ],
  },
  {
    name: "Sara Nguyen",
    initials: "SN",
    slots: [
      { time: "6:00 AM - 2:00 PM" },
      { text: "off" },
      { text: "off" },
      { time: "6:00 AM - 2:00 PM" },
      { time: "6:00 AM - 2:00 PM" },
    ],
  },
  {
    name: "Chris Sano",
    initials: "CS",
    slots: [
      { text: "off" },
      { time: "3:30 AM - 4:00 PM" },
      { time: "3:30 AM - 4:00 PM" },
      { text: "off" },
      { text: "off" },
    ],
  },
];

export default function Approvals() {
  const { translate, translateParams } = useAccessibility();
  const [activeTab, setActiveTab] = useState("pending");
  const [approvals, setApprovals] = useState(MOCK_APPROVALS);
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - today.getDay() + 1);

  const days = useMemo(
    () => DAY_KEYS.map((key) => translate(key)),
    [translate],
  );

  const tabs = useMemo(
    () => TAB_KEYS.map((tab) => ({ ...tab, label: translate(tab.key) })),
    [translate],
  );

  const toggleApproval = (id: number) => {
    setApprovals(approvals.map((a) =>
      a.id === id ? { ...a, approved: !a.approved, status: !a.approved ? "approved" : "pending" } : a
    ));
  };

  const getDayDate = (dayIndex: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + dayIndex);
    return d.getDate();
  };

  const isToday = (dayIndex: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + dayIndex);
    return d.toDateString() === today.toDateString();
  };

  const approvedCount = approvals.filter((a) => a.approved).length;
  const pendingCount = approvals.filter((a) => !a.approved).length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--cc-bg)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideIn { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        .approval-item { animation: slideIn 0.3s ease-out; }
        .tab-button { transition: all 0.3s ease; }
        .tab-button.active { border-bottom: 3px solid ${PLUM}; }
      ` }} />

      {/* Tab Navigation */}
      <div className="bg-white border-b" style={{ borderColor: BORDER }}>
        <div className="flex items-center overflow-x-auto px-6">
          {tabs.map((tab) => {
            const Icon = Clock3;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="tab-button flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors"
                style={{
                  color: activeTab === tab.id ? PLUM : MUTED,
                  borderBottom: activeTab === tab.id ? `3px solid ${PLUM}` : `2px solid transparent`,
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Left - Mobile/Approvals Panel */}
        <div className="w-full lg:w-[420px] lg:border-r" style={{ borderColor: BORDER, background: "var(--cc-bg)" }}>
          <div className="sticky top-0 z-10 border-b px-6 py-4" style={{ borderColor: BORDER }}>
            <h1 className="flex items-center gap-2 text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
              {translate("approvals.title")}
              <SectionInfo text="Shift and mobile-clock-in requests waiting on your sign-off." />
            </h1>
            <p className="mt-1 text-sm" style={{ color: MUTED }}>
              {translateParams("approvals.pendingShifts", { count: String(pendingCount) })}
            </p>
          </div>

          <div className="divide-y overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)", borderColor: BORDER }}>
            {approvals.map((approval, idx) => (
              <div
                key={approval.id}
                className="approval-item flex items-center gap-4 px-6 py-4 transition-colors hover:bg-gray-50"
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm" style={{ color: TEXT }}>
                    {approval.name}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                    {approval.time}
                  </p>
                  <p className="mt-0.5 text-xs font-medium" style={{ color: CORAL }}>
                    {approval.date}
                  </p>
                </div>

                <button
                  onClick={() => toggleApproval(approval.id)}
                  className="flex-shrink-0 relative w-12 h-6 rounded-full transition-all duration-300"
                  style={{
                    background: approval.approved ? "#22C55E" : BORDER,
                  }}
                >
                  <div
                    className="absolute top-0.5 w-5 h-5 rounded-full transition-transform duration-300 flex items-center justify-center"
                    style={{
                      left: approval.approved ? "calc(100% - 22px)" : "2px",
                      background: "var(--cc-bg)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                    }}
                  >
                    {approval.approved && <CheckCircle2 size={16} style={{ color: "#22C55E" }} strokeWidth={3} />}
                  </div>
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-3 border-t px-6 py-4" style={{ borderColor: BORDER }}>
            <button
              className="flex-1 h-11 rounded-lg font-bold text-sm transition-opacity hover:opacity-90"
              style={{
                background: "var(--cc-bg)",
                border: `2px solid ${BORDER}`,
                color: PLUM,
              }}
            >
              {translate("common.cancel")}
            </button>
            <button
              className="flex-1 h-11 rounded-lg font-bold text-sm text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--cc-cta)" }}
            >
              {translateParams("approvals.approve", { count: String(approvedCount) })}
            </button>
          </div>
        </div>

        {/* Right - Desktop Rostering Dashboard */}
        <div className="hidden lg:flex flex-1 flex-col overflow-hidden" style={{ background: "var(--cc-soft)" }}>
          {/* Summary Header */}
          <div className="border-b bg-white px-8 py-6" style={{ borderColor: BORDER }}>
            <div className="mb-4">
              <h2 className="text-lg font-bold" style={{ color: TEXT }}>
                {translate("approvals.roster")}
              </h2>
            </div>
            <div className="flex items-center gap-8 text-sm">
              <div>
                <p style={{ color: MUTED }} className="text-xs uppercase font-semibold">{translate("approvals.summary")}</p>
                <p className="mt-1 font-bold" style={{ color: TEXT }}>{translate("approvals.staffSeen")}</p>
              </div>
              <div>
                <p style={{ color: MUTED }} className="text-xs uppercase font-semibold">{translate("approvals.shiftsLabel")}</p>
                <p className="mt-1 font-bold" style={{ color: TEXT }}>{translate("approvals.shifts")}</p>
              </div>
              <div>
                <p style={{ color: MUTED }} className="text-xs uppercase font-semibold">{translate("approvals.waitingLabel")}</p>
                <p className="mt-1 font-bold" style={{ color: CORAL }}>{translate("approvals.waiting")}</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-auto">
            <div className="inline-block min-w-full">
              {/* Header with day names and dates */}
              <div className="sticky top-0 z-10 bg-white border-b" style={{ borderColor: BORDER }}>
                <div className="flex">
                  <div className="w-[220px] px-6 py-4"></div>
                  {days.map((day, idx) => (
                    <div
                      key={day}
                      className="w-[180px] px-4 py-4 text-center border-l"
                      style={{
                        borderColor: BORDER,
                        background: isToday(idx) ? "rgba(55, 48, 163, 0.08)" : "var(--cc-bg)",
                      }}
                    >
                      <p className="font-bold text-sm" style={{ color: isToday(idx) ? PLUM : TEXT }}>
                        {day.slice(0, 3)} {getDayDate(idx)}
                      </p>
                      {isToday(idx) && (
                        <p className="mt-1 text-xs font-semibold" style={{ color: PLUM }}>
                          {translate("approvals.today")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Staff rows */}
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {STAFF_SCHEDULE.map((staff) => (
                  <div key={staff.initials} className="flex hover:bg-gray-50 transition-colors">
                    {/* Staff name column */}
                    <div className="w-[220px] px-6 py-4 border-r flex items-center gap-3 bg-white" style={{ borderColor: BORDER }}>
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-full text-white text-xs font-bold shrink-0"
                        style={{ background: "var(--cc-text)" }}
                      >
                        {staff.initials}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: TEXT }}>
                          {staff.name}
                        </p>
                      </div>
                    </div>

                    {/* Schedule slots */}
                    {staff.slots.map((slot, dayIdx) => (
                      <div
                        key={`${staff.initials}-${dayIdx}`}
                        className="w-[180px] px-4 py-4 border-l flex items-center justify-center min-h-[68px] text-center transition-all hover:shadow-sm cursor-pointer"
                        style={{
                          borderColor: BORDER,
                          background: isToday(dayIdx) ? "rgba(55, 48, 163, 0.04)" : "var(--cc-bg)",
                        }}
                      >
                        <div>
                          {slot.text ? (
                            <p className="text-xs font-medium" style={{ color: MUTED }}>
                              {translate("approvals.off")}
                            </p>
                          ) : (
                            <>
                              <p className="text-xs font-bold" style={{ color: TEXT }}>
                                {slot.time}
                              </p>
                              <p className="mt-1 text-xs" style={{ color: MUTED }}>
                                {translate("approvals.confirmed")}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
