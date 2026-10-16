import { expect, test } from "vitest";
import {
  absolutePath,
  completionDirectory,
  joinDirectory,
  parentDirectory,
} from "../../src/features/shell/workspace-path";
test("host paths support Unix, Windows drives and network shares", () => {
  for (const path of ["/", "/home/中文项目", "C:\\Users", "\\\\host\\share"])
    expect(absolutePath(path)).toBe(true);
  for (const path of ["src", "~/project", "C:project"])
    expect(absolutePath(path)).toBe(false);
  expect(joinDirectory("/", "demo")).toBe("/demo");
  expect(joinDirectory("C:\\", "Users")).toBe("C:\\Users");
  expect(parentDirectory("/")).toBe("/");
  expect(parentDirectory("/demo/project")).toBe("/demo/");
  expect(parentDirectory("C:\\")).toBe("C:\\");
  expect(parentDirectory("C:\\Users")).toBe("C:\\");
  expect(parentDirectory("\\\\host\\share\\")).toBe("\\\\host\\share\\");
  expect(completionDirectory("/demo/at")).toEqual({
    parent: "/demo/",
    prefix: "at",
  });
  expect(completionDirectory("C:\\Users\\")).toEqual({
    parent: "C:\\Users\\",
    prefix: "",
  });
  expect(completionDirectory("relative/path")).toBeNull();
});
