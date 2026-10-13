import { expect, it } from "vitest";
import { formatBytes, sizeLabel } from "./useVaultSizes";

it("formats sizes the way a file manager does", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(856 * 1024)).toBe("856 KB");
  expect(formatBytes(24.3 * 1024 * 1024)).toBe("24.3 MB");
  expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
  expect(formatBytes(1.12 * 1024 ** 3)).toBe("1.12 GB");
});

it("says Measuring until every document in the folder is measured", () => {
  expect(sizeLabel({ bytes: 4096, pending: 2, files: 5, unavailable: 0 }, true)).toBe("Measuring…");
  expect(sizeLabel({ bytes: 3 * 1024 * 1024, pending: 0, files: 5, unavailable: 0 }, true)).toBe("3 MB");
  expect(sizeLabel({ bytes: 0, pending: 0, files: 0, unavailable: 0 }, true)).toBeUndefined();
  // Every file's stored copy is missing: no size rather than a misleading "0 B".
  expect(sizeLabel({ bytes: 0, pending: 0, files: 4, unavailable: 4 }, true)).toBeUndefined();
  expect(sizeLabel(undefined, false)).toBeUndefined();
});
