import { afterEach, describe, expect, it, vi } from "vitest";
import { stripVTControlCharacters } from "node:util";
import { ConnectionStore } from "../../src/features/connection/store";
import { TerminalStore } from "../../src/features/terminal/store";
import { readOnlyTerminalCommand } from "../../src/features/terminal/bootstrap";
import { shellActivityEnvironment } from "../../src/features/terminal/shell-activity";
import { DemoService, DemoSocket } from "../../src/demo/transport";
import { DEMO_ENDPOINT, DEMO_PROJECTS } from "../../src/demo/data";
import { parseDemoTerminalCommand } from "../../src/demo/terminal";
import type { CommandExecResponse } from "../../src/generated/v2/CommandExecResponse";
import type { FsReadFileResponse } from "../../src/generated/v2/FsReadFileResponse";

const disposers: (() => void)[] = [];
async function fixture(service = new DemoService(), cwd = DEMO_PROJECTS[0]) {
  const connection = new ConnectionStore({
    bridgeUrl: "ws://unused.invalid",
    webSocketFactory: () => new DemoSocket(service),
  });
  await connection.connect(DEMO_ENDPOINT);
  const store = new TerminalStore(connection, "demo-terminal-test", undefined);
  disposers.push(() => {
    connection.disconnect();
    store.dispose();
  });
  let settled = false;
  const running = store.create(cwd).then(() => {
    settled = true;
  });
  await vi.waitFor(() =>
    expect(store.getSnapshot().sessions[0]?.activity).toBe("idle"),
  );
  const id = store.getSnapshot().sessions[0].id;
  const session = () =>
    store.getSnapshot().sessions.find((session) => session.id === id)!;
  const query = async (command: string) => {
    const start = session().output.length;
    await store.write(id, command + "\r");
    await vi.waitFor(() => expect(session().activity).toBe("idle"));
    const output = stripVTControlCharacters(session().output.slice(start));
    return output
      .slice(output.indexOf("\r\n") + 2)
      .replace(/(^|\r\n)\/[^\r\n]* \$ $/, "$1");
  };
  return {
    service,
    connection,
    store,
    id,
    running,
    session,
    query,
    settled: () => settled,
  };
}
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

