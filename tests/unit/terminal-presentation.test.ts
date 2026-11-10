import { describe, expect, it } from "vitest";
import {
  outputUpdate,
  singleLineCommand,
} from "../../src/features/terminal/presentation";

describe("terminal output replay", () => {
  it("replays retained history on a new view and appends only unseen text", () => {
    expect(outputUpdate({ output: "prompt> ", outputStart: 0 }, null)).toEqual({
      reset: true,
      text: "prompt> ",
      end: 8,
    });
    expect(outputUpdate({ output: "prompt> git", outputStart: 0 }, 8)).toEqual({
      reset: false,
      text: "git",
      end: 11,
    });
  });
  it("keeps a mounted terminal intact when old history is trimmed", () => {
    expect(outputUpdate({ output: "23456", outputStart: 2 }, 5)).toEqual({
      reset: false,
      text: "56",
      end: 7,
    });
  });
  it("resets after a hidden view misses more than retained history", () => {
    expect(outputUpdate({ output: "latest", outputStart: 100 }, 20)).toEqual({
      reset: true,
      text: "latest",
      end: 106,
    });
  });
  it("uses matching string offsets for Chinese and surrogate pairs", () => {
    expect(outputUpdate({ output: "你😀好", outputStart: 0 }, 3)).toEqual({
      reset: false,
      text: "好",
      end: 4,
    });
  });
});

describe("explicit prompt filling", () => {
  it("removes control bytes that could execute or rewrite input", () => {
    const input =
      "git status" +
      String.fromCharCode(13, 10, 27) +
      "[A" +
      String.fromCharCode(3);
    expect(singleLineCommand(input)).toBe("git status   [A ");
  });
  it("retains quoted commands and Unicode without appending Enter", () => {
    expect(singleLineCommand('git commit -m "修复"')).toBe(
      'git commit -m "修复"',
    );
  });
});
