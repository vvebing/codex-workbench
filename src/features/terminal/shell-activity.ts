export type ShellActivity = "idle" | "busy" | "unknown";
export type ShellPromptEvent = "idle" | "background" | "input";

type PromptObligation = "initial" | "submission" | "interrupt";
export interface ShellInputActivity {
  activity: ShellActivity;
  background: boolean;
}

/**
 * A prompt ends one physical input cycle, not every command already queued in a
 * PTY. Keep those cycles separate so an intermediate prompt cannot imply idle.
 */
export class ShellInputTracker {
  private obligations: PromptObligation[] = ["initial"];
  private integrated = false;
  private uncertain = false;
  private previousCR = false;
  private inputPrefix = "";
  private pasting = false;
  private state: ShellInputActivity = {
    activity: "unknown",
    background: false,
  };
  private enqueue(obligation: PromptObligation) {
    if (this.obligations.length < 1024) this.obligations.push(obligation);
    else this.uncertain = true;
  }
  write(input: string): ShellInputActivity & { changed: boolean } {
    const text = this.inputPrefix + input;
    this.inputPrefix = "";
    let changed = false;
    const delimiters = ["\u001b[200~", "\u001b[201~"];
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\u001b") {
        const remaining = text.slice(index);
        const delimiter = delimiters.find((value) =>
          remaining.startsWith(value),
        );
        if (delimiter) {
          const opening = delimiter === delimiters[0];
          if (opening === this.pasting) this.uncertain = true;
          this.pasting = opening;
          this.previousCR = false;
          index += delimiter.length - 1;
          continue;
        }
        if (delimiters.some((value) => value.startsWith(remaining))) {
          this.inputPrefix = remaining;
          break;
        }
      }
      const character = text[index];
      if (character === "\r" || character === "\n") {
        changed = true;
        if (this.pasting) {
          // Readline edits pasted line breaks rather than submitting them. Shell
          // parsing of that multiline buffer cannot be mapped to prompt cycles.
          this.uncertain = true;
        } else if (character === "\n" && this.previousCR) {
          // Normalize CRLF across writes, but raw PTY line discipline may have
          // interpreted both bytes. Do not assert idle from that ambiguity.
          this.uncertain = true;
        } else this.enqueue("submission");
        this.previousCR = character === "\r";
        this.state = {
          activity: this.integrated && !this.uncertain ? "busy" : "unknown",
          background: false,
        };
        continue;
      }
      this.previousCR = false;
      if (character !== "\u0003") continue;
      changed = true;
      const pending = this.obligations.filter((entry) => entry !== "initial");
      if (this.pasting || pending.length > 1 || pending.includes("interrupt"))
        this.uncertain = true;
      // The kernel may flush queued input on interrupt. A single foreground
      // cycle has one following prompt; cancellation of multiple cycles cannot
      // be reconstructed reliably and remains uncertain.
      this.obligations = this.obligations.includes("initial")
        ? ["initial"]
        : [];
      this.enqueue("interrupt");
      this.state = { activity: "unknown", background: false };
    }
    return { ...this.state, changed };
  }
  prompt(event: ShellPromptEvent): ShellInputActivity {
    if (!this.integrated) {
      // A continuation hook alone does not prove an initial primary prompt was
      // observed. Never spend an early submitted command on the initial prompt.
      if (event !== "input") {
        this.integrated = true;
        if (this.obligations[0] === "initial") this.obligations.shift();
      }
    } else if (this.obligations.length) {
      if (event === "input" && this.obligations[0] === "interrupt")
        this.uncertain = true;
      else this.obligations.shift();
    }
    this.state =
      event === "background"
        ? { activity: "busy", background: true }
        : event === "input"
          ? // A simple PS2 hook is reliable inside unfinished shell quotations,
            // but does not inspect jobs. Waiting input cannot establish idle.
            { activity: "unknown", background: false }
          : {
              activity:
                this.integrated &&
                !this.uncertain &&
                !this.pasting &&
                !this.inputPrefix &&
                !this.obligations.length
                  ? "idle"
                  : "unknown",
              background: false,
            };
    return this.state;
  }
  invalidate(): ShellInputActivity {
    this.uncertain = true;
    this.state = { activity: "unknown", background: false };
    return this.state;
  }
}

