import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuillAssistant } from "./QuillAssistant";
import { groupThreads } from "./useQuillChat";
import * as chatbox from "@/services/chatboxService";

let role = "managing_director";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-1", role, full_name: "Morgan Hayes" } }),
}));
vi.mock("@/services/chatboxService", () => ({
  sendChatMessage: vi.fn(),
  listChatThreads: vi.fn(() => Promise.resolve([])),
  getChatThreadMessages: vi.fn(),
  deleteChatThread: vi.fn(() => Promise.resolve()),
  clearChatHistory: vi.fn(() => Promise.resolve()),
}));
// Charts need a real layout engine; the chart itself isn't under test here.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const send = vi.mocked(chatbox.sendChatMessage);
const listThreads = vi.mocked(chatbox.listChatThreads);
const getMessages = vi.mocked(chatbox.getChatThreadMessages);

function openQuill() {
  const launcher = screen.getByRole("button", { name: "Open AI assistant" });
  fireEvent.pointerDown(launcher, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(launcher, { pointerId: 1, clientX: 0, clientY: 0 });
}

function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Message Quill"), { target: { value: text } });
  fireEvent.keyDown(screen.getByLabelText("Message Quill"), { key: "Enter" });
}

describe("Quill", () => {
  afterEach(cleanup);

  beforeEach(() => {
    role = "managing_director";
    vi.clearAllMocks();
    listThreads.mockResolvedValue([]);
    window.localStorage.clear();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  it("shows one launcher even when two page shells both mount it", () => {
    render(
      <>
        <QuillAssistant />
        <QuillAssistant />
      </>,
    );
    expect(screen.getAllByRole("button", { name: "Open AI assistant" })).toHaveLength(1);
  });

  it("greets a director by name with questions about the whole organisation", () => {
    render(<QuillAssistant />);
    openQuill();
    expect(screen.getByText(/^Good (morning|afternoon|evening), Morgan$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "How are we tracking financially this month?" })).toBeTruthy();
    expect(screen.queryByText(/Demo/)).toBeNull();
  });

  it("doesn't offer a coordinator the director's finance question", () => {
    role = "support_coordinator";
    render(<QuillAssistant />);
    openQuill();
    expect(screen.getByRole("button", { name: "Who's on shift right now?" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "How are we tracking financially this month?" })).toBeNull();
  });

  it("goes full screen, remembers it, and Esc steps back to the panel", () => {
    render(<QuillAssistant />);
    openQuill();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
    expect(window.localStorage.getItem("quill.full-screen")).toBe("1");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBeNull();
    expect(window.localStorage.getItem("quill.full-screen")).toBe("0");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the answer with its figures as one strip, its table and follow-ups", async () => {
    send.mockResolvedValue({
      reply: "Revenue is **$12,400** this month.",
      thread_id: "t-1",
      blocks: [
        { type: "stat", label: "Billed", value: "$12,400.00" },
        { type: "stat", label: "Collected", value: "$8,000.00" },
        { type: "table", title: "Credentials to renew", columns: ["Worker", "When"], rows: [["Tom Walsh", "34 days ago"]] },
      ],
      suggestions: ["How does this quarter look?"],
    });
    render(<QuillAssistant />);
    openQuill();
    ask("How are we going?");

    expect(await screen.findByText("$12,400")).toBeTruthy();
    expect(screen.getByText("$8,000.00")).toBeTruthy();
    expect(screen.getByText("Tom Walsh")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download as CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "How does this quarter look?" })).toBeTruthy();
    expect(send).toHaveBeenCalledWith("How are we going?", undefined, expect.any(AbortSignal), "brief");
  });

  it("can stop an answer and ask it again", async () => {
    send.mockImplementationOnce(
      (_m, _t, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    render(<QuillAssistant />);
    openQuill();
    ask("Who's on shift?");
    fireEvent.click(await screen.findByRole("button", { name: "Stop answering" }));
    expect(await screen.findByText("You stopped this answer.")).toBeTruthy();

    send.mockResolvedValueOnce({ reply: "Three workers are on shift.", thread_id: "t-2", blocks: [] });
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Three workers are on shift.")).toBeTruthy();
    expect(screen.queryByText("You stopped this answer.")).toBeNull();
    expect(send).toHaveBeenLastCalledWith("Who's on shift?", undefined, expect.any(AbortSignal), "brief");
  });

  it("reopens a past conversation with its tables", async () => {
    listThreads.mockResolvedValue([
      { thread_id: "old-1", title: "Which credentials expire?", updated_at: new Date().toISOString(), message_count: 2 },
    ]);
    getMessages.mockResolvedValue([
      { role: "user", content: "Which credentials expire?", created_at: "" },
      {
        role: "assistant",
        content: "One credential has expired.",
        created_at: "",
        blocks: [{ type: "table", title: "Credentials to renew", columns: ["Worker"], rows: [["Tom Walsh"]] }],
      },
    ]);
    render(<QuillAssistant />);
    openQuill();
    fireEvent.click(screen.getByRole("button", { name: "Past conversations" }));
    expect(await screen.findByText("Today")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Which credentials expire?" }));
    });
    await waitFor(() => expect(screen.getByText("One credential has expired.")).toBeTruthy());
    expect(screen.getByText("Tom Walsh")).toBeTruthy();
  });
});

