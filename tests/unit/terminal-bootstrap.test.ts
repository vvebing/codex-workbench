import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  READ_ONLY_TERMINAL_ENVIRONMENT,
  TERMINAL_BOOTSTRAP,
} from "../../src/features/terminal/bootstrap";
import { shellActivityEnvironment } from "../../src/features/terminal/shell-activity";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});
function fixture(platform = "Darwin") {
  const directory = mkdtempSync(join(tmpdir(), "terminal-bootstrap-"));
  fixtures.push(directory);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "uname"),
    `#!/bin/sh\nprintf '%s\\n' '${platform}'\n`,
    { mode: 0o755 },
  );
  const developer = join(directory, "Developer Tools");
  const tools = join(developer, "usr/bin");
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(tools, "git"), "#!/bin/sh\nprintf 'fixture git\\n'\n", {
    mode: 0o755,
  });
  return { directory, bin, developer, tools };
}
function selectedGit(bin: string, developer: string): string {
  return execFileSync("/bin/sh", ["-c", TERMINAL_BOOTSTRAP], {
    input: "command -v git\nexit\n",
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      DEVELOPER_DIR: developer,
      ...READ_ONLY_TERMINAL_ENVIRONMENT,
    } as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

describe("read-only terminal bootstrap", () => {
  it("shows the current full directory after cd without evaluating shell-looking path characters", () => {
    const f = fixture("Linux");
    const directory =
      "资料 with spaces $(touch PROMPT_SUBSTITUTION) `touch PROMPT_BACKTICK`";
    const nested = join(f.directory, directory);
    mkdirSync(nested);
    const token = "safe-current-directory-prompt";
    const result = spawnSync("/bin/sh", ["-c", TERMINAL_BOOTSTRAP], {
      cwd: f.directory,
      input: `cd '${directory}'\npwd\ncd ..\npwd\nexit\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${f.bin}:/usr/bin:/bin`,
        ...READ_ONLY_TERMINAL_ENVIRONMENT,
        ...shellActivityEnvironment(token),
      } as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    // macOS may canonicalize the temporary-directory prefix to /private/var.
    const [actualNested, actualRoot] = result.stdout.trim().split("\n");
    expect(actualNested.endsWith(directory)).toBe(true);
    const prompts = stripVTControlCharacters(result.stderr);
    expect(prompts).toContain(`${actualNested} $ `);
    expect(prompts.lastIndexOf(`${actualRoot} $ `)).toBeGreaterThan(
      prompts.indexOf(`${actualNested} $ `),
    );
    expect(result.stderr).not.toContain("syntax error");
    for (const path of [f.directory, nested]) {
      expect(existsSync(join(path, "PROMPT_SUBSTITUTION"))).toBe(false);
      expect(existsSync(join(path, "PROMPT_BACKTICK"))).toBe(false);
    }
  });
  it.each([undefined, "", "1"])(
    "colors only the path and honors NO_COLOR presence (%s)",
    (noColor) => {
      const f = fixture("Darwin");
      const result = spawnSync("/bin/sh", ["-c", TERMINAL_BOOTSTRAP], {
        cwd: f.directory,
        input:
          "printf 'plain-output\\n'; printf 'CLICOLOR=%s FORCE=%s\\n' \"${CLICOLOR-unset}\" \"${CLICOLOR_FORCE-unset}\"\nexit\n",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${f.bin}:/usr/bin:/bin`,
          DEVELOPER_DIR: f.developer,
          ...READ_ONLY_TERMINAL_ENVIRONMENT,
          ...shellActivityEnvironment("colored-prompt-fixture"),
          NO_COLOR: noColor,
          CLICOLOR: undefined,
          CLICOLOR_FORCE: "1",
        } as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("plain-output\n");
      expect(result.stdout).not.toContain("\u001b[32m");
      expect(result.stderr).not.toContain("\\[");
      expect(result.stderr).not.toContain("\\]");
      if (noColor === undefined) {
        expect(result.stderr).toContain("\u001b[32m");
        expect(result.stderr).toContain("\u001b[0m $ ");
        expect(result.stdout).toContain("CLICOLOR=1 FORCE=1");
      } else {
        expect(result.stderr).not.toContain("\u001b[32m");
        expect(result.stdout).toContain("CLICOLOR=unset FORCE=unset");
      }
    },
  );
  it.skipIf(!existsSync("/bin/dash"))(
    "uses POSIX ANSI output without Bash prompt markers under dash",
    () => {
      const f = fixture("Linux");
      // Exercise the same bootstrap and final shell with a real dash interpreter.
      const bootstrap = TERMINAL_BOOTSTRAP.replace(
        "exec /bin/sh -i",
        "exec /bin/dash -i",
      );
      const result = spawnSync("/bin/dash", ["-c", bootstrap], {
        cwd: f.directory,
        input: "pwd\nexit\n",
        encoding: "utf8",
        env: {
          ...process.env,
          ...READ_ONLY_TERMINAL_ENVIRONMENT,
          ...shellActivityEnvironment("posix-prompt-fixture"),
          NO_COLOR: undefined,
          BASH_VERSION: undefined,
        } as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("\u001b[32m");
      expect(result.stderr).toContain("\u001b[0m $ ");
      expect(result.stderr).not.toContain("\\[");
      expect(stripVTControlCharacters(result.stderr)).toContain(
        result.stdout.trim() + " $ ",
      );
    },
  );
  it("forwards real primary and continuation prompt hooks through the noninteractive bootstrap shell", () => {
    const f = fixture("Linux");
    const token = "bootstrap-prompt-fixture";
    const result = spawnSync("/bin/sh", ["-c", TERMINAL_BOOTSTRAP], {
      input: "printf 'hello\nworld'\nexit\n",
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${f.bin}:/usr/bin:/bin`,
        ...READ_ONLY_TERMINAL_ENVIRONMENT,
        ...shellActivityEnvironment(token),
      } as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("hello\nworld");
    expect(result.stderr).toContain(
      `\u001b]777;codex-workbench;${token};idle\u0007`,
    );
    expect(result.stderr).toContain(
      `\u001b]777;codex-workbench;${token};input\u0007`,
    );
    expect(result.stderr).not.toContain("syntax error");
    expect(result.stdout).not.toContain("codex-workbench;");
  });
  it("resolves only Apple's shim to the existing real Git in the selected developer directory", () => {
    const f = fixture();
    expect(selectedGit(f.bin, f.developer)).toBe(join(f.tools, "git"));
  });
  it("accepts DEVELOPER_DIR pointing at an Xcode app bundle", () => {
    const f = fixture();
    const app = join(f.directory, "Xcode Beta.app");
    const bin = join(app, "Contents/Developer/usr/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(selectedGit(f.bin, `${app}/`)).toBe(join(bin, "git"));
  });
  it("preserves an existing custom Git earlier on PATH", () => {
    const f = fixture();
    writeFileSync(join(f.bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(selectedGit(f.bin, f.developer)).toBe(join(f.bin, "git"));
  });
  it("does not add Apple toolchain paths on other platforms", () => {
    const f = fixture("Linux");
    expect(selectedGit(f.bin, f.developer)).toBe("/usr/bin/git");
  });
  it("keeps the original Git when the explicitly selected real binary is unavailable", () => {
    const f = fixture();
    expect(selectedGit(f.bin, join(f.directory, "missing"))).toBe(
      "/usr/bin/git",
    );
  });
});