describe("simulated terminal through production RPC and terminal stores", () => {
  it("colors prompts, directories, matches, diffs and errors without adding color bytes to pipelines", async () => {
    const f = await fixture();
    expect(f.session().output).toContain(
      `\u001b[32m${DEMO_PROJECTS[0]}\u001b[0m $ `,
    );
    const listing = await f.query("ls");
    expect(f.session().output).toContain("\u001b[34mdocs\u001b[0m");
    const byteCount = new TextEncoder().encode(
      listing.replaceAll("\r\n", "\n"),
    ).length;
    expect((await f.query("ls | wc -c")).trim()).toBe(String(byteCount));
    await f.query("rg -n projects src");
    expect(f.session().output).toContain("\u001b[32mprojects\u001b[0m");
    await f.query("git diff");
    expect(f.session().output).toContain("\u001b[32m+");
    expect(f.session().output).toContain("\u001b[31m-");
    await f.query("touch denied.txt");
    expect(f.session().output).toContain("\u001b[31m只读演示终端");
  });
  it("keeps the simulated terminal plain when NO_COLOR is present with an empty value", async () => {
    const f = await fixture();
    const output: string[] = [];
    const off = f.connection.client.onNotification((message) => {
      if (
        message.method === "command/exec/outputDelta" &&
        message.params.processId === "plain-demo"
      )
        output.push(
          Buffer.from(message.params.deltaBase64, "base64").toString(),
        );
    });
    const running = f.connection.client.request<CommandExecResponse>(
      "command/exec",
      {
        command: readOnlyTerminalCommand(),
        cwd: DEMO_PROJECTS[0],
        tty: true,
        processId: "plain-demo",
        disableTimeout: true,
        streamStdoutStderr: true,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        env: { ...shellActivityEnvironment("plain-demo-token"), NO_COLOR: "" },
      },
    );
    await f.connection.client.request("command/exec/write", {
      processId: "plain-demo",
      deltaBase64: btoa(
        "ls\rrg -n projects src\rgit diff\rtouch denied.txt\rexit\r",
      ),
    });
    await running;
    off();
    expect(output.join("")).not.toContain("\u001b[");
    expect(stripVTControlCharacters(output.join(""))).toContain("只读演示终端");
  });
  it("holds exec until actual simulated exit, echoes editable input, resizes and closes", async () => {
    const f = await fixture();
    expect(f.settled()).toBe(false);
    expect(f.session().output).toContain("模拟只读终端");
    expect(
      stripVTControlCharacters(f.session().output).endsWith(
        `${DEMO_PROJECTS[0]} $ `,
      ),
    ).toBe(true);
    expect(f.session().output).not.toContain("]777;codex-workbench;");
    const start = f.session().output.length;
    for (const text of ["p", "w", "x", "\u007f", "d", "\r"])
      await f.store.write(f.id, text);
    expect(f.session().output.slice(start)).toContain(DEMO_PROJECTS[0]);
    await f.store.resize(f.id, { rows: 40, cols: 120 });
    await f.store.write(f.id, "exit\r");
    await f.running;
    expect(f.settled()).toBe(true);
    expect(f.session()).toMatchObject({ status: "exited", exitCode: 0 });
  });
  it("navigates shared virtual directories, reads quoted Chinese paths, finds files and processes text pipelines", async () => {
    const f = await fixture();
    expect(await f.query("pwd")).toBe(DEMO_PROJECTS[0] + "\r\n");
    expect(await f.query("ls")).toContain("docs");
    await f.query("cd docs");
    expect(
      stripVTControlCharacters(f.session().output).endsWith(
        `${DEMO_PROJECTS[0]}/docs $ `,
      ),
    ).toBe(true);
    expect(await f.query("pwd")).toContain("/docs");
    const content = await f.query('cat "示例 说明.md"');
    expect(content).not.toContain("找不到");
    expect(content).toContain("#");
    await f.query("cd ..");
    expect(
      stripVTControlCharacters(f.session().output).endsWith(
        `${DEMO_PROJECTS[0]} $ `,
      ),
    ).toBe(true);
    expect(await f.query("find . -type f -name '*.md'")).toContain(
      "./docs/示例 说明.md",
    );
    expect(await f.query("cat README.md | head -n 1")).toContain("# atlas-web");
    expect(await f.query("cat logs/app.log | tail -n 1")).toBe(
      "[demo] Read-only terminal ready.\r\n",
    );
    expect(await f.query("grep ready logs/app.log | wc -l")).toBe("1\r\n");
    expect(await f.query("grep absent logs/app.log | wc -l")).toBe("0\r\n");
    expect(await f.query("rg -n projects src")).toContain(
      "src/ProjectList.tsx:",
    );
    expect(await f.query("rg --files docs")).toContain("docs/示例 说明.md");
    expect(await f.query("uname -s")).toContain("DemoBrowser");
    expect(await f.query("command -v git")).toContain("[demo] git");
    expect(await f.query("help")).toContain("tail -f");
  });
  it("streams only real virtual-file changes during tail -f, interrupts, then remains usable", async () => {
    const f = await fixture();
    await f.store.write(f.id, "tail -f logs/app.log\r");
    expect(f.session().activity).toBe("busy");
    expect(f.session().output).toContain("[demo] Read-only terminal ready.");
    const before = f.session().output;
    await f.connection.client.request("fs/writeFile", {
      path: `${DEMO_PROJECTS[0]}/logs/app.log`,
      dataBase64: btoa(
        "[demo] Read-only terminal ready.\n[demo] actual appended change\n",
      ),
    });
    await vi.waitFor(() =>
      expect(f.session().output).toContain("actual appended change"),
    );
    expect(f.session().output.length).toBeGreaterThan(before.length);
    await f.store.write(f.id, "\u0003");
    expect(f.session().activity).toBe("idle");
    const interrupted = f.session().output;
    await f.connection.client.request("fs/writeFile", {
      path: `${DEMO_PROJECTS[0]}/logs/app.log`,
      dataBase64: btoa("after interrupt\n"),
    });
    expect(f.session().output).toBe(interrupted);
    expect(await f.query("pwd")).toContain(DEMO_PROJECTS[0]);
    await f.store.close(f.id);
    await f.running;
    expect(f.store.getSnapshot().sessions).toEqual([]);
  });
  it("rejects writes, networking, unsupported programs and complex shell syntax without changing data", async () => {
    const f = await fixture();
    const read = () =>
      f.connection.client.request<FsReadFileResponse>("fs/readFile", {
        path: `${DEMO_PROJECTS[0]}/README.md`,
      });
    const original = (await read()).dataBase64;
    for (const command of [
      "touch created.txt",
      "echo changed > README.md",
      "git branch forbidden",
      "git add README.md",
      "curl https://example.invalid",
      "npm install",
    ])
      expect(await f.query(command)).toContain("不允许写入或联网");
    for (const command of [
      "echo first; pwd",
      "echo first && pwd",
      "echo $(pwd)",
      "echo `pwd`",
      "echo 'unfinished",
    ])
      expect(await f.query(command)).toContain("不支持此 Shell 语法");
    expect(await f.query("python --version")).toContain("尚未模拟此命令或参数");
    expect(await f.query("cat /etc/passwd")).toContain(
      "仅支持示例项目中的路径",
    );
    expect((await read()).dataBase64).toBe(original);
    await expect(
      f.connection.client.request("fs/readFile", {
        path: `${DEMO_PROJECTS[0]}/created.txt`,
      }),
    ).rejects.toThrow();
    expect(await f.query("git branch")).toBe("* demo/workbench\r\n");
    expect(await f.query("git status --short")).toContain(
      "src/ProjectList.tsx",
    );
    expect(await f.query("git diff")).toContain("diff --git");
    expect(await f.query("git log -1 --oneline")).toContain("1111111");
    expect(await f.query("git show HEAD:src/ProjectList.tsx")).toContain(
      "searchProjects",
    );
  });
  it("isolates sockets and cleans detached followers even though virtual files are shared", async () => {
    const service = new DemoService();
    const a = await fixture(service);
    const b = await fixture(service);
    await expect(
      b.connection.client.request("command/exec/write", {
        processId: a.id,
        deltaBase64: btoa("exit\r"),
      }),
    ).rejects.toThrow("会话不存在");
    await a.store.write(a.id, "tail -f logs/app.log\r");
    const beforeB = b.session().output;
    a.connection.disconnect();
    await a.running;
    await b.connection.client.request("fs/writeFile", {
      path: `${DEMO_PROJECTS[0]}/logs/app.log`,
      dataBase64: btoa("shared file changed after detach\n"),
    });
    expect(b.session().output).toBe(beforeB);
    expect(await b.query("cat logs/app.log")).toContain(
      "shared file changed after detach",
    );
    expect(a.session().status).toBe("unknown");
  });
  it("discards an overlong line through Enter without executing its tail suffix or announcing an early idle prompt", async () => {
    const f = await fixture();
    const activities: string[] = [];
    const off = f.store.subscribe(() => activities.push(f.session().activity));
    await f.store.write(f.id, "x".repeat(8193) + "tail -f logs/app.log\r");
    off();
    expect(f.session().activity).toBe("idle");
    expect(f.session().output).toContain("命令过长");
    expect(f.session().output).not.toContain(
      "[demo] Read-only terminal ready.",
    );
    expect(activities.lastIndexOf("busy")).toBeLessThan(
      activities.indexOf("idle"),
    );
    const before = f.session().output;
    await f.connection.client.request("fs/writeFile", {
      path: `${DEMO_PROJECTS[0]}/logs/app.log`,
      dataBase64: btoa("must not stream\n"),
    });
    expect(f.session().output).toBe(before);
    expect(await f.query("pwd")).toContain(DEMO_PROJECTS[0]);
    await f.store.write(f.id, "x".repeat(8193));
    await f.store.write(f.id, "\u0003");
    expect(await f.query("pwd")).toContain(DEMO_PROJECTS[0]);
  });
  it("keeps matching process IDs scoped to sockets and confirms termination only on that connection", async () => {
    const service = new DemoService();
    const a = await fixture(service);
    const b = await fixture(service);
    const outputA: string[] = [];
    const outputB: string[] = [];
    for (const [f, output] of [
      [a, outputA],
      [b, outputB],
    ] as const)
      f.connection.client.onNotification((message) => {
        if (
          message.method === "command/exec/outputDelta" &&
          message.params.processId === "same-process"
        )
          output.push(atob(message.params.deltaBase64));
      });
    const params = {
      command: readOnlyTerminalCommand(),
      cwd: DEMO_PROJECTS[0],
      tty: true,
      processId: "same-process",
      disableTimeout: true,
      streamStdoutStderr: true,
      sandboxPolicy: { type: "readOnly" as const, networkAccess: false },
      env: shellActivityEnvironment("socket-private-token"),
    };
    const runningA = a.connection.client.request<CommandExecResponse>(
      "command/exec",
      params,
    );
    const runningB = b.connection.client.request<CommandExecResponse>(
      "command/exec",
      { ...params, cwd: DEMO_PROJECTS[1] },
    );
    await a.connection.client.request("command/exec/write", {
      processId: "same-process",
      deltaBase64: btoa("echo socket-A\r"),
    });
    expect(outputA.join("")).toContain("socket-A");
    expect(outputB.join("")).not.toContain("socket-A");
    await a.connection.client.request("command/exec/terminate", {
      processId: "same-process",
    });
    expect((await runningA).exitCode).toBe(130);
    await b.connection.client.request("command/exec/write", {
      processId: "same-process",
      deltaBase64: btoa("echo socket-B\r"),
    });
    expect(outputB.join("")).toContain("socket-B");
    await b.connection.client.request("command/exec/terminate", {
      processId: "same-process",
    });
    expect((await runningB).exitCode).toBe(130);
  });
});

describe("demo terminal parser boundaries", () => {
  it("preserves quoted operators, empty strings, escaped spaces and Unicode without expansion", () => {
    expect(
      parseDemoTerminalCommand(
        "echo 'literal > | $ ;' \"中文 空格\" escaped\\ space '' | wc -c",
      ),
    ).toEqual([
      ["echo", "literal > | $ ;", "中文 空格", "escaped space", ""],
      ["wc", "-c"],
    ]);
  });
  it.each([
    "echo a || pwd",
    "echo a |",
    "| cat README.md",
    "echo $PATH",
    'echo "$(pwd)"',
    "echo 'unfinished",
    "echo trailing\\",
  ])("rejects unsupported syntax explicitly: %s", (command) => {
    expect(() => parseDemoTerminalCommand(command)).toThrow(
      "不支持此 Shell 语法",
    );
  });
});
