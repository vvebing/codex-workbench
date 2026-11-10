import { describe, expect, it } from "vitest";
import {
  ShellActivityParser,
  ShellInputTracker,
  shellActivityEnvironment,
} from "../../src/features/terminal/shell-activity";

const token = "fixture-token";
const marker = (event: string, nonce = token, end = "\u0007") =>
  `\u001b]777;codex-workbench;${nonce};${event}${end}`;

describe("terminal shell activity", () => {
  it("strips only authenticated prompt markers and preserves surrounding ANSI", () => {
    const parser = new ShellActivityParser(token);
    expect(parser.push(`\u001b[32mhello\u001b[0m${marker("idle")}$ `)).toEqual({
      output: "\u001b[32mhello\u001b[0m$ ",
      events: ["idle"],
    });
    const unrelated = `${marker("idle", "other-token")}\u001b]0;title\u0007${marker("unsupported")}`;
    expect(parser.push(unrelated)).toEqual({ output: unrelated, events: [] });
  });
  it("recognizes every possible chunk boundary and both OSC terminators", () => {
    for (const terminator of ["\u0007", "\u001b\\"]) {
      const control = marker("background", token, terminator);
      for (let split = 0; split <= control.length; split++) {
        const parser = new ShellActivityParser(token);
        const a = parser.push(`before${control.slice(0, split)}`);
        const b = parser.push(`${control.slice(split)}after`);
        expect(a.output + b.output).toBe("beforeafter");
        expect([...a.events, ...b.events]).toEqual(["background"]);
        expect(parser.finish()).toBe("");
      }
    }
  });
  it("supports byte-sized chunks, multiple events and continuation prompts", () => {
    const parser = new ShellActivityParser(token);
    const text = `${marker("idle")}$ command\r\n${marker("input")}> more\r\n${marker("background")}$ `;
    let output = "";
    const events: string[] = [];
    for (const character of text) {
      const parsed = parser.push(character);
      output += parsed.output;
      events.push(...parsed.events);
    }
    expect(output).toBe("$ command\r\n> more\r\n$ ");
    expect(events).toEqual(["idle", "input", "background"]);
  });
  it("does not buffer arbitrarily long malformed sequences and flushes incomplete ANSI", () => {
    const parser = new ShellActivityParser(token);
    const malformed = `\u001b]777;codex-workbench;${token};${"x".repeat(100_000)}`;
    expect(parser.push(malformed)).toEqual({ output: malformed, events: [] });
    expect(parser.push("suffix\u001b]")).toEqual({
      output: "suffix",
      events: [],
    });
    expect(parser.finish()).toBe("\u001b]");
    expect(parser.finish()).toBe("");
  });
  it("does not expose an authenticated marker cut short by process exit", () => {
    const parser = new ShellActivityParser(token);
    expect(parser.push(marker("idle").slice(0, -2))).toEqual({
      output: "",
      events: [],
    });
    expect(parser.finish()).toBe("");
  });
  it("keeps environment hooks printable and uses jobs evidence without changing shell startup", () => {
    const environment = shellActivityEnvironment(token);
    expect(environment.CODEX_WORKBENCH_TERMINAL_TOKEN).toBe(token);
    expect(environment.PS1).toContain("$(jobs -p)");
    expect(environment.PS1).toContain(";background\\007");
    expect(environment.PS1).toContain(";idle\\007");
    expect(environment.PS1).toContain("printf '%s' \"$PWD\"");
    expect(environment.CODEX_WORKBENCH_TERMINAL_PS1_BASH).toContain(
      "\\[\\033[32m\\]$(printf '%s' \"$PWD\")\\[\\033[0m\\]",
    );
    expect(environment.CODEX_WORKBENCH_TERMINAL_PS1_POSIX).toContain(
      "printf '\\033[32m%s\\033[0m' \"$PWD\"",
    );
    expect(environment.CODEX_WORKBENCH_TERMINAL_PS1_POSIX).not.toContain("\\[");
    expect(environment.PS1.endsWith("$ ")).toBe(true);
    expect(environment.PS2).toContain(";input\\007");
    expect(environment.PS2.endsWith("> ")).toBe(true);
    expect(JSON.stringify(environment)).not.toContain("\\u001b");
    expect(JSON.stringify(environment)).not.toContain("\\u0007");
  });
});

