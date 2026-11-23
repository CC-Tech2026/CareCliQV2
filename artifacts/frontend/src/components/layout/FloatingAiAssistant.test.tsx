import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingAiAssistant } from "./FloatingAiAssistant";

let role = "managing_director";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-1", role } }),
}));
vi.mock("@/services/chatboxService", () => ({
  sendChatMessage: vi.fn(),
  listChatThreads: vi.fn(() => Promise.resolve([])),
  getChatThreadMessages: vi.fn(),
  deleteChatThread: vi.fn(),
  clearChatHistory: vi.fn(),
}));

function openQuill() {
  const launcher = screen.getByRole("button", { name: "Open AI assistant" });
  fireEvent.pointerDown(launcher, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(launcher, { pointerId: 1, clientX: 0, clientY: 0 });
}

describe("Quill", () => {
  afterEach(cleanup);

  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  it("shows one launcher even when two page shells both mount it", () => {
    render(
      <>
        <FloatingAiAssistant />
        <FloatingAiAssistant />
      </>,
    );
    expect(screen.getAllByRole("button", { name: "Open AI assistant" })).toHaveLength(1);
  });

  it("offers a managing director questions about the whole organisation", () => {
    role = "managing_director";
    render(<FloatingAiAssistant />);
    openQuill();
    expect(screen.getByRole("button", { name: "How are we tracking financially this month?" })).toBeTruthy();
    expect(screen.getByText(/how the organisation is going/)).toBeTruthy();
    expect(screen.queryByText(/Demo/)).toBeNull();
  });

  it("doesn't offer a coordinator the director's finance question", () => {
    role = "support_coordinator";
    render(<FloatingAiAssistant />);
    openQuill();
    expect(screen.getByRole("button", { name: "Who's on shift right now?" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "How are we tracking financially this month?" })).toBeNull();
  });
});
