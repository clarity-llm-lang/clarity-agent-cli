#!/usr/bin/env node

import { Command } from "commander";
import {
  answerQuestion,
  cancelQuestion,
  listQuestions,
  resolveHitlDir
} from "../pkg/hitl/broker.js";
import { runWatch } from "../pkg/hitl/watch.js";
import { createHitlServer } from "../pkg/http/server.js";
import { answerRemoteQuestion, listRemoteQuestions } from "../pkg/http/client.js";
import {
  listRuntimeAgents,
  type RuntimeAgentRegistryItem
} from "../pkg/runtime/client.js";
import { runRuntimeChatViaClarity } from "../pkg/runtime/clarity-runtime-chat.js";
import { promptLine } from "../pkg/tty/prompt.js";

interface SharedDirOptions {
  dir?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function selectDir(
  positionalDir: string | undefined,
  flagDir: string | undefined
): string | undefined {
  if (typeof flagDir === "string" && flagDir.trim().length > 0) {
    return flagDir.trim();
  }
  if (typeof positionalDir === "string" && positionalDir.trim().length > 0) {
    return positionalDir.trim();
  }
  return undefined;
}

function brokerOptionsFromDir(dir?: string): { env: NodeJS.ProcessEnv; cwd: string } {
  if (!dir) {
    return {
      env: process.env,
      cwd: process.cwd()
    };
  }
  return {
    env: {
      ...process.env,
      CLARITY_HITL_DIR: dir
    },
    cwd: process.cwd()
  };
}

function ageLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function printPending(
  questions: Array<{ key: string; ageSeconds: number; question: string }>
): void {
  if (questions.length === 0) {
    process.stdout.write("No pending questions.\n");
    return;
  }

  const keyWidth = Math.max("key".length, ...questions.map((row) => row.key.length));
  const ageWidth = Math.max(
    "age".length,
    ...questions.map((row) => ageLabel(row.ageSeconds).length)
  );

  process.stdout.write(
    `${"key".padEnd(keyWidth)}  ${"age".padEnd(ageWidth)}  question\n${"-".repeat(keyWidth)}  ${"-".repeat(ageWidth)}  ${"-".repeat(36)}\n`
  );

  for (const row of questions) {
    const line = row.question.replace(/\s+/g, " ").slice(0, 96);
    process.stdout.write(
      `${row.key.padEnd(keyWidth)}  ${ageLabel(row.ageSeconds).padEnd(ageWidth)}  ${line}\n`
    );
  }
}

function renderRemotePrompt(question: {
  key: string;
  question: string;
  ageSeconds?: number;
}): string {
  const header = `Remote HITL request: ${question.key}`;
  const lines = question.question.split(/\r?\n/);
  const width = Math.max(header.length + 2, ...lines.map((line) => line.length + 2), 40);
  const border = "=".repeat(width);
  const out: string[] = [];
  out.push(`+${border}+`);
  out.push(`| ${header.padEnd(width - 1, " ")}|`);
  out.push(`+${border}+`);
  for (const line of lines) {
    out.push(`| ${line.slice(0, width - 1).padEnd(width - 1, " ")}|`);
  }
  out.push(`+${border}+`);
  if (typeof question.ageSeconds === "number") {
    out.push(`Age: ${ageLabel(question.ageSeconds)}`);
  }
  return out.join("\n");
}

function printRuntimeAgents(items: RuntimeAgentRegistryItem[]): void {
  if (items.length === 0) {
    process.stdout.write("No registered agent services found.\n");
    return;
  }

  const rows = items.map((item) => ({
    serviceId: item.serviceId,
    agentId: item.agent.agentId || "-",
    name: item.agent.name || item.displayName || "-",
    triggers: item.agent.triggers.join(",") || "-",
    lifecycle: item.lifecycle,
    health: item.health
  }));

  const serviceIdWidth = Math.max("service_id".length, ...rows.map((row) => row.serviceId.length));
  const agentIdWidth = Math.max("agent_id".length, ...rows.map((row) => row.agentId.length));
  const nameWidth = Math.max("name".length, ...rows.map((row) => row.name.length));
  const triggerWidth = Math.max("triggers".length, ...rows.map((row) => row.triggers.length));
  const lifecycleWidth = Math.max("lifecycle".length, ...rows.map((row) => row.lifecycle.length));
  const healthWidth = Math.max("health".length, ...rows.map((row) => row.health.length));

  process.stdout.write(
    `${"service_id".padEnd(serviceIdWidth)}  ${"agent_id".padEnd(agentIdWidth)}  ${"name".padEnd(nameWidth)}  ${"triggers".padEnd(triggerWidth)}  ${"lifecycle".padEnd(lifecycleWidth)}  ${"health".padEnd(healthWidth)}\n`
  );
  process.stdout.write(
    `${"-".repeat(serviceIdWidth)}  ${"-".repeat(agentIdWidth)}  ${"-".repeat(nameWidth)}  ${"-".repeat(triggerWidth)}  ${"-".repeat(lifecycleWidth)}  ${"-".repeat(healthWidth)}\n`
  );
  for (const row of rows) {
    process.stdout.write(
      `${row.serviceId.padEnd(serviceIdWidth)}  ${row.agentId.padEnd(agentIdWidth)}  ${row.name.padEnd(nameWidth)}  ${row.triggers.padEnd(triggerWidth)}  ${row.lifecycle.padEnd(lifecycleWidth)}  ${row.health.padEnd(healthWidth)}\n`
    );
  }
}

const program = new Command();

program
  .name("clarity-agent")
  .description("Clarity operator CLI for HITL broker and runtime-agent chat workflows")
  .version("0.1.0");

program
  .command("watch")
  .argument("[dir]", "Handshake directory (default from CLARITY_HITL_DIR or .clarity-hitl)")
  .option("--dir <path>", "Override handshake directory")
  .option("--timeout <secs>", "Skip questions older than N seconds", (value) =>
    Number.parseInt(value, 10)
  )
  .option("--auto-approve", "Auto-write empty responses")
  .option("--log <file>", "Append JSONL audit log")
  .option("--poll-ms <ms>", "Polling interval", (value) => Number.parseInt(value, 10), 1000)
  .action(
    async (
      dirArg: string | undefined,
      opts: SharedDirOptions & {
        timeout?: number;
        autoApprove?: boolean;
        log?: string;
        pollMs?: number;
      }
    ) => {
      const dir = selectDir(dirArg, opts.dir);
      await runWatch({
        dir,
        timeoutSeconds:
          typeof opts.timeout === "number" && Number.isFinite(opts.timeout)
            ? opts.timeout
            : undefined,
        autoApprove: Boolean(opts.autoApprove),
        logFile: opts.log,
        pollMs: opts.pollMs
      });
    }
  );

program
  .command("list")
  .argument("[dir]", "Handshake directory (default from CLARITY_HITL_DIR or .clarity-hitl)")
  .option("--dir <path>", "Override handshake directory")
  .action(async (dirArg: string | undefined, opts: SharedDirOptions) => {
    const dir = selectDir(dirArg, opts.dir);
    const brokerOptions = brokerOptionsFromDir(dir);
    const hitlDir = resolveHitlDir(brokerOptions);
    const pending = (await listQuestions(brokerOptions)).filter((item) => !item.answered);
    process.stdout.write(`Handshake directory: ${hitlDir}\n`);
    printPending(pending);
  });

program
  .command("answer")
  .argument("<key>", "Question key")
  .argument("<response>", "Response text")
  .option("--dir <path>", "Override handshake directory")
  .action(async (key: string, response: string, opts: SharedDirOptions) => {
    const brokerOptions = brokerOptionsFromDir(opts.dir);
    const out = await answerQuestion(key, response, brokerOptions);
    process.stdout.write(`Wrote answer: ${out.path}\n`);
  });

program
  .command("cancel")
  .argument("<key>", "Question key")
  .option("--dir <path>", "Override handshake directory")
  .action(async (key: string, opts: SharedDirOptions) => {
    const brokerOptions = brokerOptionsFromDir(opts.dir);
    const out = await cancelQuestion(key, brokerOptions);
    process.stdout.write(out.removed ? `Cancelled: ${key}\n` : `No question found: ${key}\n`);
  });

program
  .command("serve")
  .description("Serve HTTP broker endpoints and embedded UI")
  .option("--dir <path>", "Override handshake directory")
  .option("--port <port>", "HTTP port", (value) => Number.parseInt(value, 10), 7842)
  .option("--token <secret>", "Optional bearer token for API access")
  .action(async (opts: SharedDirOptions & { port: number; token?: string }) => {
    const server = createHitlServer({
      dir: opts.dir,
      token: opts.token
    });

    const port = Number.isFinite(opts.port) && opts.port > 0 ? opts.port : 7842;

    await new Promise<void>((resolve) => {
      server.listen(port, "0.0.0.0", () => {
        resolve();
      });
    });

    const address = server.address();
    const shownPort = typeof address === "object" && address ? address.port : port;
    process.stdout.write(`Broker server running on http://localhost:${shownPort}\n`);
    if (opts.token) {
      process.stdout.write(
        "Token auth enabled. Use Authorization: Bearer <token> or x-clarity-token.\n"
      );
    }
  });

program
  .command("connect")
  .description("Connect to a remote broker and answer questions interactively")
  .argument("<brokerUrl>", "Broker base URL")
  .option("--token <secret>", "Optional bearer token")
  .option("--poll-ms <ms>", "Polling interval", (value) => Number.parseInt(value, 10), 1200)
  .option("--timeout <secs>", "Skip remote questions older than N seconds", (value) =>
    Number.parseInt(value, 10)
  )
  .option("--auto-approve", "Auto-write empty responses")
  .action(
    async (
      brokerUrl: string,
      opts: { token?: string; pollMs?: number; timeout?: number; autoApprove?: boolean }
    ) => {
      const pollMs = Math.max(300, opts.pollMs ?? 1200);
      const timeoutSeconds =
        typeof opts.timeout === "number" && Number.isFinite(opts.timeout) ? opts.timeout : null;
      const seen = new Set<string>();

      process.stdout.write(`Connecting to broker: ${brokerUrl}\n`);

      while (true) {
        try {
          const pending = await listRemoteQuestions(brokerUrl, opts.token);

          for (const question of pending) {
            const marker = `${question.key}:${question.timestamp}`;
            if (seen.has(marker)) {
              continue;
            }

            if (
              timeoutSeconds !== null &&
              typeof question.ageSeconds === "number" &&
              question.ageSeconds > timeoutSeconds
            ) {
              seen.add(marker);
              process.stdout.write(
                `[${new Date().toISOString()}] skipped ${question.key} (age ${question.ageSeconds}s > ${timeoutSeconds}s)\n`
              );
              continue;
            }

            process.stdout.write(`\n${renderRemotePrompt(question)}\n`);

            let response = "";
            if (!opts.autoApprove) {
              response = await promptLine("Remote answer (Enter to confirm): ");
            } else {
              process.stdout.write("Auto-approve enabled: submitting empty response.\n");
            }

            await answerRemoteQuestion(brokerUrl, question.key, response, opts.token);
            seen.add(marker);
            process.stdout.write(`[${new Date().toISOString()}] answered ${question.key}\n`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(`[${new Date().toISOString()}] connect error: ${message}\n`);
        }

        await sleep(pollMs);
      }
    }
  );

program
  .command("runtime-agents")
  .description("List available agent services from a Clarity Runtime")
  .argument("<runtimeUrl>", "Runtime base URL")
  .option("--token <secret>", "Optional bearer token")
  .action(async (runtimeUrl: string, opts: { token?: string }) => {
    process.stdout.write(`Runtime: ${runtimeUrl}\n`);
    const items = await listRuntimeAgents(runtimeUrl, opts.token);
    printRuntimeAgents(items);
  });

program
  .command("runtime-chat")
  .description("Connect to runtime, select an agent, and chat in one flow (native Clarity)")
  .argument("[runtimeUrl]", "Runtime base URL (prompted when omitted)")
  .argument(
    "[serviceId]",
    "Agent service id or list number (optional; prompts with numbered selection when omitted)"
  )
  .option("--agent <agentId>", "Override agent id (defaults to registry value)")
  .option("--run-id <runId>", "Attach to an existing run instead of creating one")
  .option("--token <secret>", "Optional bearer token")
  .option("--poll-ms <ms>", "Polling interval", (value) => Number.parseInt(value, 10), 1200)
  .option(
    "--events-limit <n>",
    "Max run events fetched per poll",
    (value) => Number.parseInt(value, 10),
    200
  )
  .option("--no-stream", "Disable SSE streaming and use polling only")
  .action(
    async (
      runtimeUrlArg: string | undefined,
      serviceIdArg: string | undefined,
      opts: {
        token?: string;
        agent?: string;
        runId?: string;
        pollMs?: number;
        eventsLimit?: number;
        stream?: boolean;
      }
    ) => {
      await runRuntimeChatViaClarity({
        runtimeUrlArg,
        serviceIdArg,
        token: opts.token,
        agent: opts.agent,
        runId: opts.runId,
        pollMs: opts.pollMs,
        eventsLimit: opts.eventsLimit,
        stream: opts.stream
      });
    }
  );

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
