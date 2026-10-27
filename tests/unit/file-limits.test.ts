import { expect, it } from "vitest";
import {
  DEFAULT_FILE_LIMITS,
  normalizeFileLimits,
  formatFileSize,
  fileTextInfo,
} from "../../src/features/files/file-limits";
const MB = 1024 * 1024;
it("validates consistent file limits within the transport hard ceiling", () => {
  expect(normalizeFileLimits()).toEqual({
    normalBytes: MB,
    editableBytes: 5 * MB,
    viewBytes: 8 * MB,
    diffBytes: 8 * MB,
  });
  expect(
    normalizeFileLimits({
      normalBytes: MB / 4,
      editableBytes: MB,
      viewBytes: 2 * MB,
      diffBytes: 2 * MB,
    }).diffBytes,
  ).toBe(2 * MB);
  for (const value of [
    null,
    [],
    { ...DEFAULT_FILE_LIMITS, viewBytes: 9 * MB },
    { ...DEFAULT_FILE_LIMITS, diffBytes: 9 * MB },
    { ...DEFAULT_FILE_LIMITS, normalBytes: 6 * MB },
    { ...DEFAULT_FILE_LIMITS, editableBytes: 0 },
    { ...DEFAULT_FILE_LIMITS, diffBytes: NaN },
  ])
    expect(() => normalizeFileLimits(value)).toThrow();
});
it("uses configured normal thresholds and formats small limits precisely", () => {
  const text = ("x".repeat(127) + "\n").repeat(2500);
  expect(fileTextInfo(text).largeFile).toBe(false);
  expect(
    fileTextInfo(text, { ...DEFAULT_FILE_LIMITS, normalBytes: MB / 4 })
      .largeFile,
  ).toBe(true);
  expect(formatFileSize(MB / 4)).toBe("256 KB");
  expect(formatFileSize(MB * 1.5)).toBe("1.5 MB");
});
