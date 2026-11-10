import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, writeFile, readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { ConnectionStore } from "../../src/features/connection/store";
import { TerminalStore } from "../../src/features/terminal/store";
import {
  READ_ONLY_TERMINAL_ENVIRONMENT,
  READ_ONLY_TERMINAL_POLICY,
  readOnlyTerminalCommand,
} from "../../src/features/terminal/bootstrap";
import { shellActivityEnvironment } from "../../src/features/terminal/shell-activity";
import type { CommandExecResponse } from "../../src/generated/v2/CommandExecResponse";
import type { SocketLike } from "../../src/lib/rpc";

// No inference or existing sessions: run only inside an isolated, ignored fixture.
await mkdir("output/terminal-smoke", { recursive: true });
const fixture = await mkdtemp(resolve("output/terminal-smoke/fixture-"));
execFileSync("git", [
  "init",
  "--quiet",
  "--initial-branch=main",
  "--template=",
  fixture,
]);
await writeFile(`${fixture}/README.md`, "Isolated terminal smoke fixture.\n");
execFileSync("git", ["add", "README.md"], { cwd: fixture });
execFileSync(
  "git",
  [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=Terminal Smoke",
    "-c",
    "user.email=smoke@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "readonly-fixture",
  ],
  { cwd: fixture },
);
const fixtureContent =
  "Isolated terminal smoke fixture.\nRead-only diff fixture.\n";
await writeFile(`${fixture}/README.md`, fixtureContent);
const textDirectory = "资料 with spaces";
const textFilename = "日志 sample.txt";
await mkdir(`${fixture}/${textDirectory}`);
await writeFile(
  `${fixture}/${textDirectory}/${textFilename}`,
  "first alpha\n中间 needle\nthird beta\nFOLLOW_SENTINEL_LAST\n",
);

function transport(): SocketLike {
  const child = spawn(
    "codex",
    [
      "app-server",
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      "sandbox_workspace_write.network_access=false",
      "-c",
      `sandbox_workspace_write.writable_roots=${JSON.stringify([fixture, `${fixture}/.git`])}`,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: undefined },
    },
  );
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const socket: SocketLike = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      const message = JSON.parse(data) as { type?: string };
      if (message.type === "connect")
        queueMicrotask(() =>
          socket.onmessage?.({
            data: JSON.stringify({ type: "bridge/ready" }),
          } as MessageEvent),
        );
      else child.stdin.write(`${data}\n`);
    },
    close() {
      socket.readyState = 3;
      lines.close();
      child.stdin.end();
      child.kill();
    },
  };
  child.once("error", () => socket.onerror?.(new Event("error")));
  child.once("exit", () => {
    if (socket.readyState !== 3)
      socket.onclose?.({ reason: "Smoke app-server exited" } as CloseEvent);
  });
  lines.on("line", (data) => socket.onmessage?.({ data } as MessageEvent));
  queueMicrotask(() => {
    socket.readyState = 1;
    socket.onopen?.(new Event("open"));
  });
  return socket;
}

