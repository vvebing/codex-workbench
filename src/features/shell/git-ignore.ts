import type { CodexClient } from "../../lib/rpc";
import type { CommandExecResponse } from "../../generated/v2/CommandExecResponse";

/** Git C-quotes control characters even with core.quotePath=false. */
export function decodeGitPath(line: string): string {
  if (!line.startsWith('"')) return line;
  if (!line.endsWith('"')) throw new Error("Incomplete Git path");
  const bytes: number[] = [];
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
  };
  for (let i = 1; i < line.length - 1; i++) {
    if (line[i] !== "\\") {
      const char = String.fromCodePoint(line.codePointAt(i)!);
      bytes.push(...new TextEncoder().encode(char));
      i += char.length - 1;
    } else {
      const escaped = line[++i];
      if (escaped in escapes) bytes.push(escapes[escaped]);
      else if (/[0-7]/.test(escaped)) {
        const octal = line.slice(i).match(/^[0-7]{1,3}/)![0];
        bytes.push(parseInt(octal, 8));
        i += octal.length - 1;
      } else throw new Error("Invalid Git quoted path");
    }
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(bytes),
  );
}

/** Check listed entries only; do not recursively enumerate ignored directories. */
export async function readIgnoredPaths(
  client: Pick<CodexClient, "request">,
  cwd: string,
  paths: string[],
  current = () => true,
) {
  const ignored = new Set<string>();
  const unique = [...new Set(paths)];
  for (let offset = 0; offset < unique.length;) {
    if (!current()) return ignored;
    const batch: string[] = [];
    let bytes = 0;
    while (
      offset < unique.length &&
      batch.length < 128 &&
      (bytes < 16000 || !batch.length)
    ) {
      const path = unique[offset++];
      if (!path || path.includes("\0")) continue;
      batch.push(path);
      bytes += new TextEncoder().encode(path).length;
    }
    if (!batch.length) continue;
    const result = await client.request<CommandExecResponse>("command/exec", {
      command: [
        "git",
        "--no-optional-locks",
        "-c",
        "core.quotePath=false",
        "check-ignore",
        "--",
        ...batch,
      ],
      cwd,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      timeoutMs: 5000,
      disableOutputCap: true,
    });
    if (!current()) return ignored;
    if (result.exitCode !== 0 && result.exitCode !== 1)
      throw new Error("Git ignore status unavailable");
    if (result.stdout && !result.stdout.endsWith("\n"))
      throw new Error("Incomplete Git ignore output");
    for (const line of result.stdout.split("\n").filter(Boolean)) {
      const path = decodeGitPath(line);
      if (batch.includes(path)) ignored.add(path);
    }
  }
  return ignored;
}
