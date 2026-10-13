import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FolderCard } from "./FileManager";

afterEach(cleanup);

it("opens the folder, lists what's inside, and counts what isn't shown", () => {
  const open = vi.fn();
  render(
    <FolderCard
      title="Participant Folder"
      meta={["119 files", "9 folders"]}
      status={{ label: "16 gaps across 7 participants", tone: "danger" }}
      onOpen={open}
      menu={[{ label: "Open", onSelect: open }]}
      preview={{
        nodes: [
          { kind: "folder", label: "Clinical Docs", meta: "48", href: "/md/vault/tree/participant/clinical_docs" },
          { kind: "folder", label: "Intake Docs", meta: "6 missing", tone: "danger" },
        ],
        more: 7,
        moreNoun: "folders",
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Open Participant Folder" }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByText("16 gaps across 7 participants")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Clinical Docs/ }).getAttribute("href")).toBe("/md/vault/tree/participant/clinical_docs");
  expect(screen.getByText("6 missing")).toBeTruthy();
  expect(screen.getByText("…and 7 more folders")).toBeTruthy();
  expect(screen.getByRole("button", { name: "More actions for Participant Folder" })).toBeTruthy();
});