describe("Quill settings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    role = "managing_director";
    vi.clearAllMocks();
    listThreads.mockResolvedValue([]);
    window.localStorage.clear();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  function openSettings() {
    openQuill();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  }

  it("asks for detailed answers once that's chosen, and remembers it", async () => {
    send.mockResolvedValue({ reply: "Done.", thread_id: "t-1", blocks: [] });
    render(<QuillAssistant />);
    openSettings();
    fireEvent.click(screen.getByRole("radio", { name: "Detailed" }));
    expect(JSON.parse(window.localStorage.getItem("quill.settings") || "{}").answerLength).toBe("detailed");

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    ask("How are we going?");
    await screen.findByText("Done.");
    expect(send).toHaveBeenCalledWith("How are we going?", undefined, expect.any(AbortSignal), "detailed");
  });

  it("can hide follow-up questions", async () => {
    window.localStorage.setItem("quill.settings", JSON.stringify({ followUps: false }));
    send.mockResolvedValue({ reply: "Done.", thread_id: "t-1", blocks: [], suggestions: ["How does this quarter look?"] });
    render(<QuillAssistant />);
    openQuill();
    ask("How are we going?");
    await screen.findByText("Done.");
    expect(screen.queryByRole("button", { name: "How does this quarter look?" })).toBeNull();
  });

  it("with Enter sends off, Enter makes a new line and Ctrl + Enter sends", async () => {
    window.localStorage.setItem("quill.settings", JSON.stringify({ enterSends: false }));
    send.mockResolvedValue({ reply: "Done.", thread_id: "t-1", blocks: [] });
    render(<QuillAssistant />);
    openQuill();
    const box = screen.getByLabelText("Message Quill");
    fireEvent.change(box, { target: { value: "Who's on shift?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await screen.findByText("Done.");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("opens straight into full screen when that's the setting", () => {
    window.localStorage.setItem("quill.settings", JSON.stringify({ openIn: "full" }));
    render(<QuillAssistant />);
    openQuill();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  });

  it("deletes every conversation from settings, after confirming", async () => {
    listThreads.mockResolvedValue([
      { thread_id: "old-1", title: "Old chat", updated_at: new Date().toISOString(), message_count: 2 },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QuillAssistant />);
    openSettings();
    const deleteAll = await screen.findByRole("button", { name: /Delete all/ });
    await waitFor(() => expect((deleteAll as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(deleteAll);
    expect(confirm).toHaveBeenCalled();
    expect(chatbox.clearChatHistory).toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("groupThreads", () => {
  it("files conversations under Today, Yesterday and older headings", () => {
    const now = new Date(2026, 10, 23, 15, 0);
    const at = (d: number, h = 10) => new Date(2026, 10, d, h).toISOString();
    const groups = groupThreads(
      [
        { thread_id: "a", title: "a", updated_at: at(23), message_count: 2 },
        { thread_id: "b", title: "b", updated_at: at(22), message_count: 2 },
        { thread_id: "c", title: "c", updated_at: at(18), message_count: 2 },
        { thread_id: "d", title: "d", updated_at: at(1), message_count: 2 },
        { thread_id: "e", title: "e", updated_at: new Date(2026, 5, 1).toISOString(), message_count: 2 },
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.threads.map((t) => t.thread_id)])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      ["Previous 7 days", ["c"]],
      ["Previous 30 days", ["d"]],
      ["Older", ["e"]],
    ]);
  });
});
