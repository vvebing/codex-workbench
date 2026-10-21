import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const LABEL = "com.codex-workbench";
const RUN_SCRIPT = "start";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ENTRY = path.join(ROOT, "dist", "server", "index.js");
const PLIST_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${LABEL}.plist`,
);
const LOG_DIR = path.join(ROOT, "logs");
const OUT_LOG = path.join(LOG_DIR, "start.out.log");
const ERR_LOG = path.join(LOG_DIR, "start.err.log");

const cmd = process.argv[2] || "help";

if (process.platform !== "darwin") {
  fail("daemon commands are only available on macOS.");
}

switch (cmd) {
  case "install":
    install();
    break;
  case "uninstall":
    uninstall();
    break;
  case "start":
    start();
    break;
  case "stop":
    stop(false);
    break;
  case "restart":
    install();
    break;
  case "status":
    status();
    break;
  case "logs":
    logs();
    break;
  case "help":
    usage();
    break;
  default:
    usage();
    fail(`Unknown command: ${cmd}`);
}

function install() {
  ensureProjectReady();
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(PLIST_PATH, buildPlist(), { encoding: "utf8", mode: 0o600 });

  stop(true);
  run("launchctl", ["bootstrap", domain(), PLIST_PATH]);
  run("launchctl", ["kickstart", "-kp", target()]);
  console.log(`Installed and started ${LABEL}`);
  console.log(`Command: npm run ${RUN_SCRIPT}`);
  console.log(`Plist:   ${PLIST_PATH}`);
  console.log(`Logs:    ${OUT_LOG}`);
}

function uninstall() {
  stop(true);
  if (fs.existsSync(PLIST_PATH)) fs.rmSync(PLIST_PATH);
  console.log(`Uninstalled ${LABEL}`);
}

function start() {
  ensureProjectReady();
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(PLIST_PATH)) {
    fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(PLIST_PATH, buildPlist(), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  const loaded = spawnSync("launchctl", ["print", target()], {
    encoding: "utf8",
  });
  if (loaded.status !== 0)
    run("launchctl", ["bootstrap", domain(), PLIST_PATH]);
  run("launchctl", ["kickstart", "-kp", target()]);
  console.log(`Started ${LABEL}`);
}

function stop(ignoreError) {
  const result = spawnSync("launchctl", ["bootout", target()], {
    encoding: "utf8",
  });
  if (result.status !== 0 && !ignoreError) {
    writeResult(result);
    process.exit(result.status || 1);
  }
  if (!ignoreError) console.log(`Stopped ${LABEL}`);
}

function status() {
  run("launchctl", ["print", target()]);
}

function logs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  for (const file of [OUT_LOG, ERR_LOG]) {
    if (!fs.existsSync(file)) fs.closeSync(fs.openSync(file, "a"));
  }
  const tail = spawn("tail", ["-n", "100", "-f", OUT_LOG, ERR_LOG], {
    stdio: "inherit",
  });
  tail.on("exit", (code) => process.exit(code || 0));
}

function ensureProjectReady() {
  for (const entry of [
    ENTRY,
    path.join(ROOT, "dist", "client", "index.html"),
  ]) {
    if (!fs.existsSync(entry)) {
      fail(`Missing ${entry}. Run npm run build before starting the daemon.`);
    }
  }
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    fail("Missing node_modules. Run npm ci before starting the daemon.");
  }
}

function buildPlist() {
  const pathEnv = uniquePath([
    path.dirname(process.execPath),
    ...(process.env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]);
  const port = process.env.PORT || "5180";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    fail("PORT must be between 1 and 65535.");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(ENTRY)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(ROOT)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PORT</key>
    <string>${xmlEscape(port)}</string>
    <key>PATH</key>
    <string>${xmlEscape(pathEnv)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(OUT_LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(ERR_LOG)}</string>
</dict>
</plist>
`;
}

function domain() {
  return `gui/${process.getuid()}`;
}

function target() {
  return `${domain()}/${LABEL}`;
}

function run(file, args) {
  const result = spawnSync(file, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function writeResult(result) {
  if (result.error) console.error(result.error.message);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function uniquePath(parts) {
  return [...new Set(parts.filter(Boolean))].join(":");
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.log(`Usage:
  npm run daemon -- <command>

Commands:
  install     Generate plist, install, and start npm run ${RUN_SCRIPT}
  uninstall   Stop and remove plist
  start       Start existing/generated service
  stop        Stop service
  restart     Regenerate plist and restart
  status      Show launchctl status
  logs        Tail stdout/stderr logs

Shortcut scripts are also available:
  npm run daemon:install
  npm run daemon:status
  npm run daemon:logs`);
}
