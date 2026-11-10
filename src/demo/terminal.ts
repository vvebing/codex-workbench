import { t } from "../lib/i18n";
import type { CommandExecResponse } from "../generated/v2/CommandExecResponse";
import type { RpcNotification } from "../lib/rpc";
import { readOnlyTerminalCommand } from "../features/terminal/bootstrap";

type Params = Record<string, unknown>;
type Process = {
  id: string;
  cwd: string;
  token: string;
  color: boolean;
  input: string;
  previousCR: boolean;
  discardInput: boolean;
  decoder: TextDecoder;
  resolve: (result: CommandExecResponse) => void;
  following?: { path: string; text: string };
};
type Result = {
  text: string;
  display?: string;
  code?: number;
  follow?: string;
  exit?: number;
};
const asString = (value: unknown) => (typeof value === "string" ? value : "");
const encode = (text: string) =>
  btoa(
    Array.from(new TextEncoder().encode(text), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  );
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const unsupported = (value: string) =>
  new Error(
    t("演示终端尚未模拟此命令或参数：{{value0}}。输入 help 查看支持范围。", {
      value0: value,
    }),
  );
const denied = (value: string) =>
  new Error(t("只读演示终端不允许写入或联网：{{value0}}。", { value0: value }));
const syntax = (value: string) =>
  new Error(
    t("演示终端不支持此 Shell 语法：{{value0}}。仅支持引号、转义和简单管道。", {
      value0: value,
    }),
  );

/** A small tokenizer, never a shell interpreter. No expansion or executable code. */
export function parseDemoTerminalCommand(source: string): string[][] {
  const pipeline: string[][] = [];
  let words: string[] = [];
  let word = "";
  let started = false;
  let quote = "";
  const finish = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "\\" && quote !== "'") {
      if (++index === source.length) throw syntax("\\");
      word += source[index];
      started = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else {
        if (quote === '"' && (character === "$" || character === "`"))
          throw syntax(character);
        word += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) finish();
    else if (character === "|") {
      finish();
      if (!words.length) throw syntax("|");
      pipeline.push(words);
      words = [];
    } else if (character === ">" || character === "<") throw denied(character);
    else if (";&$`(){}*?[]".includes(character)) throw syntax(character);
    else {
      word += character;
      started = true;
    }
  }
  if (quote) throw syntax(quote);
  finish();
  if (pipeline.length && !words.length) throw syntax("|");
  if (words.length) pipeline.push(words);
  return pipeline;
}

/** Simple find -name glob matching without constructing user-supplied regexes. */
function matchesName(name: string, pattern: string): boolean {
  let position = 0;
  let index = 0;
  let star = -1;
  let retry = 0;
  while (position < name.length) {
    if (pattern[index] === "?" || pattern[index] === name[position]) {
      index++;
      position++;
    } else if (pattern[index] === "*") {
      star = index++;
      retry = position;
    } else if (star >= 0) {
      index = star + 1;
      position = ++retry;
    } else return false;
  }
  while (pattern[index] === "*") index++;
  return index === pattern.length;
}

