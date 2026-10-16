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
});