const connection = new ConnectionStore({
  bridgeUrl: "stdio-terminal-smoke",
  webSocketFactory: transport,
  requestTimeoutMs: 10000,
});
const store = new TerminalStore(connection, "isolated-terminal-smoke");
async function until(check: () => boolean, label: string) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 20000) {
      console.error(
        store
          .getSnapshot()
          .sessions.map(({ status, activity, background, output }) => ({
            status,
            activity,
            background,
            output: output.slice(-800),
          })),
      );
      throw new Error(`Terminal smoke timed out: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
try {
  await connection.connect("ws://127.0.0.1:1");
  const running = store.create(fixture);
  await until(
    () => store.getSnapshot().sessions[0]?.status === "running",
    "PTY startup",
  );
  const id = store.getSnapshot().sessions[0].id;
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "confirmed idle prompt",
  );
  await until(
    () =>
      stripVTControlCharacters(store.getSnapshot().sessions[0].output).endsWith(
        `${fixture} $ `,
      ),
    "initial full directory prompt",
  );
  assert(
    store
      .getSnapshot()
      .sessions[0].output.endsWith(`\u001b[32m${fixture}\u001b[0m $ `),
    "only the current path should be green, followed by a reset before command input",
  );
  assert(
    !store.getSnapshot().sessions[0].output.includes("\\["),
    "Bash width markers must not be printed literally",
  );
  await store.write(id, "printf 'QUEUE_%s\\n' FIRST\nsleep 1\n");
  await until(
    () => store.getSnapshot().sessions[0].output.includes("QUEUE_FIRST"),
    "first queued command completed",
  );
  assert.notEqual(
    store.getSnapshot().sessions[0].activity,
    "idle",
    "an intermediate prompt must not mark queued work idle",
  );
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "all pasted commands completed",
  );
  await Promise.all([
    store.write(id, "printf 'RAPID_%s\\n' FIRST\r"),
    store.write(id, "sleep 1\r"),
  ]);
  await until(
    () => store.getSnapshot().sessions[0].output.includes("RAPID_FIRST"),
    "first rapid submission completed",
  );
  assert.notEqual(
    store.getSnapshot().sessions[0].activity,
    "idle",
    "rapid submissions must remain protected until the final prompt",
  );
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "all rapid submissions completed",
  );
  await store.write(id, "sleep 1\r");
  await until(
    () => store.getSnapshot().sessions[0].activity === "busy",
    "foreground activity",
  );
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "foreground completion",
  );
  await store.write(id, "sleep 1 &\r");
  await until(
    () => store.getSnapshot().sessions[0].background === true,
    "background activity",
  );
  await store.write(id, "wait\r");
  await until(
    () =>
      store.getSnapshot().sessions[0].activity === "idle" &&
      !store.getSnapshot().sessions[0].background,
    "background completion after wait",
  );
  await store.write(id, "printf 'FG_%s\\n' STARTED; sleep 30\r");
  await until(
    () => store.getSnapshot().sessions[0].output.includes("FG_STARTED"),
    "foreground process started before interrupt",
  );
  await until(
    () => store.getSnapshot().sessions[0].activity === "busy",
    "interrupt activity",
  );
  await store.write(id, "\x03");
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "interrupt returns to prompt",
  );
  assert(
    !store.getSnapshot().sessions[0].output.includes("]777;codex-workbench;"),
  );
  await store.resize(id, { rows: 30, cols: 100 });
  await store.write(id, "stty size; printf 'PTY_%s\\n' READY\r");
  await until(
    () => store.getSnapshot().sessions[0].output.includes("PTY_READY"),
    "PTY input/output",
  );
  assert(store.getSnapshot().sessions[0].output.includes("30 100"));
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "PTY query returned to prompt",
  );
  await store.write(id, "printf 'EDIT_%s\\n' WRONG");
  await store.write(id, "\u007f\u007f\u007f\u007f\u007fOK\r");
  await until(
    () => store.getSnapshot().sessions[0].output.includes("EDIT_OK"),
    "readline editing with a colored directory prompt",
  );
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "edited command completed",
  );
  assert(
    !store.getSnapshot().sessions[0].output.includes("\u001b[32mEDIT_OK"),
    "ordinary command output must not inherit the prompt color",
  );
  async function query(
    command: string,
    label: string,
  ): Promise<{ code: number; output: string }> {
    const start = store.getSnapshot().sessions[0].output.length;
    await store.write(
      id,
      `${command}; codex_workbench_smoke_status=$?; printf 'CHECK_%s_%s\\n' ${label} "$codex_workbench_smoke_status"\r`,
    );
    const expression = new RegExp(`CHECK_${label}_(\\d+)`);
    await until(
      () =>
        expression.test(store.getSnapshot().sessions[0].output.slice(start)),
      label,
    );
    await until(
      () => store.getSnapshot().sessions[0].activity === "idle",
      `${label} prompt`,
    );
    await until(
      () => store.getSnapshot().sessions[0].output.endsWith(" $ "),
      `${label} directory prompt`,
    );
    const output = store.getSnapshot().sessions[0].output.slice(start);
    return { code: Number(output.match(expression)![1]), output };
  }
  const pwd = await query("pwd", "PWD");
  assert.equal(pwd.code, 0);
  assert(pwd.output.includes(fixture));
  const listing = await query("ls -1", "LIST");
  assert.equal(listing.code, 0);
  assert(listing.output.includes(textDirectory));
  const navigation = await query(
    `cd '${textDirectory}' && pwd && cat '${textFilename}' && cd .. && pwd`,
    "NAVIGATION",
  );
  assert.equal(navigation.code, 0);
  assert(navigation.output.includes(`${fixture}/${textDirectory}`));
  assert(navigation.output.includes("first alpha"));
  const changedDirectory = await query(
    `cd '${textDirectory}'`,
    "CHANGE_DIRECTORY_PROMPT",
  );
  assert.equal(changedDirectory.code, 0);
  assert(
    stripVTControlCharacters(changedDirectory.output).endsWith(
      `${fixture}/${textDirectory} $ `,
    ),
  );
  assert(
    changedDirectory.output.endsWith(
      `\u001b[32m${fixture}/${textDirectory}\u001b[0m $ `,
    ),
  );
  const backToRoot = await query("cd ..", "ROOT_DIRECTORY_PROMPT");
  assert.equal(backToRoot.code, 0);
  assert(stripVTControlCharacters(backToRoot.output).endsWith(`${fixture} $ `));
  const returned = await query("pwd", "RETURNED_TO_ROOT");
  assert.equal(returned.code, 0);
  assert(returned.output.includes(fixture));
  const found = await query(`find . -type f -name '${textFilename}'`, "FIND");
  assert.equal(found.code, 0);
  assert(found.output.includes(`./${textDirectory}/${textFilename}`));
  const textPath = `'${textDirectory}/${textFilename}'`;
  const head = await query(`head -n 1 ${textPath}`, "HEAD");
  assert.equal(head.code, 0);
  assert(head.output.includes("first alpha"));
  const tail = await query(`tail -n 1 ${textPath}`, "TAIL");
  assert.equal(tail.code, 0);
  assert(tail.output.includes("FOLLOW_SENTINEL_LAST"));
  const grep = await query(`grep needle ${textPath}`, "GREP");
  assert.equal(grep.code, 0);
  assert(grep.output.includes("中间 needle"));
  const count = await query(`grep needle ${textPath} | wc -l`, "PIPELINE");
  assert.equal(count.code, 0);
  assert(/\r?\n\s*1\r?\n/.test(stripVTControlCharacters(count.output)));
  const platform = await query("uname -s", "PLATFORM");
  assert.equal(platform.code, 0);
  assert(
    platform.output.includes(
      process.platform === "darwin" ? "Darwin" : "Linux",
    ),
  );
  const tools = await query("command -v sh && command -v git", "TOOLS");
  assert.equal(tools.code, 0);
  assert(/\/[^\r\n]*\/sh\r?\n/.test(stripVTControlCharacters(tools.output)));
  assert(/\/[^\r\n]*\/git\r?\n/.test(stripVTControlCharacters(tools.output)));
  const rgAvailable = (await query("command -v rg", "RG_AVAILABLE")).code === 0;
  if (rgAvailable) {
    const rg = await query(
      `rg --no-config --color never -n needle ${textPath}`,
      "RG",
    );
    assert.equal(rg.code, 0);
    assert(rg.output.includes("2:中间 needle"));
  }
  const followStart = store.getSnapshot().sessions[0].output.length;
  await store.write(id, `tail -f ${textPath}\r`);
  await until(
    () =>
      store
        .getSnapshot()
        .sessions[0].output.slice(followStart)
        .includes("FOLLOW_SENTINEL_LAST"),
    "tail -f delivered actual fixture content",
  );
  assert.equal(store.getSnapshot().sessions[0].activity, "busy");
  await store.write(id, "\x03");
  await until(
    () => store.getSnapshot().sessions[0].activity === "idle",
    "tail -f interrupt returned to prompt",
  );
  const afterFollow = await query(`head -n 1 ${textPath}`, "AFTER_FOLLOW");
  assert.equal(afterFollow.code, 0);
  assert(afterFollow.output.includes("first alpha"));
  const branch = await query("git branch", "BRANCH");
  assert.equal(branch.code, 0);
  assert(branch.output.includes("main"));
  const status = await query("git status --short", "STATUS");
  assert.equal(status.code, 0);
  assert(status.output.includes("README.md"));
  const log = await query("git log -1 --oneline", "LOG");
  assert.equal(log.code, 0);
  assert(log.output.includes("readonly-fixture"));
  const diff = await query("git diff", "DIFF");
  assert.equal(diff.code, 0);
  assert(
    stripVTControlCharacters(diff.output).includes("+Read-only diff fixture."),
  );
  const content = await query("cat README.md", "READ");
  assert.equal(content.code, 0);
  assert(content.output.includes("Read-only diff fixture."));
  for (const [command, label] of [
    ["touch readonly-probe", "TOUCH"],
    ["printf denied > README.md", "REDIRECT"],
    ["printf denied >> README.md", "APPEND"],
    ["git branch forbidden-write", "GITWRITE"],
  ]) {
    const denied = await query(command, label);
    assert.notEqual(denied.code, 0, `${label} must fail in read-only sandbox`);
    assert(
      /Operation not permitted|Permission denied|Read-only file system/i.test(
        denied.output,
      ),
      `${label} must retain the actual permission error`,
    );
  }
  assert.equal((await query("git branch", "AFTER_DENIED")).code, 0);
  assert.equal((await query("cat README.md", "READ_AFTER_DENIED")).code, 0);
  assert.equal(await readFile(`${fixture}/README.md`, "utf8"), fixtureContent);
  await assert.rejects(access(`${fixture}/readonly-probe`));
  assert(
    !execFileSync("git", ["branch"], {
      cwd: fixture,
      encoding: "utf8",
    }).includes("forbidden-write"),
  );
  assert(
    !/confstr\(\)|xcrun_db/.test(store.getSnapshot().sessions[0].output),
    "the terminal should invoke real Git without Apple shim cache warnings",
  );
  await store.write(id, "exit\r");
  await running;
  assert.equal(store.getSnapshot().sessions[0].exitCode, 0);
  // NO_COLOR's presence disables prompt color even when its value is empty.
  const plainId = crypto.randomUUID();
  let plainOutput = "";
  const offPlain = connection.client.onNotification((message) => {
    if (
      message.method === "command/exec/outputDelta" &&
      message.params.processId === plainId
    )
      plainOutput += new TextDecoder().decode(
        Uint8Array.from(atob(message.params.deltaBase64), (character) =>
          character.charCodeAt(0),
        ),
      );
  });
  try {
    const plain = connection.client.request<CommandExecResponse>(
      "command/exec",
      {
        command: readOnlyTerminalCommand(),
        cwd: fixture,
        processId: plainId,
        tty: true,
        disableTimeout: true,
        disableOutputCap: true,
        sandboxPolicy: READ_ONLY_TERMINAL_POLICY,
        env: {
          ...READ_ONLY_TERMINAL_ENVIRONMENT,
          ...shellActivityEnvironment(crypto.randomUUID()),
          NO_COLOR: "",
          CLICOLOR: "1",
          CLICOLOR_FORCE: "1",
        },
      },
    );
    await until(
      () => plainOutput.endsWith(`${fixture} $ `),
      "NO_COLOR empty-value plain prompt",
    );
    assert(!plainOutput.includes("\u001b[32m"));
    assert(!plainOutput.includes("\\["));
    const listStart = plainOutput.length;
    await connection.client.request("command/exec/write", {
      processId: plainId,
      deltaBase64: Buffer.from(
        `/bin/ls -d '${textDirectory}'; printf 'NO_COLOR_%s\\n' LIST_DONE\r`,
        "utf8",
      ).toString("base64"),
    });
    await until(
      () => plainOutput.slice(listStart).includes("NO_COLOR_LIST_DONE"),
      "NO_COLOR directory listing completed",
    );
    await until(
      () => plainOutput.endsWith(`${fixture} $ `),
      "NO_COLOR directory listing prompt",
    );
    assert(
      !plainOutput
        .slice(listStart)
        .split("\u001b")
        .some((fragment) => /^\[[0-9;]*m/.test(fragment)),
      "NO_COLOR must also remove BSD ls color variables, not merely paint a plain prompt",
    );
    await connection.client.request("command/exec/write", {
      processId: plainId,
      deltaBase64: btoa("exit\r"),
    });
    assert.equal((await plain).exitCode, 0);
  } finally {
    offPlain();
  }
  const closing = store.create(fixture);
  const closingId = store.getSnapshot().sessions.at(-1)!.id;
  await until(
    () =>
      store.getSnapshot().sessions.find((session) => session.id === closingId)
        ?.activity === "idle",
    "close fixture prompt",
  );
  await store.write(closingId, "sleep 30\r");
  await until(
    () =>
      store.getSnapshot().sessions.find((session) => session.id === closingId)
        ?.activity === "busy",
    "close fixture busy",
  );
  await store.close(closingId);
  await closing;
  assert(
    !store.getSnapshot().sessions.some((session) => session.id === closingId),
  );
  const result = {
    cliVersion: execFileSync("codex", ["--version"], {
      encoding: "utf8",
    }).trim(),
    pty: true,
    resize: true,
    explicitReadOnlyOfflinePolicy: true,
    gitBranchStatusLogDiff: true,
    fileRead: true,
    directoryListingAndNavigation: true,
    spacesAndChinesePaths: true,
    currentDirectoryPromptAfterCd: true,
    greenPathResetAndReadlineEditing: true,
    noColorPresenceRespected: true,
    noColorDisablesDirectoryListingColors: true,
    fileDiscovery: true,
    textHeadTailGrepWcPipeline: true,
    basicEnvironmentQueries: true,
    tailFollowInterruptAndContinue: true,
    optionalTools: { rg: { available: rgAvailable, verified: rgAvailable } },
    projectAndGitWritesDenied: true,
    queryAfterWriteDenied: true,
    noAppleGitShimCacheWarnings: true,
    cleanExit: true,
    idleForegroundBackgroundAndInterruptStates: true,
    closeAfterConfirmedExit: true,
    multilineAndRapidSubmissionActivity: true,
    noInference: true,
    limitation:
      "The server defaults to workspace-write, while every terminal requests readOnly with network disabled. Validates POSIX tools plus rg only when available; does not require or validate node/python/jq, SSH, network access, or other operating systems.",
  };
  await writeFile(
    "output/terminal-smoke/result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  connection.disconnect();
  store.dispose();
}
