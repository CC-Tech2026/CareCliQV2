import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { AlertTriangle, Loader2, PackagePlus, RotateCcw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  assignToolkitItem,
  createToolkitItem,
  getMyToolkit,
  getTeamToolkit,
  listRestockRequests,
  requestRestock,
  updateRestockRequest,
  useToolkitItem,
  type RestockRequest,
  type ToolkitItem,
  type ToolkitMovement,
} from "@/services/toolkitService";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function isLow(item: ToolkitItem) {
  return Number(item.quantity || 0) <= Number(item.minimum_quantity || 0);
}

function ItemRow({
  item,
  coordinator,
  onUse,
  onRestock,
  onAssign,
}: {
  item: ToolkitItem;
  coordinator: boolean;
  onUse: (item: ToolkitItem) => void;
  onRestock: (item: ToolkitItem) => void;
  onAssign: (item: ToolkitItem) => void;
}) {
  const low = isLow(item);
  return (
    <div className="grid gap-3 border-b border-[#EEEAFB] py-4 last:border-0 lg:grid-cols-[1fr_auto] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-black text-[#111827]">{item.name}</p>
          {low && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black uppercase text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              Low stock
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-[#6B7280]">
          {item.category || "General"} • {item.quantity} {item.unit || "units"} available
          {item.minimum_quantity ? ` • minimum ${item.minimum_quantity}` : ""}
          {item.expiry_date ? ` • expires ${item.expiry_date}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!coordinator && (
          <>
            <Button variant="outline" size="sm" onClick={() => onUse(item)} className="rounded-xl">Use item</Button>
            <Button variant="ghost" size="sm" onClick={() => onRestock(item)} className="rounded-xl text-[#3730A3]">Request restock</Button>
          </>
        )}
        {coordinator && (
          <Button variant="outline" size="sm" onClick={() => onAssign(item)} className="rounded-xl">Assign / adjust</Button>
        )}
      </div>
    </div>
  );
}

export default function Toolkit() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isCoordinator = user?.role === "support_coordinator";
  const orgId = user?.organizationId ?? "__no_org__";
  const baseKey = isCoordinator ? ["toolkit", "team"] : ["toolkit", "me"];
  const { data, isLoading, error } = useOrgQuery(baseKey, {
    queryFn: isCoordinator ? getTeamToolkit : getMyToolkit,
  });
  const { data: restockRequests = [] } = useOrgQuery(["toolkit", "restock-requests"], {
    queryFn: listRestockRequests,
    enabled: isCoordinator,
  });
  const items = data?.items || [];
  const movements = (data?.movements || []) as ToolkitMovement[];
  const [newItem, setNewItem] = useState({
    name: "",
    category: "Clinical supplies",
    quantity: "1",
    unit: "unit",
    minimum_quantity: "1",
  });

  const summary = useMemo(() => ({
    total: items.length,
    low: items.filter(isLow).length,
    assigned: items.filter((item) => !!item.assigned_user_id).length,
  }), [items]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [orgId, ...baseKey] });
    queryClient.invalidateQueries({ queryKey: [orgId, "toolkit", "restock-requests"] });
  };

  const createMutation = useMutation({
    mutationFn: createToolkitItem,
    onSuccess: () => {
      setNewItem({ name: "", category: "Clinical supplies", quantity: "1", unit: "unit", minimum_quantity: "1" });
      invalidate();
      toast({ title: "Toolkit item saved" });
    },
    onError: (err) => toast({ title: "Could not save item", description: (err as Error).message, variant: "destructive" }),
  });

  const useMutationItem = useMutation({
    mutationFn: (item: ToolkitItem) => useToolkitItem({ item_id: item.id, quantity: 1, notes: "Used from worker toolkit" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Item usage logged" });
    },
    onError: (err) => toast({ title: "Could not use item", description: (err as Error).message, variant: "destructive" }),
  });

  const restockMutation = useMutation({
    mutationFn: (item: ToolkitItem) => requestRestock({ item_id: item.id, quantity_requested: Math.max(1, item.minimum_quantity || 1), notes: "Worker requested restock" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Restock request sent" });
    },
    onError: (err) => toast({ title: "Could not request restock", description: (err as Error).message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: (item: ToolkitItem) => assignToolkitItem(item.id, { assigned_user_id: item.assigned_user_id || user?.id || null, quantity: item.quantity }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Toolkit assignment saved" });
    },
    onError: (err) => toast({ title: "Could not assign item", description: (err as Error).message, variant: "destructive" }),
  });

  const restockReviewMutation = useMutation({
    mutationFn: ({ request, status }: { request: RestockRequest; status: RestockRequest["status"] }) => updateRestockRequest(request.id, { status }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Restock request updated" });
    },
    onError: (err) => toast({ title: "Could not update request", description: (err as Error).message, variant: "destructive" }),
  });

  function addItem(event: React.FormEvent) {
    event.preventDefault();
    if (!newItem.name.trim()) {
      toast({ title: "Item name required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      name: newItem.name,
      category: newItem.category,
      quantity: Number(newItem.quantity || 0),
      unit: newItem.unit || "unit",
      minimum_quantity: Number(newItem.minimum_quantity || 0),
      status: "active",
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <p className="hidden" style={{ color: CORAL }}>
          {isCoordinator ? "Organisation" : user?.role === "allied_health" ? "Clinical" : "Support Worker"}
        </p>
        <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>
          {isCoordinator ? "Team Toolkit" : "My Toolkit"}
        </h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Items", summary.total],
          ["Low stock", summary.low],
          ["Assigned", summary.assigned],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
            <p className="text-xs font-bold uppercase text-[#6B7280]">{label}</p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{value}</p>
          </div>
        ))}
      </div>

      {isCoordinator && (
        <form onSubmit={addItem} className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-[#3730A3]" />
            <h2 className="font-black text-[#111827]">Add stock item</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-5">
            <div className="md:col-span-2">
              <Label>Name</Label>
              <Input value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Category</Label>
              <Input value={newItem.category} onChange={(event) => setNewItem({ ...newItem, category: event.target.value })} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={newItem.quantity} onChange={(event) => setNewItem({ ...newItem, quantity: event.target.value })} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Minimum</Label>
              <Input type="number" value={newItem.minimum_quantity} onChange={(event) => setNewItem({ ...newItem, minimum_quantity: event.target.value })} className="mt-1 rounded-xl" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button disabled={createMutation.isPending} className="gap-2 rounded-xl" style={{ background: PLUM }}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
              Save item
            </Button>
          </div>
        </form>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-[#3730A3]" />
          <h2 className="font-black" style={{ color: TEXT }}>{isCoordinator ? "Organisation stock" : "Assigned kit"}</h2>
        </div>
        {isLoading && <p className="mt-4 text-sm font-bold" style={{ color: MUTED }}>Loading toolkit...</p>}
        {error && <p className="mt-4 text-sm font-bold text-red-600">{(error as Error).message}</p>}
        {!isLoading && items.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[#F8F8FE] p-4 text-sm font-medium" style={{ color: MUTED }}>
            No toolkit items are currently assigned.
          </p>
        )}
        <div className="mt-3">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              coordinator={isCoordinator}
              onUse={(selected) => useMutationItem.mutate(selected)}
              onRestock={(selected) => restockMutation.mutate(selected)}
              onAssign={(selected) => assignMutation.mutate(selected)}
            />
          ))}
        </div>
      </section>

      {isCoordinator && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-[#3730A3]" />
            <h2 className="font-black" style={{ color: TEXT }}>Restock requests</h2>
          </div>
          {restockRequests.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-[#F8F8FE] p-4 text-sm font-medium" style={{ color: MUTED }}>No pending restock requests.</p>
          ) : (
            <div className="mt-3 divide-y divide-[#EEEAFB]">
              {restockRequests.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex-1">
                    <p className="font-bold text-[#111827]">{request.item?.name || request.item_id}</p>
                    <p className="text-xs text-[#6B7280]">{request.quantity_requested} requested • {request.status}</p>
                  </div>
                  {request.status === "pending" && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => restockReviewMutation.mutate({ request, status: "approved" })}>Approve</Button>
                      <Button variant="ghost" size="sm" className="text-[#BE185D]" onClick={() => restockReviewMutation.mutate({ request, status: "rejected" })}>Reject</Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-[#3730A3]" />
          <h2 className="font-black" style={{ color: TEXT }}>Movement history</h2>
        </div>
        {movements.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-[#F8F8FE] p-4 text-sm font-medium" style={{ color: MUTED }}>
            No toolkit movements have been recorded yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[#EEEAFB]">
            {movements.slice(0, 8).map((movement) => (
              <div key={movement.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="rounded-full bg-[#F8F8FE] px-3 py-1 text-xs font-black uppercase text-[#3730A3]">
                  {movement.movement_type}
                </span>
                <span className="font-bold text-[#111827]">{movement.quantity}</span>
                <span className="text-[#6B7280]">{movement.notes || movement.item_id}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
