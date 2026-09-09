import { describe, it, expect } from "vitest";
import { latestTrainingHistory, safeMaterialUrl } from "./training";

describe("training history", () => {
  it("keeps the latest attempt instead of an older rejection", () => {
    const history = latestTrainingHistory([
      { module_id: "a", status: "confirmed" },
      { module_id: "b", status: "awaiting_confirmation" },
      { module_id: "a", status: "rejected" },
    ]);
    expect(history.get("a")?.status).toBe("confirmed");
    expect(history.get("b")?.status).toBe("awaiting_confirmation");
  });
});

describe("material links", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "#",
    "/private/file.pdf",
    "",
    null,
  ])("does not render unsafe or unavailable link %s", (url) => {
    expect(safeMaterialUrl(url)).toBeNull();
  });
  it("supports full web resource URLs", () => {
    expect(safeMaterialUrl("https://example.org/guide.pdf")).toBe(
      "https://example.org/guide.pdf",
    );
  });
});
