#!/usr/bin/env node

import { randomUUID } from "node:crypto";
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
  getRuntimeRun,
  isTerminalRunStatus,
  listRuntimeAgents,
  listRuntimeRunEvents,
  startRuntimeApiRun,
  streamRuntimeEvents,
  submitRuntimeHitlInput,
  type RuntimeAgentRegistryItem,
  type RuntimeRunEvent
} from "../pkg/runtime/client.js";
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

function shortTimeLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toISOString().slice(11, 19);
}

function asNonEmptyDataString(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function eventMarker(event: RuntimeRunEvent): string {
  if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
    return `seq:${event.seq}`;
  }
  return `${event.at}|${event.kind}|${event.message}`;
}

function renderRuntimeEvent(event: RuntimeRunEvent, defaultAgent: string): string {
  const data = event.data;
  const message =
    asNonEmptyDataString(data, "message", "text", "input") ??
    asNonEmptyDataString(data, "reason", "waitingReason", "error") ??
    event.message;
  const compactMessage = message.replace(/\s+/g, " ").trim();
  const eventAgent = asNonEmptyDataString(data, "agent", "agentId", "agent_id") ?? defaultAgent;
  const stamp = shortTimeLabel(event.at);
  if (event.kind === "agent.hitl_input" || event.kind === "agent.human_message") {
    return `[${stamp}] you: ${compactMessage}`;
  }
  return `[${stamp}] ${eventAgent} (${event.kind}): ${compactMessage}`;
}

function runIdFromEventData(event: RuntimeRunEvent): string | null {
  return asNonEmptyDataString(event.data, "runId", "run_id");
}

function isTerminalRunEventKind(kind: string): boolean {
  return (
    kind === "agent.run_completed" || kind === "agent.run_failed" || kind === "agent.run_cancelled"
  );
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
  .description("Connect to a runtime agent run and chat over HITL input")
  .argument("<runtimeUrl>", "Runtime base URL")
  .argument("<serviceId>", "Agent service id from runtime-agents")
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
      runtimeUrl: string,
      serviceId: string,
      opts: {
        token?: string;
        agent?: string;
        runId?: string;
        pollMs?: number;
        eventsLimit?: number;
        stream?: boolean;
      }
    ) => {
      const pollMs = Math.max(300, opts.pollMs ?? 1200);
      const eventsLimit =
        Number.isInteger(opts.eventsLimit) && (opts.eventsLimit ?? 0) > 0
          ? Math.min(opts.eventsLimit ?? 200, 5000)
          : 200;
      const useStream = opts.stream !== false;

      const registry = await listRuntimeAgents(runtimeUrl, opts.token);
      const selected = registry.find((item) => item.serviceId === serviceId);
      if (!selected) {
        const known = registry.map((item) => item.serviceId).join(", ");
        throw new Error(
          known.length > 0
            ? `service not found in runtime registry: ${serviceId}. Known: ${known}`
            : `service not found in runtime registry: ${serviceId}`
        );
      }

      const agent =
        opts.agent?.trim() || selected.agent.agentId || selected.agent.name || "unknown-agent";
      const runId = opts.runId?.trim() || `run_cli_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const attached = typeof opts.runId === "string" && opts.runId.trim().length > 0;

      if (!attached) {
        await startRuntimeApiRun(
          runtimeUrl,
          {
            serviceId,
            runId,
            agent,
            route: "/cli/runtime-chat",
            method: "CLI",
            requestId: runId,
            caller: "clarity-agent-cli"
          },
          opts.token
        );
        process.stdout.write(`Started run: ${runId}\n`);
      } else {
        process.stdout.write(`Attached to run: ${runId}\n`);
      }

      process.stdout.write(`Runtime: ${runtimeUrl}\n`);
      process.stdout.write(`Service: ${serviceId}\n`);
      process.stdout.write(`Agent: ${agent}\n`);
      process.stdout.write("Commands: /status, /refresh, /exit\n");

      const seen = new Set<string>();
      let streamHealthy = false;
      let streamErrored = false;
      let terminalByStream: string | null = null;
      const streamAbort = new AbortController();

      const recordEvent = (event: RuntimeRunEvent): boolean => {
        if (runIdFromEventData(event) !== runId) {
          return false;
        }
        const marker = eventMarker(event);
        if (seen.has(marker)) {
          return false;
        }
        seen.add(marker);
        process.stdout.write(`${renderRuntimeEvent(event, agent)}\n`);
        if (isTerminalRunEventKind(event.kind)) {
          terminalByStream = event.kind;
        }
        return true;
      };

      const flushEvents = async (): Promise<number> => {
        const events = await listRuntimeRunEvents(runtimeUrl, runId, opts.token, eventsLimit);
        let emitted = 0;
        for (const event of events) {
          if (recordEvent(event)) {
            emitted += 1;
          }
        }
        return emitted;
      };

      const readStatus = async (): Promise<string | null> => {
        const run = await getRuntimeRun(runtimeUrl, runId, opts.token);
        return run ? run.status : null;
      };

      await flushEvents();

      const streamTask = useStream
        ? (async (): Promise<void> => {
            while (!streamAbort.signal.aborted) {
              try {
                await streamRuntimeEvents(runtimeUrl, {
                  token: opts.token,
                  signal: streamAbort.signal,
                  onOpen: () => {
                    streamHealthy = true;
                  },
                  onEvent: async (event) => {
                    recordEvent(event);
                  }
                });
                break;
              } catch (error) {
                if (streamAbort.signal.aborted) {
                  break;
                }
                streamHealthy = false;
                streamErrored = true;
                const message = error instanceof Error ? error.message : String(error);
                process.stdout.write(
                  `[${new Date().toISOString()}] stream error: ${message}. Falling back to polling.\n`
                );
                await sleep(pollMs);
              }
            }
          })()
        : null;

      try {
        while (true) {
          if (terminalByStream) {
            process.stdout.write(`Run ${runId} finished (${terminalByStream}). Exiting chat.\n`);
            await flushEvents();
            break;
          }

          const status = await readStatus();
          if (status && isTerminalRunStatus(status)) {
            process.stdout.write(`Run ${runId} is terminal (${status}). Exiting chat.\n`);
            await flushEvents();
            break;
          }

          const input = (await promptLine("you> ")).trim();
          if (!input) {
            if (!useStream || streamErrored || !streamHealthy) {
              await flushEvents();
            }
            continue;
          }
          if (input === "/exit" || input === "/quit") {
            process.stdout.write("Closing runtime chat.\n");
            break;
          }
          if (input === "/refresh") {
            await flushEvents();
            continue;
          }
          if (input === "/status") {
            const current = await readStatus();
            process.stdout.write(`Run status: ${current ?? "unknown"}\n`);
            continue;
          }

          await submitRuntimeHitlInput(
            runtimeUrl,
            {
              runId,
              message: input,
              serviceId,
              agent
            },
            opts.token
          );

          if (!useStream || streamErrored || !streamHealthy) {
            let hadNewEvents = false;
            for (let attempt = 0; attempt < 6; attempt += 1) {
              if (attempt > 0) {
                await sleep(pollMs);
              }
              const emitted = await flushEvents();
              if (emitted > 0) {
                hadNewEvents = true;
              }
              const currentStatus = await readStatus();
              if (currentStatus && isTerminalRunStatus(currentStatus)) {
                break;
              }
              if (hadNewEvents && emitted === 0) {
                break;
              }
            }
          } else {
            await sleep(Math.min(900, pollMs));
          }
        }
      } finally {
        streamAbort.abort();
        if (streamTask) {
          await streamTask;
        }
      }
    }
  );

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
