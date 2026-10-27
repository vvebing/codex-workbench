import { describe, expect, it } from "vitest";
import { imageDataUrl } from "../../src/features/conversation/image-source";

describe("saved conversation image sources", () => {
  it("identifies images from their bytes rather than trusting a filename", () => {
    for (const [bytes, mime] of [
      ["\x89PNG\r\n\x1a\nrest", "png"],
      ["\xff\xd8\xffrest", "jpeg"],
      ["GIF89arest", "gif"],
      ["RIFF1234WEBPrest", "webp"],
    ]) {
      expect(imageDataUrl(btoa(bytes))).toBe(
        `data:image/${mime};base64,${btoa(bytes)}`,
      );
    }
  });
  it("rejects non-image data and oversized attachments", () => {
    expect(() => imageDataUrl(btoa("<html>not an image</html>"))).toThrow(
      "格式",
    );
    expect(() => imageDataUrl("x".repeat(10 * 1024 * 1024 + 1))).toThrow(
      "10 MB",
    );
    expect(() => imageDataUrl("%%%notbase64")).toThrow();
  });
  it("supports raw-byte workspace limits independently of conversation encoding limits", () => {
    const limit = 8 * 1024 * 1024;
    const data = btoa("\x89PNG\r\n\x1a\n" + "x".repeat(limit - 8));
    expect(imageDataUrl(data, limit).startsWith("data:image/png;base64,")).toBe(
      true,
    );
    expect(() => imageDataUrl(data)).toThrow("10 MB");
    expect(() => imageDataUrl(data, limit - 1)).toThrow("查看上限");
    // Equal encoded lengths may still contain different decoded byte counts.
    const padded = btoa("\x89PNG\r\n\x1a\nabc");
    expect(() => imageDataUrl(padded, 11)).not.toThrow();
    expect(() => imageDataUrl(padded, 10)).toThrow("查看上限");
  });
});