/** One instance per demo socket; all file contents are the service's virtual Map. */
export class DemoTerminalSessions {
  private processes = new Map<string, Process>();
  constructor(
    private files: Map<string, string>,
    private roots: string[],
    private baseline: (path: string) => string | undefined,
    private deliver: (notification: RpcNotification) => void,
  ) {}
  private emit(process: Process, text: string) {
    if (!text || this.processes.get(process.id) !== process) return;
    this.deliver({
      method: "command/exec/outputDelta",
      params: {
        processId: process.id,
        stream: "stdout",
        deltaBase64: encode(text.replace(/\r?\n/g, "\r\n")),
        capReached: false,
      },
    });
  }
  private prompt(process: Process) {
    this.emit(
      process,
      `\u001b]777;codex-workbench;${process.token};idle\u0007${this.color(process, process.cwd, 32)} $ `,
    );
  }
  private color(process: Process, text: string, code: number) {
    return process.color ? `\u001b[${code}m${text}\u001b[0m` : text;
  }
  private highlight(
    process: Process,
    text: string,
    pattern: string,
    insensitive: boolean,
  ) {
    if (!pattern || !process.color) return text;
    const searchable = insensitive ? text.toLowerCase() : text;
    let output = "";
    let cursor = 0;
    for (
      let found = searchable.indexOf(pattern);
      found >= 0;
      found = searchable.indexOf(pattern, cursor)
    ) {
      output +=
        text.slice(cursor, found) +
        this.color(process, text.slice(found, found + pattern.length), 32);
      cursor = found + pattern.length;
    }
    return output + text.slice(cursor);
  }
  private directories() {
    const directories = new Set(["/", "/demo", ...this.roots]);
    for (const path of this.files.keys()) {
      const parts = path.split("/");
      for (let index = 2; index < parts.length; index++)
        directories.add(parts.slice(0, index).join("/"));
    }
    return directories;
  }
  private path(process: Process, value: string): string {
    const parts: string[] = [];
    const path = value.startsWith("/") ? value : `${process.cwd}/${value}`;
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    const normalized = "/" + parts.join("/");
    if (
      normalized !== "/" &&
      normalized !== "/demo" &&
      !this.roots.some(
        (root) => normalized === root || normalized.startsWith(root + "/"),
      )
    )
      throw new Error(
        t("演示终端仅支持示例项目中的路径：{{value0}}。", {
          value0: normalized,
        }),
      );
    return normalized;
  }
  private read(process: Process, value: string) {
    const path = this.path(process, value);
    const text = this.files.get(path);
    if (text === undefined)
      throw new Error(t("演示终端找不到路径：{{value0}}。", { value0: value }));
    return { path, text };
  }
  private get(p: Params) {
    const process = this.processes.get(asString(p.processId));
    if (!process) throw new Error(t("演示终端会话不存在或已关闭。"));
    return process;
  }
  spawn(p: Params): Promise<CommandExecResponse> {
    const command = Array.isArray(p.command) ? p.command : [];
    const policy = p.sandboxPolicy as
      { type?: unknown; networkAccess?: unknown } | undefined;
    const id = asString(p.processId);
    const env = p.env as Record<string, unknown> | undefined;
    const token = asString(env?.CODEX_WORKBENCH_TERMINAL_TOKEN);
    if (
      !p.tty ||
      !id ||
      !token ||
      token.length > 128 ||
      JSON.stringify(command) !== JSON.stringify(readOnlyTerminalCommand()) ||
      policy?.type !== "readOnly" ||
      policy.networkAccess !== false ||
      this.processes.has(id)
    )
      throw new Error(t("演示终端仅支持工作台内置的只读 Shell 会话。"));
    const cwd = asString(p.cwd);
    if (!this.directories().has(cwd))
      throw new Error(t("演示终端找不到路径：{{value0}}。", { value0: cwd }));
    return new Promise((resolve) => {
      const process: Process = {
        id,
        cwd,
        token,
        color: typeof env?.NO_COLOR !== "string",
        input: "",
        previousCR: false,
        discardInput: false,
        decoder: new TextDecoder("utf-8", { fatal: true }),
        resolve,
      };
      this.processes.set(id, process);
      queueMicrotask(() => {
        this.emit(
          process,
          t(
            "模拟只读终端：仅操作浏览器内的示例文件，不执行真实命令。输入 help 查看支持范围。",
          ) + "\n",
        );
        this.prompt(process);
      });
    });
  }
  resize(p: Params) {
    this.get(p);
    return {};
  }
  terminate(p: Params) {
    this.finish(this.get(p), 130);
    return {};
  }
  private finish(process: Process, exitCode: number) {
    this.processes.delete(process.id);
    process.following = undefined;
    process.resolve({ exitCode, stdout: "", stderr: "" });
  }
  detach() {
    for (const process of this.processes.values()) this.finish(process, 130);
  }
  fileChanged(path: string) {
    for (const process of this.processes.values()) {
      const follow = process.following;
      if (follow?.path !== path) continue;
      const text = this.files.get(path) ?? "";
      this.emit(
        process,
        text.startsWith(follow.text)
          ? text.slice(follow.text.length)
          : t("演示日志文件已替换，显示当前虚拟文件内容：") + "\n" + text,
      );
      follow.text = text;
    }
  }
  write(p: Params) {
    const process = this.get(p);
    const bytes = Uint8Array.from(atob(asString(p.deltaBase64)), (character) =>
      character.charCodeAt(0),
    );
    const text = process.decoder.decode(bytes, { stream: true });
    for (const character of text) {
      if (!this.processes.has(process.id)) break;
      if (character === "\u0003") {
        process.input = "";
        process.discardInput = false;
        process.following = undefined;
        process.previousCR = false;
        this.emit(process, "^C\n");
        this.prompt(process);
      } else if (character === "\r" || character === "\n") {
        if (character === "\n" && process.previousCR) {
          process.previousCR = false;
          continue;
        }
        process.previousCR = character === "\r";
        this.emit(process, "\n");
        if (process.discardInput) {
          process.discardInput = false;
          this.emit(process, t("演示终端命令过长，请缩短后重试。") + "\n");
          this.prompt(process);
          continue;
        }
        if (process.following) continue;
        const input = process.input;
        process.input = "";
        this.execute(process, input);
      } else if (character === "\u007f" || character === "\b") {
        process.previousCR = false;
        if (!process.following && process.input) {
          process.input = Array.from(process.input).slice(0, -1).join("");
          this.emit(process, "\b \b");
        }
      } else if (character === "\u0004") {
        if (!process.input) this.finish(process, 0);
      } else if (
        character.charCodeAt(0) >= 32 &&
        character.charCodeAt(0) !== 127
      ) {
        process.previousCR = false;
        if (process.discardInput) continue;
        if (!process.following) process.input += character;
        this.emit(process, character);
        if (process.input.length > 8192) {
          process.input = "";
          process.discardInput = true;
        }
      }
    }
    if (p.closeStdin && this.processes.has(process.id)) this.finish(process, 0);
    return {};
  }
  private execute(process: Process, source: string) {
    try {
      const pipeline = parseDemoTerminalCommand(source);
      let input: string | undefined;
      let result: Result = { text: "" };
      for (const words of pipeline) {
        if (pipeline.length > 1 && ["cd", "exit", "clear"].includes(words[0]))
          throw unsupported(source);
        result = this.command(process, words, input);
        if (result.follow && pipeline.length > 1) throw unsupported(source);
        input = result.text;
      }
      this.emit(process, result.display ?? result.text);
      if (result.exit !== undefined) {
        this.finish(process, result.exit);
        return;
      }
      if (result.follow) {
        process.following = {
          path: result.follow,
          text: this.files.get(result.follow) ?? "",
        };
        return;
      }
    } catch (error) {
      this.emit(
        process,
        this.color(
          process,
          error instanceof Error ? error.message : String(error),
          31,
        ) + "\n",
      );
    }
    this.prompt(process);
  }
  private command(process: Process, words: string[], input?: string): Result {
    const [command, ...args] = words;
    const joined = words.join(" ");
    if (
      [
        "touch",
        "mkdir",
        "rm",
        "rmdir",
        "mv",
        "cp",
        "tee",
        "chmod",
        "chown",
        "truncate",
        "dd",
        "curl",
        "wget",
        "ssh",
        "scp",
        "npm",
        "pnpm",
        "yarn",
        "npx",
        "pip",
        "pip3",
      ].includes(command)
    )
      throw denied(joined);
    if (command === "help" && !args.length)
      return {
        text:
          t(
            "支持：pwd、ls、cd、find、cat、head、tail、grep、rg、wc、echo、uname、command -v、git branch/status/log/diff/show、clear、exit。\n支持引号、中文与空格路径、简单管道；grep/rg 使用字面文本匹配。tail -f 跟踪虚拟文件变化，Ctrl+C 返回提示符。写入、联网和其他 Shell 语法不会执行。",
          ) + "\n",
      };
    if (command === "pwd" && !args.length) return { text: process.cwd + "\n" };
    if (command === "cd" && args.length <= 1) {
      const path = this.path(process, args[0] ?? this.roots[0]);
      if (!this.directories().has(path))
        throw new Error(
          t("演示终端找不到路径：{{value0}}。", { value0: path }),
        );
      process.cwd = path;
      return { text: "" };
    }
    if (command === "ls") {
      const paths = args.filter((arg) => !arg.startsWith("-"));
      if (
        paths.length > 1 ||
        args.some(
          (arg) => arg.startsWith("-") && !["-1", "-a", "-A"].includes(arg),
        )
      )
        throw unsupported(joined);
      const path = this.path(process, paths[0] ?? ".");
      if (this.files.has(path)) return { text: path.split("/").at(-1) + "\n" };
      if (!this.directories().has(path))
        throw new Error(
          t("演示终端找不到路径：{{value0}}。", { value0: path }),
        );
      const parent = (entry: string) =>
        entry.slice(0, entry.lastIndexOf("/")) || "/";
      const names = [...this.directories(), ...this.files.keys()]
        .filter((entry) => entry !== path && parent(entry) === path)
        .map((entry) => entry.split("/").at(-1)!);
      names.sort();
      return {
        text: names.join("\n") + (names.length ? "\n" : ""),
        display:
          names
            .map((name) =>
              this.directories().has(`${path === "/" ? "" : path}/${name}`)
                ? this.color(process, name, 34)
                : name,
            )
            .join("\n") + (names.length ? "\n" : ""),
      };
    }
    if (command === "find") {
      const root = args[0] && !args[0].startsWith("-") ? args.shift()! : ".";
      const path = this.path(process, root);
      let name = "*";
      let type = "";
      while (args.length) {
        const flag = args.shift();
        const value = args.shift();
        if (flag === "-name" && value !== undefined) name = value;
        else if (flag === "-type" && (value === "f" || value === "d"))
          type = value;
        else throw unsupported(joined);
      }
      if (!this.directories().has(path) && !this.files.has(path))
        throw new Error(
          t("演示终端找不到路径：{{value0}}。", { value0: root }),
        );
      const candidates =
        type === "f"
          ? [...this.files.keys()]
          : type === "d"
            ? [...this.directories()]
            : [...this.directories(), ...this.files.keys()];
      return {
        text:
          candidates
            .filter(
              (entry) =>
                (entry === path ||
                  entry.startsWith(path === "/" ? "/" : path + "/")) &&
                matchesName(entry.split("/").at(-1)!, name),
            )
            .sort()
            .map((entry) =>
              root.startsWith("/")
                ? entry
                : root.replace(/\/$/, "") + entry.slice(path.length),
            )
            .join("\n") + "\n",
      };
    }
    if (command === "cat") {
      if (!args.length && input !== undefined) return { text: input };
      if (!args.length || args.some((arg) => arg.startsWith("-")))
        throw unsupported(joined);
      return {
        text: args.map((path) => this.read(process, path).text).join(""),
      };
    }
    if (command === "head" || command === "tail") {
      let count = 10;
      let follow = false;
      const paths: string[] = [];
      for (let index = 0; index < args.length; index++) {
        if (args[index] === "-n" && /^\d+$/.test(args[index + 1] ?? ""))
          count = Math.min(10000, Number(args[++index]));
        else if (args[index] === "-f" && command === "tail") follow = true;
        else if (args[index].startsWith("-")) throw unsupported(joined);
        else paths.push(args[index]);
      }
      if (
        paths.length > 1 ||
        (!paths.length && input === undefined) ||
        (follow && !paths.length)
      )
        throw unsupported(joined);
      const file = paths.length ? this.read(process, paths[0]) : undefined;
      const content = lines(file?.text ?? input ?? "");
      return {
        text: (command === "head"
          ? content.slice(0, count)
          : count
            ? content.slice(-count)
            : []
        ).join(""),
        ...(follow ? { follow: file!.path } : {}),
      };
    }
    if (command === "grep" || command === "rg") {
      if (command === "rg" && args[0] === "--files" && args.length <= 2) {
        const root = this.path(process, args[1] ?? ".");
        if (!this.directories().has(root))
          throw new Error(
            t("演示终端找不到路径：{{value0}}。", { value0: root }),
          );
        return {
          text:
            [...this.files.keys()]
              .filter((path) => path.startsWith(root + "/"))
              .map((path) => path.slice(process.cwd.length + 1))
              .sort()
              .join("\n") + "\n",
        };
      }
      let numbered = false;
      let insensitive = false;
      let invert = false;
      let colored = command === "rg";
      const values: string[] = [];
      for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (["-n", "--line-number"].includes(arg)) numbered = true;
        else if (["-i", "--ignore-case"].includes(arg)) insensitive = true;
        else if (["-v", "--invert-match"].includes(arg)) invert = true;
        else if (["-F", "--fixed-strings", "--no-config"].includes(arg))
          continue;
        else if (
          arg === "--color" &&
          ["auto", "never"].includes(args[index + 1])
        ) {
          colored = args[++index] === "auto";
        } else if (["--color=auto", "--color=never"].includes(arg))
          colored = arg === "--color=auto";
        else if (arg.startsWith("-")) throw unsupported(joined);
        else values.push(arg);
      }
      if (
        !values.length ||
        values.length > 2 ||
        (command === "grep" && values.length < 2 && input === undefined)
      )
        throw unsupported(joined);
      const pattern = insensitive ? values[0].toLowerCase() : values[0];
      const searchPath =
        values.length === 2 ? this.path(process, values[1]) : process.cwd;
      if (
        command === "rg" &&
        input === undefined &&
        this.directories().has(searchPath)
      ) {
        const matches: string[] = [];
        const display: string[] = [];
        for (const [path, text] of this.files) {
          if (!path.startsWith(searchPath + "/")) continue;
          for (const [index, line] of lines(text).entries()) {
            if (
              (insensitive ? line.toLowerCase() : line).includes(pattern) ===
              invert
            )
              continue;
            matches.push(
              path.slice(process.cwd.length + 1) +
                ":" +
                (numbered ? `${index + 1}:` : "") +
                line,
            );
            display.push(
              this.color(process, path.slice(process.cwd.length + 1), 35) +
                ":" +
                (numbered
                  ? this.color(process, String(index + 1), 90) + ":"
                  : "") +
                (invert
                  ? line
                  : this.highlight(process, line, pattern, insensitive)),
            );
          }
        }
        return {
          text: matches.join(""),
          display: colored ? display.join("") : undefined,
          code: matches.length ? 0 : 1,
        };
      }
      const content =
        values.length === 2 ? this.read(process, values[1]).text : input!;
      const matched = lines(content)
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line }) =>
            (insensitive ? line.toLowerCase() : line).includes(pattern) !==
            invert,
        );
      return {
        text: matched
          .map(({ line, index }) => (numbered ? `${index + 1}:` : "") + line)
          .join(""),
        display: colored
          ? matched
              .map(
                ({ line, index }) =>
                  (numbered
                    ? this.color(process, String(index + 1), 90) + ":"
                    : "") +
                  (invert
                    ? line
                    : this.highlight(process, line, pattern, insensitive)),
              )
              .join("")
          : undefined,
        code: matched.length ? 0 : 1,
      };
    }
    if (command === "wc") {
      const mode = args[0]?.startsWith("-") ? args.shift()! : "";
      if (
        !["", "-l", "-w", "-c"].includes(mode) ||
        args.length > 1 ||
        (!args.length && input === undefined)
      )
        throw unsupported(joined);
      const content = args.length ? this.read(process, args[0]).text : input!;
      const counts = {
        "-l": content.split("\n").length - 1,
        "-w": content.trim() ? content.trim().split(/\s+/).length : 0,
        "-c": new TextEncoder().encode(content).length,
      };
      return {
        text:
          (mode
            ? String(counts[mode as keyof typeof counts])
            : Object.values(counts).join(" ")) +
          (args.length ? ` ${args[0]}` : "") +
          "\n",
      };
    }
    if (command === "echo")
      return {
        text:
          args[0] === "-n" ? args.slice(1).join(" ") : args.join(" ") + "\n",
      };
    if (command === "clear" && !args.length)
      return { text: "\u001b[2J\u001b[H" };
    if (
      command === "exit" &&
      args.length <= 1 &&
      (!args.length || /^\d+$/.test(args[0]))
    )
      return { text: "", exit: args.length ? Number(args[0]) % 256 : 0 };
    if (
      command === "uname" &&
      args.length <= 1 &&
      (!args.length || args[0] === "-s" || args[0] === "-a")
    )
      return { text: t("DemoBrowser (simulated)") + "\n" };
    if (command === "command" && args[0] === "-v" && args.length === 2) {
      const known = [
        "sh",
        "git",
        "pwd",
        "ls",
        "cd",
        "find",
        "cat",
        "head",
        "tail",
        "grep",
        "rg",
        "wc",
        "echo",
        "help",
        "clear",
        "exit",
        "uname",
      ];
      return {
        text: known.includes(args[1]) ? `[demo] ${args[1]}\n` : "",
        code: known.includes(args[1]) ? 0 : 1,
      };
    }
    if (command === "git") return this.git(process, args, joined);
    throw unsupported(joined);
  }
  private git(process: Process, args: string[], joined: string): Result {
    const noColor =
      args.includes("--no-color") || args.includes("--color=never");
    args = args.filter(
      (argument) => !["--no-color", "--color=never"].includes(argument),
    );
    while (args[0] === "--no-optional-locks") args.shift();
    const root = this.roots.find(
      (entry) => process.cwd === entry || process.cwd.startsWith(entry + "/"),
    );
    if (!root) throw unsupported(joined);
    const [command, ...options] = args;
    const changed = [...this.files].filter(
      ([path, text]) =>
        path.startsWith(root + "/") && text !== this.baseline(path),
    );
    if (command === "branch") {
      if (options.includes("--show-current") && options.length === 1)
        return { text: "demo/workbench\n" };
      if (options.some((option) => !["--list", "-a", "--all"].includes(option)))
        throw denied(joined);
      return {
        text: "* demo/workbench\n",
        display: noColor
          ? undefined
          : this.color(process, "* demo/workbench", 32) + "\n",
      };
    }
    if (
      command === "status" &&
      options.every((option) =>
        ["--short", "-s", "--porcelain"].includes(option),
      )
    )
      return {
        text:
          "## demo/workbench\n" +
          changed
            .map(
              ([path]) =>
                `${this.baseline(path) === undefined ? "??" : " M"} ${path.slice(root.length + 1)}\n`,
            )
            .join(""),
      };
    if (
      command === "log" &&
      options.every((option) => ["--oneline", "-1", "-n", "1"].includes(option))
    )
      return { text: t("1111111 演示：更新工作台示例") + "\n" };
    if (
      command === "show" &&
      options.length === 1 &&
      options[0].startsWith("HEAD:")
    ) {
      const path = this.path(process, root + "/" + options[0].slice(5));
      const text = this.baseline(path);
      if (text === undefined)
        throw new Error(
          t("演示终端找不到路径：{{value0}}。", { value0: path }),
        );
      return { text };
    }
    if (
      (command === "diff" || command === "show") &&
      options.every((option) => option === "--" || !option.startsWith("-"))
    ) {
      const paths = options.filter((option) => option !== "--");
      if (command === "show" && paths.length) throw unsupported(joined);
      const selected = paths.length
        ? paths.map((path) => this.path(process, path))
        : undefined;
      const text = changed
        .filter(([path]) => !selected || selected.includes(path))
        .map(([path, text]) => {
          const name = path.slice(root.length + 1);
          return (
            `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ demo @@\n` +
            lines(this.baseline(path) ?? "")
              .map((line) => "-" + line)
              .join("") +
            lines(text)
              .map((line) => "+" + line)
              .join("")
          );
        })
        .join("");
      return {
        text,
        display: noColor
          ? undefined
          : lines(text)
              .map((line) =>
                this.color(
                  process,
                  line,
                  line.startsWith("+") ? 32 : line.startsWith("-") ? 31 : 36,
                ),
              )
              .join(""),
      };
    }
    if (
      [
        "add",
        "commit",
        "push",
        "pull",
        "fetch",
        "checkout",
        "switch",
        "restore",
        "reset",
        "clean",
        "merge",
        "rebase",
        "cherry-pick",
        "tag",
        "stash",
        "init",
        "clone",
        "remote",
        "config",
        "update-index",
        "apply",
        "worktree",
      ].includes(command)
    )
      throw denied(joined);
    throw unsupported(joined);
  }
}