/**
 * Prompt hooks are literal shell source: inspecting the environment must not emit
 * terminal control bytes. Only printf at an actual prompt emits the private OSC.
 */
export function shellActivityEnvironment(
  token: string,
): Record<string, string> {
  const marker = (event: ShellPromptEvent) =>
    `printf '\\033]777;codex-workbench;%s;${event}\\007' "$CODEX_WORKBENCH_TERMINAL_TOKEN" >&2`;
  // Read PWD at each prompt and print it as data. Interpolating the path into
  // PS1 source would allow filenames containing $() or backticks to run code.
  const activity = `if [ -n "$(jobs -p)" ]; then ${marker("background")}; else ${marker("idle")}; fi`;
  const primary = `$(${activity}; printf '%s' "$PWD") $ `;
  // Bash/readline must count PWD normally and only hide the ANSI fragments.
  // Other POSIX shells receive actual ANSI from printf, never Bash's \[ / \].
  const bashPrimary = `$(${activity})\\[\\033[32m\\]$(printf '%s' "$PWD")\\[\\033[0m\\] $ `;
  const posixPrimary = `$(${activity}; printf '\\033[32m%s\\033[0m' "$PWD") $ `;
  const continuation = `$(${marker("input")})> `;
  return {
    CODEX_WORKBENCH_TERMINAL_TOKEN: token,
    // Noninteractive shells may reset PS1/PS2 before evaluating the bootstrap.
    // Carry an ordinary variable copy, then explicitly export at the exec site.
    CODEX_WORKBENCH_TERMINAL_PS1: primary,
    CODEX_WORKBENCH_TERMINAL_PS1_BASH: bashPrimary,
    CODEX_WORKBENCH_TERMINAL_PS1_POSIX: posixPrimary,
    CODEX_WORKBENCH_TERMINAL_PS2: continuation,
    PS1: primary,
    PS2: continuation,
  };
}

const EVENTS: ShellPromptEvent[] = ["idle", "background", "input"];
const TERMINATORS = ["\u0007", "\u001b\\"];

/** Strip only this process's prompt markers, including markers split across chunks. */
export class ShellActivityParser {
  private pending = "";
  private readonly prefix: string;
  constructor(token: string) {
    this.prefix = `\u001b]777;codex-workbench;${token};`;
  }
  push(chunk: string): { output: string; events: ShellPromptEvent[] } {
    const text = this.pending + chunk;
    this.pending = "";
    let output = "";
    const events: ShellPromptEvent[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(this.prefix, cursor);
      if (start < 0) {
        const remaining = text.slice(cursor);
        // A partial prefix may be completed by the next UTF-8-decoded chunk.
        let retained = Math.min(remaining.length, this.prefix.length - 1);
        while (retained && !this.prefix.startsWith(remaining.slice(-retained)))
          retained--;
        output += retained ? remaining.slice(0, -retained) : remaining;
        this.pending = retained ? remaining.slice(-retained) : "";
        break;
      }
      output += text.slice(cursor, start);
      const tail = text.slice(start + this.prefix.length);
      let matched = false;
      for (const event of EVENTS) {
        for (const terminator of TERMINATORS) {
          const suffix = event + terminator;
          if (!tail.startsWith(suffix)) continue;
          events.push(event);
          cursor = start + this.prefix.length + suffix.length;
          matched = true;
          break;
        }
        if (matched) break;
      }
      if (matched) continue;
      if (
        EVENTS.some((event) =>
          TERMINATORS.some((terminator) =>
            (event + terminator).startsWith(tail),
          ),
        )
      ) {
        // At most prefix + longest event + terminator bytes are buffered.
        this.pending = text.slice(start);
        break;
      }
      // Wrong nonce/event or unrelated OSC belongs to the user's terminal output.
      output += text[start];
      cursor = start + 1;
    }
    return { output, events };
  }
  finish(): string {
    // A process can exit while its private marker is being streamed. Once the
    // complete nonce matched, incomplete private protocol is not user output.
    const output = this.pending.startsWith(this.prefix) ? "" : this.pending;
    this.pending = "";
    return output;
  }
}
