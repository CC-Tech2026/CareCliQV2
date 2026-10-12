import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFolderActions, type FolderTarget } from "./useFolderActions";

const deleteCustomFolder = vi.fn(async (_folderId: string) => ({ removed_files: 2 }));
vi.mock("@/services/vaultService", () => ({
  deleteCustomFolder: (id: string) => deleteCustomFolder(id),
  renameCustomFolder: vi.fn(),
}));
vi.mock("./ShareAuditorDialog", () => ({ ShareAuditorDialog: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => ({ id: "t", update: vi.fn() }) }) }));

afterEach(() => {
  cleanup();
  deleteCustomFolder.mockClear();
});

function Harness({ target, onChanged }: { target: FolderTarget; onChanged?: () => void }) {
  const { menuFor, dialogs } = useFolderActions({ onChanged });
  return (
    <>
      <ul>
        {menuFor(target).map((item) => (
          <li key={item.label}>
            <button type="button" onClick={item.onSelect} disabled={item.disabled}>{item.label}</button>
          </li>
        ))}
      </ul>
      {dialogs}
    </>
  );
}

const builtIn: FolderTarget = {
  title: "Session & Progress Notes",
  href: "/md/vault/session_notes",
  path: "Vault › Session & Progress Notes",
  files: 48,
  loadDocuments: async () => [],
};

it("offers sharing and download on built-in folders, with delete shown but locked", () => {
  render(<Harness target={builtIn} />);
  for (const label of ["Open", "Open in new tab", "Share with auditor", "Download as ZIP", "Copy link", "Copy folder path", "Details"]) {
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  }
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  expect((screen.getByRole("button", { name: "Delete folder" }) as HTMLButtonElement).disabled).toBe(true);
});

it("only deletes a folder you created once its name is typed to confirm", async () => {
  const changed = vi.fn();
  render(<Harness target={{ ...builtIn, title: "Board minutes", files: 2, customFolderId: "f1" }} onChanged={changed} />);

  fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
  expect(screen.getByText("Delete this folder?")).toBeTruthy();
  const confirm = () => screen.getAllByRole("button", { name: /Delete folder/ }).at(-1) as HTMLButtonElement;
  expect(confirm().disabled).toBe(true);

  const input = screen.getByLabelText("Type the folder name to confirm");
  fireEvent.change(input, { target: { value: "board" } });
  expect(confirm().disabled).toBe(true);
  fireEvent.change(input, { target: { value: "  board   MINUTES " } });
  expect(confirm().disabled).toBe(false);
  expect(deleteCustomFolder).not.toHaveBeenCalled();

  fireEvent.click(confirm());
  await waitFor(() => expect(deleteCustomFolder).toHaveBeenCalledWith("f1"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
});
