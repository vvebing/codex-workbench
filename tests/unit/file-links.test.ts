import { describe, expect, it } from "vitest";
import {
  fileLinkUrlTransform,
  parseFileLink,
  parseImageFileLink,
} from "../../src/features/files/file-links";

const origin = { cwd: "/projects/original", threadId: "original-thread" };

describe("conversation file destinations", () => {
  it("resolves image links through their original workspace and limits accidental HTTP paths", () => {
    const browser = "http://127.0.0.1:5180";
    expect(
      parseImageFileLink(
        `${browser}/projects/original/a%20b.png`,
        origin,
        browser,
      ),
    ).toEqual({ ...origin, path: "/projects/original/a b.png" });
    expect(parseImageFileLink("./capture.webp", origin, browser)).toEqual({
      ...origin,
      path: "./capture.webp",
    });
    expect(
      parseImageFileLink(
        "file:///projects/original/capture.jpg",
        origin,
        browser,
      ),
    ).toEqual({ ...origin, path: "/projects/original/capture.jpg" });
    for (const href of [
      `${browser}/etc/private.png`,
      `${browser}/projects/original-other/capture.png`,
      `${browser}/projects/original/%2e%2e/private.png`,
      `${browser}/projects/original/folder%2f..%2f..%2fprivate.png`,
      `${browser}/projects/original/capture.png?download=1`,
      "https://example.com/projects/original/capture.png",
      `${browser}/projects/original/code.ts`,
    ])
      expect(parseImageFileLink(href, origin, browser), href).toBeNull();
  });
  it("retains originating thread and cwd without consulting selection", () => {
    expect(parseFileLink("README.md:12:2", origin)).toEqual({
      ...origin,
      path: "README.md",
      line: 12,
      column: 2,
    });
    expect(parseFileLink("src/main.ts:42:7", origin)).toEqual({
      ...origin,
      path: "src/main.ts",
      line: 42,
      column: 7,
    });
    expect(parseFileLink("../shared/main.ts#L42-L48", origin)).toEqual({
      ...origin,
      path: "../shared/main.ts",
      line: 42,
      endLine: 48,
    });
    expect(parseFileLink("/other/project/main.ts", origin)).toEqual({
      ...origin,
      path: "/other/project/main.ts",
    });
    expect(
      parseFileLink("./README", { cwd: "/agent/project", threadId: "child" }),
    ).toEqual({ cwd: "/agent/project", threadId: "child", path: "./README" });
    expect(origin).toEqual({
      cwd: "/projects/original",
      threadId: "original-thread",
    });
  });

  it("supports Windows paths, local file URIs, and percent-encoded names", () => {
    expect(parseFileLink("C:\\work\\app.ts:12:3")).toEqual({
      path: "C:\\work\\app.ts",
      line: 12,
      column: 3,
    });
    expect(parseFileLink("C:/work/app.ts#L12")).toEqual({
      path: "C:/work/app.ts",
      line: 12,
    });
    expect(parseFileLink("file:///C:/work/app.ts#L12-L15")).toEqual({
      path: "C:/work/app.ts",
      line: 12,
      endLine: 15,
    });
    expect(parseFileLink("file://localhost/work/a%20b.ts:8")).toEqual({
      path: "/work/a b.ts",
      line: 8,
    });
    expect(parseFileLink("/work/100%25%23L42%3A7.ts")).toEqual({
      path: "/work/100%#L42:7.ts",
    });
    expect(parseFileLink("src/%2E%2E/shared.ts", origin)).toEqual({
      ...origin,
      path: "src/../shared.ts",
    });
  });

  it("rejects invalid locations, unsafe schemes and ambiguous destinations", () => {
    for (const href of [
      "javascript:alert(1)",
      "javascript:123",
      "http:123",
      "data:text/html,hello",
      "vbscript:run",
      "app://tool",
      "javascript%3Aalert(1)",
      "file://remote/etc/passwd",
      "file:///etc/passwd?query",
      "file:///a%00b",
      "/a%0Ab",
      "/bad%name",
      "/a.ts:0",
      "/a.ts:1:0",
      "/a.ts#L5-L2",
      "/a.ts:9007199254740992",
      "#heading",
      "?query",
      "//example.com/file.ts",
      "https://example.com/file.ts:12",
      "mailto:me@example.com",
      "",
    ]) {
      expect(parseFileLink(href), href).toBeNull();
    }
  });

  it("preserves default external URL sanitization and extends only anchors", () => {
    expect(fileLinkUrlTransform("https://example.com/a?b=1", "href")).toBe(
      "https://example.com/a?b=1",
    );
    expect(fileLinkUrlTransform("mailto:me@example.com", "href")).toBe(
      "mailto:me@example.com",
    );
    expect(fileLinkUrlTransform("javascript:alert(1)", "href")).toBe("");
    expect(fileLinkUrlTransform("data:text/html,hello", "href")).toBe("");
    expect(fileLinkUrlTransform("C:/work/app.ts:5", "href")).toBe(
      "C:/work/app.ts:5",
    );
    expect(fileLinkUrlTransform("file:///work/app.ts", "href")).toBe(
      "file:///work/app.ts",
    );
    expect(fileLinkUrlTransform("file:///work/app.png", "src")).toBe("");
    expect(fileLinkUrlTransform("C:/work/app.png", "src")).toBe("");
  });
});
