import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: null as unknown, fetch: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: mocks.data, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/services/http", () => ({ jsonFetch: mocks.fetch }));
vi.mock("@/lib/datetime", () => ({ formatAppDate: () => "21 Nov 2026" }));

import { VoiceTranscriptionCard } from "./VoiceTranscriptionCard";

const OFF = {
  enabled: false, chosen: false, forced: null, demo: false, agreed_by_name: null, agreed_at: null,
  terms: "Recordings are sent to OpenAI in the United States to be turned into text.",
  terms_version: "2026-11-21", agreed_terms_version: null, can_change: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("lets the director switch voice on only after agreeing to where the audio goes", async () => {
  mocks.data = OFF;
  mocks.fetch.mockResolvedValue({ ...OFF, enabled: true, chosen: true });
  render(<VoiceTranscriptionCard />);
  expect(screen.getByText(/^Off\./)).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Voice recording and transcription" }));
  expect(screen.getByText(/sent to OpenAI in the United States/)).toBeTruthy();
  const switchOn = screen.getByRole("button", { name: /Switch voice recording on/ }) as HTMLButtonElement;
  expect(switchOn.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "I agree" }));
  fireEvent.click(switchOn);
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledWith("/api/organization/voice-transcription", {
      method: "PUT", body: JSON.stringify({ enabled: true, agreed: true }),
    }),
  );
});

it("shows who switched it on, and switches it off without asking again", async () => {
  mocks.data = { ...OFF, enabled: true, chosen: true, agreed_by_name: "Bonny Director", agreed_at: "2026-11-21T01:00:00Z" };
  mocks.fetch.mockResolvedValue(OFF);
  render(<VoiceTranscriptionCard />);
  expect(screen.getByText("On, switched on by Bonny Director on 21 Nov 2026.")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Voice recording and transcription" }));
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledWith("/api/organization/voice-transcription", {
      method: "PUT", body: JSON.stringify({ enabled: false, agreed: false }),
    }),
  );
});

it("coordinators see where it stands but can't change it", () => {
  mocks.data = { ...OFF, can_change: false };
  render(<VoiceTranscriptionCard />);
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByText("Your managing director can switch it on here.")).toBeTruthy();
});