describe("terminal submitted input tracking", () => {
  it("does not mistake intermediate prompts for idle while multiple submitted lines are queued", () => {
    const tracker = new ShellInputTracker();
    expect(tracker.prompt("idle").activity).toBe("idle");
    expect(tracker.write("echo first\nsleep 30\n").activity).toBe("busy");
    expect(tracker.prompt("idle").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("idle");
  });
  it("accounts for rapid independent writes and continuation prompt cycles", () => {
    const tracker = new ShellInputTracker();
    tracker.prompt("idle");
    tracker.write("printf 'hello\r");
    tracker.write("world'\r");
    expect(tracker.prompt("input").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("idle");
    tracker.write("printf 'hello\r");
    expect(tracker.prompt("input").activity).toBe("unknown");
    tracker.write("world'\r");
    expect(tracker.prompt("idle").activity).toBe("idle");
  });
  it("does not consume prequeued input when the first primary prompt establishes integration", () => {
    const tracker = new ShellInputTracker();
    expect(tracker.write("echo first\nsleep 30\n").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("idle");
  });
  it("does not use a continuation hook as an initial primary prompt", () => {
    const tracker = new ShellInputTracker();
    tracker.write("printf 'hello\r");
    expect(tracker.prompt("input").activity).toBe("unknown");
    tracker.write("world'\r");
    expect(tracker.prompt("idle").activity).toBe("unknown");
  });
  it("keeps the interrupt prompt distinct from input submitted immediately after Ctrl+C", () => {
    const tracker = new ShellInputTracker();
    tracker.prompt("idle");
    tracker.write("sleep 30\r");
    expect(tracker.write("\u0003").activity).toBe("unknown");
    tracker.write("sleep 30\r");
    expect(tracker.prompt("idle").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("idle");
    tracker.write("sleep 30\r");
    tracker.write("\u0003");
    expect(tracker.prompt("idle").activity).toBe("idle");
  });
  it("retains uncertainty after interrupting multiple queued submissions", () => {
    const tracker = new ShellInputTracker();
    tracker.prompt("idle");
    tracker.write("echo first\nsleep 30\n");
    tracker.write("\u0003");
    expect(tracker.prompt("idle").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("unknown");
  });
  it("normalizes CRLF across writes without claiming idle under raw-PTY ambiguity", () => {
    const tracker = new ShellInputTracker();
    tracker.prompt("idle");
    tracker.write("echo first\r");
    tracker.write("\nsleep 30\r\n");
    expect(tracker.prompt("idle").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("unknown");
    expect(tracker.prompt("idle").activity).toBe("unknown");
  });
  it("supports single-line bracketed paste split across writes without inventing a submission", () => {
    const tracker = new ShellInputTracker();
    tracker.prompt("idle");
    expect(tracker.write("\u001b[20").changed).toBe(false);
    expect(tracker.write("0~sleep 30\u001b[2").changed).toBe(false);
    expect(tracker.write("01~").changed).toBe(false);
    expect(tracker.write("\r").activity).toBe("busy");
    expect(tracker.prompt("idle").activity).toBe("idle");
  });
  it("keeps ambiguous multiline paste and child-consumed input from producing false idle", () => {
    const pasted = new ShellInputTracker();
    pasted.prompt("idle");
    pasted.write("\u001b[200~echo first\nsleep 30\u001b[201~\r");
    expect(pasted.prompt("idle").activity).toBe("unknown");
    expect(pasted.prompt("idle").activity).toBe("unknown");
    const child = new ShellInputTracker();
    child.prompt("idle");
    child.write("python\r");
    child.write("print('hello')\rquit()\r");
    expect(child.prompt("idle").activity).toBe("unknown");
  });
  it("retains actual background-job evidence even when queued input is uncertain", () => {
    const tracker = new ShellInputTracker();
    tracker.prompt("idle");
    tracker.write("echo first\nsleep 30 &\n");
    expect(tracker.prompt("background")).toEqual({
      activity: "busy",
      background: true,
    });
    expect(tracker.prompt("background")).toEqual({
      activity: "busy",
      background: true,
    });
    expect(tracker.prompt("idle")).toEqual({
      activity: "idle",
      background: false,
    });
  });
});
