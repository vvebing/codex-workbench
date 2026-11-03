import { describe, expect, it } from "vitest";
import type { ImageGenerationItem } from "../../src/generated/ImageGenerationItem";
import {
  generatedImageRecord,
  generatedImageSource,
} from "../../src/features/conversation/image-generation";
import { hasOperationContent } from "../../src/features/conversation/operation";

const item: ImageGenerationItem = {
  id: "image",
  status: "completed",
  revisedPrompt: null,
  failure: null,
  generationId: null,
  fileId: "file-generated-image",
};
const png = btoa("\x89PNG\r\n\x1a\n" + "image".repeat(16));

describe("generated image results", () => {
  it("keeps file IDs visible and never interprets them as local paths", () => {
    expect(generatedImageSource(item)).toEqual({ type: "unavailable" });
    expect(hasOperationContent({ type: "imageGeneration", ...item }, "")).toBe(
      true,
    );
    expect(generatedImageRecord(item)).toMatchObject({
      fileId: "file-generated-image",
      generationId: null,
    });
  });

  it("uses a saved local file before inline data or file IDs", () => {
    for (const result of [
      item,
      { ...item, result: `data:image/png;base64,${png}` },
    ])
      expect(
        generatedImageSource({ ...result, savedPath: "/repo/generated.png" }),
      ).toEqual({ type: "local", path: "/repo/generated.png" });
  });

  it("supports legacy result URLs, image bytes and filesystem paths", () => {
    for (const url of [
      "https://example.com/generated.png",
      "blob:https://example.com/image",
      `data:image/png;base64,${png}`,
    ])
      expect(generatedImageSource({ ...item, result: url })).toEqual({
        type: "url",
        url,
      });
    expect(generatedImageSource({ ...item, result: png })).toEqual({
      type: "url",
      url: `data:image/png;base64,${png}`,
    });
    for (const path of [
      "/repo/image.png",
      "C:\\repo\\image.png",
      "./image.png",
      "images/generated.png",
    ])
      expect(generatedImageSource({ ...item, result: path })).toEqual({
        type: "local",
        path,
      });
  });

  it("rejects unsupported schemes and invalid inline bytes without file reads", () => {
    for (const result of [
      "file-opaque-result",
      "javascript:alert(1)",
      "javascript:generated.png",
      "data:text/html,<h1>bad</h1>",
      btoa("not an image".repeat(20)),
    ])
      expect(generatedImageSource({ ...item, result })).toEqual({
        type: "unavailable",
      });
  });

  it("preserves generation provenance and tolerates old records without generation IDs", () => {
    const legacy = {
      id: "legacy",
      status: "completed",
      revisedPrompt: null,
      failure: null,
      result: "",
    } as ImageGenerationItem;
    expect(generatedImageSource(legacy)).toEqual({ type: "empty" });
    expect(generatedImageRecord(legacy).generationId).toBeNull();
    const inputImages = [
      { path: "/repo/reference.png", sha256: "a".repeat(64) },
    ];
    expect(
      generatedImageRecord({ ...item, generationId: "gen-1", inputImages }),
    ).toMatchObject({ generationId: "gen-1", inputImages });
  });
});
