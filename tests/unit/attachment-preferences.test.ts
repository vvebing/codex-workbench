import { expect, it } from "vitest";
import {
  DEFAULT_ATTACHMENT_DIRECTORY,
  normalizeAttachmentDirectory,
} from "../../src/features/settings/attachment-preferences";

it("normalizes home and absolute directories without treating them as shell expressions", () => {
  expect(normalizeAttachmentDirectory("")).toBe(DEFAULT_ATTACHMENT_DIRECTORY);
  expect(normalizeAttachmentDirectory(" ~/my uploads/ ")).toBe("~/my uploads");
  expect(normalizeAttachmentDirectory("/var//attachments/")).toBe(
    "/var/attachments",
  );
  expect(
    normalizeAttachmentDirectory("C:\\Users\\Remote User\\uploads\\"),
  ).toBe("C:/Users/Remote User/uploads");
  expect(normalizeAttachmentDirectory("C:\\")).toBe("C:/");
  expect(normalizeAttachmentDirectory("\\\\server\\share\\uploads")).toBe(
    "//server/share/uploads",
  );
  expect(normalizeAttachmentDirectory("/")).toBe("/");
});
it("rejects ambiguous, traversing and invalid paths", () => {
  for (const path of [
    "uploads",
    "./uploads",
    "$HOME/uploads",
    "~other/uploads",
    "file:///tmp/uploads",
    "~/../uploads",
    "/tmp/./uploads",
    "C:\\..\\uploads",
    "/tmp/evil\npath",
    "a".repeat(4097),
  ])
    expect(() => normalizeAttachmentDirectory(path)).toThrow();
});
