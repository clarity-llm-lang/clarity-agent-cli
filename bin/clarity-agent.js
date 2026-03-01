#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, "../dist");

const commandLaunchers = {
  "runtime-chat": "runtime-chat.cjs",
  "runtime-agents": "runtime-agents.cjs",
  connect: "connect.cjs",
  answer: "answer.cjs"
};

const unsupported = new Set(["watch", "list", "cancel", "serve"]);

function usage() {
  process.stdout.write("Clarity Agent CLI (native Clarity commands)\n\n");
  process.stdout.write("Usage:\n");
  process.stdout.write(
    "  clarity-agent runtime-chat [runtime-url] [service-id] [--agent <agent-id>] [--run-id <run-id>] [--token <secret>] [--poll-ms <ms>] [--events-limit <n>] [--no-stream]\n"
  );
  process.stdout.write("  clarity-agent runtime-agents [runtime-url] [--token <secret>]\n");
  process.stdout.write(
    "  clarity-agent connect [broker-url] [--token <secret>] [--poll-ms <ms>] [--timeout <secs>] [--auto-approve]\n"
  );
  process.stdout.write("  clarity-agent answer <key> <response> [--dir <path>]\n");
  process.stdout.write("\n");
  process.stdout.write("Temporarily unsupported in native Clarity: watch, list, cancel, serve\n");
}

function unsupportedMessage(cmd) {
  process.stdout.write(`Command not yet available in native Clarity: ${cmd}\n`);
  process.stdout.write("Tracked requirements:\n");
  process.stdout.write("  - RQ-LANG-CLI-FS-001 (directory listing / file existence / remove)\n");
  process.stdout.write("  - RQ-LANG-CLI-FS-002 (mkdir and path utilities)\n");
  process.stdout.write("  - RQ-LANG-CLI-NET-001 (http_listen runtime implementation)\n");
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";

if (cmd.length === 0 || cmd === "--help" || cmd === "-h") {
  usage();
  process.exit(0);
}

if (unsupported.has(cmd)) {
  unsupportedMessage(cmd);
  process.exit(2);
}

const launcher = commandLaunchers[cmd];
if (!launcher) {
  process.stderr.write(`Unknown command: ${cmd}\n`);
  usage();
  process.exit(1);
}

const target = path.join(distDir, launcher);
if (!existsSync(target)) {
  process.stderr.write(
    `Missing launcher artifact: ${target}\nRun 'npm run build' before using the CLI.\n`
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [target, ...argv.slice(1)], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
