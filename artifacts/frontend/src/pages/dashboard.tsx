import React, { useState } from "react";
import {
  Calendar,
  DollarSign,
  Search,
  Bell,
  Users,
  Settings,
  LogOut,
  LayoutGrid,
} from "lucide-react";

/* =========================
   TYPES
========================= */

type TabType = "dashboard" | "clients" | "schedule" | "billing" | "settings";

type Compliance = {
  notes: boolean;
  goals: boolean;
  claimReady: boolean;
};

type Session = {
  id: number;
  time: string;
  patient: string;
  type: string;
  room: string;
  status: "completed" | "next" | "pending";
  compliance: Compliance;
};

type Client = {
  id: number;
  name: string;
  dob: string;
  phone: string;
  status: string;
};

type NavBtnProps = {
  icon: React.ReactNode;
  label: string;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
};

/* =========================
   COMPONENT
========================= */

export default function PractitionerDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");

  /* =========================
     DATA
  ========================= */

  const todaysAppointments: Session[] = [
    {
      id: 1,
      time: "09:00 AM",
      patient: "Sarah Jenkins",
      type: "Initial Consultation",
      room: "Telehealth",
      status: "completed",
      compliance: { notes: true, goals: true, claimReady: true },
    },
    {
      id: 2,
      time: "11:00 AM",
      patient: "Mark Davis",
      type: "Follow-up / Therapy",
      room: "Clinic A",
      status: "next",
      compliance: { notes: false, goals: false, claimReady: false },
    },
    {
      id: 3,
      time: "01:30 PM",
      patient: "Emily Robinson",
      type: "Equipment Assessment",
      room: "Home Visit",
      status: "pending",
      compliance: { notes: false, goals: false, claimReady: false },
    },
  ];

  const allClients: Client[] = [
    {
      id: 1,
      name: "Sarah Jenkins",
      dob: "12/05/1982",
      phone: "0412 345 678",
      status: "Active",
    },
    {
      id: 2,
      name: "Mark Davis",
      dob: "22/09/1975",
      phone: "0423 456 789",
      status: "Active",
    },
    {
      id: 3,
      name: "Emily Robinson",
      dob: "14/02/1990",
      phone: "0434 567 890",
      status: "Active",
    },
  ];

  /* =========================
     LOGIC
  ========================= */

  const nextSession = todaysAppointments.find((s) => s.status === "next");

  const incompleteSessions = todaysAppointments.filter(
    (s) => !s.compliance.claimReady,
  );

  /* =========================
     UI
  ========================= */

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center space-x-3 mb-8">
            <div className="bg-indigo-600 text-white p-2 rounded-lg font-bold">
              PM
            </div>
            <span className="font-bold">PMS System</span>
          </div>

          <nav className="space-y-2">
            <NavBtn
              icon={<LayoutGrid />}
              label="dashboard"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavBtn
              icon={<Users />}
              label="clients"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavBtn
              icon={<Calendar />}
              label="schedule"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavBtn
              icon={<DollarSign />}
              label="billing"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavBtn
              icon={<Settings />}
              label="settings"
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          </nav>
        </div>

        <div className="border-t pt-4 flex justify-between items-center">
          <div>
            <p className="text-xs font-semibold">John Doe</p>
            <p className="text-[10px] text-slate-500">Occupational Therapist</p>
          </div>
          <LogOut className="w-4 h-4 text-slate-400" />
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b px-8 py-4 flex justify-between">
          <div className="relative">
            <Search className="absolute left-3 top-2 w-4 h-4 text-slate-400" />
            <input
              className="pl-9 pr-4 py-2 bg-slate-100 rounded-lg text-sm"
              placeholder="Search..."
            />
          </div>

          <div className="flex items-center space-x-4">
            <Bell className="w-5 h-5 text-slate-500" />
            <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm">
              + Add
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="p-8">
          {activeTab === "dashboard" && (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* ⚠ Incomplete */}
              {incompleteSessions.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-sm font-semibold text-amber-700">
                  ⚠ {incompleteSessions.length} sessions need completion before
                  claims
                </div>
              )}

              {/* 🔵 Next Session */}
              {nextSession && (
                <div className="bg-indigo-600 text-white p-6 rounded-xl flex justify-between items-center">
                  <div>
                    <p className="text-xs opacity-80">Next Session</p>
                    <h2 className="text-xl font-bold">{nextSession.patient}</h2>
                    <p className="text-sm opacity-80">
                      {nextSession.time} • {nextSession.type}
                    </p>
                  </div>

                  <button className="bg-white text-indigo-600 px-4 py-2 rounded-lg text-sm font-semibold">
                    Start Session
                  </button>
                </div>
              )}

              {/* 📅 Sessions */}
              <div className="bg-white p-6 rounded-xl border">
                <h2 className="font-bold mb-4">Today’s Sessions</h2>

                {todaysAppointments.map((s) => (
                  <div
                    key={s.id}
                    className="flex justify-between p-4 border rounded-xl mb-3 hover:bg-slate-50"
                  >
                    {/* Left */}
                    <div>
                      <p className="text-xs text-slate-500">{s.time}</p>
                      <p className="font-bold text-slate-800">{s.patient}</p>
                      <p className="text-xs text-slate-400">
                        {s.type} • {s.room}
                      </p>

                      <div className="flex space-x-2 text-[10px] mt-1">
                        <span
                          className={
                            s.compliance.notes
                              ? "text-green-600"
                              : "text-red-500"
                          }
                        >
                          Notes
                        </span>
                        <span
                          className={
                            s.compliance.goals
                              ? "text-green-600"
                              : "text-red-500"
                          }
                        >
                          Goals
                        </span>
                        <span
                          className={
                            s.compliance.claimReady
                              ? "text-green-600"
                              : "text-amber-500"
                          }
                        >
                          Claim
                        </span>
                      </div>
                    </div>

                    {/* Right */}
                    <div className="flex items-center space-x-2">
                      {s.status === "completed" && (
                        <span className="text-green-600 text-xs font-bold">
                          ✔ Done
                        </span>
                      )}

                      {s.status === "next" && (
                        <button className="bg-indigo-600 text-white px-3 py-1 text-xs rounded">
                          Start
                        </button>
                      )}

                      {!s.compliance.claimReady && (
                        <button className="bg-amber-100 text-amber-700 px-2 py-1 text-xs rounded font-semibold">
                          Fix
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "clients" && (
            <div className="bg-white p-6 rounded-xl border max-w-4xl mx-auto">
              <h2 className="font-bold mb-4">Clients</h2>

              {allClients.map((c) => (
                <div key={c.id} className="border-b py-3">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-slate-400">{c.phone}</p>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* =========================
   NAV BUTTON
========================= */

function NavBtn({ icon, label, activeTab, setActiveTab }: NavBtnProps) {
  const tab = label as TabType;

  return (
    <button
      onClick={() => setActiveTab(tab)}
      className={`flex items-center space-x-2 w-full px-3 py-2 rounded-lg capitalize ${
        activeTab === tab ? "bg-indigo-100 text-indigo-600" : "text-slate-600"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
