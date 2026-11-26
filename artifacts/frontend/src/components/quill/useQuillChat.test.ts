import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useQuillChat } from "./useQuillChat";
import { getChatThreadMessages, sendChatMessage, type ChatResponse } from "@/services/chatboxService";

vi.mock("@/services/chatboxService", () => ({
  sendChatMessage: vi.fn(),
  listChatThreads: vi.fn(async () => []),
  getChatThreadMessages: vi.fn(),
  deleteChatThread: vi.fn(),
  clearChatHistory: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it("keeps a new request pending when an aborted request completes late", async () => {
  const old = deferred<ChatResponse>();
  const current = deferred<ChatResponse>();
  vi.mocked(sendChatMessage).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const { result } = renderHook(() => useQuillChat());
  act(() => result.current.send("Old question"));
  act(() => result.current.newChat());
  act(() => result.current.send("Current question"));
  await act(async () => old.resolve({ thread_id: "old", reply: "Old answer", blocks: [] }));
  expect(result.current.pending).toBe(true);
  expect(result.current.messages.map((m) => m.text)).toEqual(["Current question"]);
  await act(async () => current.resolve({ thread_id: "current", reply: "Current answer", blocks: [] }));
  expect(result.current.pending).toBe(false);
  expect(result.current.threadId).toBe("current");
  expect(result.current.messages.at(-1)?.text).toBe("Current answer");
});

it("ignores history that arrives after starting a new conversation", async () => {
  const history = deferred<Awaited<ReturnType<typeof getChatThreadMessages>>>();
  vi.mocked(getChatThreadMessages).mockReturnValueOnce(history.promise);
  const { result } = renderHook(() => useQuillChat());
  act(() => { void result.current.openThread("old"); });
  expect(result.current.openingThread).toBe(true);
  act(() => result.current.newChat());
  await act(async () => history.resolve([{ role: "assistant", content: "Old answer", created_at: "" }]));
  expect(result.current.openingThread).toBe(false);
  expect(result.current.messages).toEqual([]);
  expect(result.current.threadId).toBeUndefined();
});

it("ignores a successful response received after the user stops answering", async () => {
  const request = deferred<ChatResponse>();
  vi.mocked(sendChatMessage).mockReturnValueOnce(request.promise);
  const { result } = renderHook(() => useQuillChat());
  act(() => result.current.send("Question"));
  act(() => result.current.stop());
  await act(async () => request.resolve({ thread_id: "late", reply: "Late answer", blocks: [] }));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.messages.at(-1)?.status).toBe("stopped");
  expect(result.current.messages.some((m) => m.text === "Late answer")).toBe(false);
});
