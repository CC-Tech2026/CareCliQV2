import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Package, AlertTriangle, CheckCircle2 } from "lucide-react";

const STORAGE_KEY = "coordinator-toolkit-items";

interface ToolkitItem {
  id: string;
  name: string;
  quantity: number;
  minQuantity: number;
}

const defaultItems: ToolkitItem[] = [
  { id: "1", name: "Mobility aids", quantity: 12, minQuantity: 3 },
  { id: "2", name: "Personal alarms", quantity: 8, minQuantity: 5 },
  { id: "3", name: "Medication packs", quantity: 24, minQuantity: 6 },
];

function getStoredItems(): ToolkitItem[] {
  if (typeof window === "undefined") return defaultItems;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : defaultItems;
  } catch {
    return defaultItems;
  }
}

export default function Toolkit() {
  const [items, setItems] = useState<ToolkitItem[]>(() => getStoredItems());
  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState(1);
  const [newMinQuantity, setNewMinQuantity] = useState(2);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore
    }
  }, [items]);

  const lowStockItems = useMemo(
    () => items.filter((item) => item.quantity <= item.minQuantity),
    [items],
  );

  const addItem = () => {
    if (!newName.trim()) return;
    setItems((current) => [
      ...current,
      {
        id: String(Date.now()),
        name: newName.trim(),
        quantity: newQuantity,
        minQuantity: newMinQuantity,
      },
    ]);
    setNewName("");
    setNewQuantity(1);
    setNewMinQuantity(2);
  };

  const updateQuantity = (id: string, value: number) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, quantity: value } : item));
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-[#5533CC] font-bold">Coordinator toolkit</p>
          <h1 className="mt-2 text-3xl font-black text-[#1E1640]">Supplies, equipment and inventory</h1>
          <p className="mt-2 text-sm text-[#5B4D73] max-w-2xl">
            Track essential toolkit inventory and keep low-stock alerts visible for your team.
          </p>
        </div>
        <Button variant="secondary">Sync inventory</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">Toolkit Items</p>
          <p className="text-3xl font-black text-[#1E1640]">{items.length}</p>
          <p className="mt-2 text-sm text-[#5B4D73]">Unique supplies tracked for your coordinator inventory.</p>
        </div>
        <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">Low stock alerts</p>
          <p className="text-3xl font-black text-[#1E1640]">{lowStockItems.length}</p>
          <p className="mt-2 text-sm text-[#5B4D73]">Supplies below your minimum thresholds.</p>
        </div>
        <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">Inventory status</p>
          <p className="text-3xl font-black text-[#1E1640]">{items.reduce((sum, item) => sum + item.quantity, 0)}</p>
          <p className="mt-2 text-sm text-[#5B4D73]">Total stock units available across toolkit items.</p>
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#E9E5F5] bg-white shadow-sm p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1E1640]">Low stock alerts</h2>
            <p className="text-sm text-[#7A6A9E]">These items need replenishment before the next round of support visits.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#FCE7F3] px-4 py-2 text-sm font-semibold text-[#C41144]">
            <AlertTriangle size={16} /> {lowStockItems.length} items low
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-3xl border border-[#EDE9F6] bg-[#FBFAFF] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-[#1E1640]">{item.name}</p>
                  <p className="text-xs uppercase tracking-[0.24em] text-[#7A6A9E]">Min {item.minQuantity} units</p>
                </div>
                <Package size={20} className="text-[#5533CC]" />
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-3xl font-black text-[#1E1640]">{item.quantity}</p>
                  <p className="text-sm text-[#5B4D73]">Current stock</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => updateQuantity(item.id, Math.max(item.quantity - 1, 0))}>-</Button>
                  <Button size="sm" variant="secondary" onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#E9E5F5] bg-white shadow-sm p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#1E1640]">Add toolkit item</h2>
            <p className="text-sm text-[#7A6A9E]">Keep your coordinator inventory up to date.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <div>
              <label className="text-[11px] uppercase tracking-[0.24em] text-[#7A6A9E] font-semibold">Item name</label>
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Transport kit" className="mt-2" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.24em] text-[#7A6A9E] font-semibold">Quantity</label>
              <Input type="number" value={newQuantity} onChange={(event) => setNewQuantity(Number(event.target.value))} min={0} className="mt-2" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.24em] text-[#7A6A9E] font-semibold">Min alert</label>
              <Input type="number" value={newMinQuantity} onChange={(event) => setNewMinQuantity(Number(event.target.value))} min={0} className="mt-2" />
            </div>
            <div className="sm:col-span-3">
              <Button onClick={addItem} className="mt-2 inline-flex items-center gap-2">
                <Plus size={16} /> Add item
              </Button>
            </div>
          </div>
        </div>

        {lowStockItems.length === 0 && (
          <div className="mt-6 rounded-3xl border border-[#D9F7E8] bg-[#EFFCF6] p-5 text-sm text-[#065F46] inline-flex items-center gap-2">
            <CheckCircle2 size={18} /> All stock levels are healthy.
          </div>
        )}
      </div>
    </div>
  );
}
