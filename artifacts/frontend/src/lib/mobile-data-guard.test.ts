import { describe, expect, it } from "vitest";
import { formatBytes } from "@/lib/format-bytes";
import { getMobileUploadConsent, setMobileUploadConsent } from "@/lib/mobile-data-guard";

describe("formatBytes", () => {
  it("formats megabytes", () => {
    expect(formatBytes(2.4 * 1024 * 1024)).toContain("MB");
  });
});

describe("mobile-data-guard", () => {
  it("stores session consent", () => {
    setMobileUploadConsent("allow");
    expect(getMobileUploadConsent()).toBe("allow");
  });
});
