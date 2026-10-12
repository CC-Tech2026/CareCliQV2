import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Page from "./tag-management";
import { createTag, setTagActive, createTagCategory, setTagCategoryMatchingRole } from "@/services/coordinatorService";
const state = vi.hoisted(() => ({ error: null as Error | null, refetch: vi.fn(), toast: vi.fn() }));
vi.mock("@/components/layout/HubLayout", () => ({ HubLayout: ({ children }: any) => children }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { organizationId: "org-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ error: state.error, refetch: state.refetch, data: [
 { id: "a", name: "Hobbies", is_active: true, matching_role: "interests", tags: [{ id: "t1", label: "Gardening", is_active: true }, { id: "t2", label: "Music", is_active: false }] },
 { id: "b", name: "Preferences", is_active: false, matching_role: null, tags: [] }
] }) }));
vi.mock("@/services/coordinatorService", () => ({ getTagCatalog: vi.fn(), createTag: vi.fn(), createTagCategory: vi.fn(), setTagActive: vi.fn(), setTagCategoryActive: vi.fn(), setTagCategoryMatchingRole: vi.fn() }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); state.error = null; });
function show() { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); const invalidate = vi.spyOn(client, "invalidateQueries"); render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); return invalidate; }
it("combines tag search with category status and clears filters", () => {
 show(); fireEvent.change(screen.getByLabelText("Find a category or tag"), { target: { value: "garden" } });
 expect(screen.getByText("Gardening")).toBeTruthy(); expect(screen.queryByText("Music")).toBeNull();
 fireEvent.change(screen.getByLabelText("Category status"), { target: { value: "inactive" } });
 expect(screen.getByText("No matching categories")).toBeTruthy(); fireEvent.click(screen.getByText("Clear filters"));
 fireEvent.click(screen.getByRole("button", { name: /Preferences/ }));
 expect(screen.getByRole("region", { name: "Preferences" })).toBeTruthy();
});
it("blocks duplicate tags and reactivates the existing inactive tag with organisation cache invalidation", async () => {
 const invalidate = show(); fireEvent.change(screen.getByLabelText("New tag in Hobbies"), { target: { value: " MUSIC " } });
 expect(screen.getByText(/This tag already exists/)).toBeTruthy();
 fireEvent.submit(screen.getByLabelText("New tag in Hobbies").closest("form")!); expect(createTag).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Reactivate Music" }));
 await waitFor(() => expect(setTagActive).toHaveBeenCalledWith("t2", true));
 await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["org-1", "coordinator-tags"] }));
});
it("retains category input when creation fails", async () => {
 vi.mocked(createTagCategory).mockRejectedValueOnce(new Error("Please try again")); show();
 fireEvent.click(screen.getByRole("button", { name: "Add category" }));
 fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Languages" } });
 fireEvent.click(screen.getByRole("button", { name: "Create category" }));
 await waitFor(() => expect(state.toast).toHaveBeenCalled());
 expect((screen.getByLabelText("Category name") as HTMLInputElement).value).toBe("Languages");
});
it("offers retry when the catalogue cannot load", () => {
 state.error = new Error("Unavailable"); show(); expect(screen.getByRole("alert")).toBeTruthy();
 fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(state.refetch).toHaveBeenCalledOnce();
});

it("keeps the tag draft when switching categories", () => {
 show(); fireEvent.change(screen.getByLabelText("New tag in Hobbies"), { target: { value: "Reading" } });
 fireEvent.change(screen.getByLabelText("Select a category"), { target: { value: "b" } });
 expect(screen.getByRole("region", { name: "Preferences" })).toBeTruthy();
 fireEvent.change(screen.getByLabelText("Select a category"), { target: { value: "a" } });
 expect((screen.getByLabelText("New tag in Hobbies") as HTMLInputElement).value).toBe("Reading");
});

it("applies a matching-purpose change only after saving", async () => {
 show(); fireEvent.change(screen.getAllByLabelText("Used in matching as")[0], { target: { value: "none" } });
 expect(setTagCategoryMatchingRole).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Save matching purpose" }));
 await waitFor(() => expect(setTagCategoryMatchingRole).toHaveBeenCalledWith("a", null));
});
it("finds inactive tags and reactivates a duplicate from the add form", async () => {
 show(); fireEvent.change(screen.getByLabelText("Tag status in Hobbies"), { target: { value: "inactive" } });
 expect(screen.queryByText("Gardening")).toBeNull();
 fireEvent.change(screen.getByLabelText("New tag in Hobbies"), { target: { value: "music" } });
 fireEvent.click(screen.getByRole("button", { name: "Reactivate existing tag" }));
 await waitFor(() => expect(setTagActive).toHaveBeenCalledWith("t2", true));
 expect(createTag).not.toHaveBeenCalled();
});
