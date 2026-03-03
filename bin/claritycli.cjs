#!/usr/bin/env node

const readline = require("node:readline");
const process = require("node:process");

const DEFAULT_RUNTIME_URL = "http://localhost:4707";
const EVENTS_LIMIT = 200;
const RESPONSE_WAIT_MS = 20000;
const POLL_MS = 400;

function usage() {
  process.stdout.write("claritycli [runtime-url] [--token <secret>]\n");
}

function normalizeUrl(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return DEFAULT_RUNTIME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `http://${trimmed}`.replace(/\/$/, "");
}

function parseArgs(argv) {
  let runtimeUrl = "";
  let token = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--token") {
      token = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (!arg.startsWith("-") && !runtimeUrl) {
      runtimeUrl = arg;
    }
  }
  if (!token) {
    token = String(process.env.CLARITY_RUNTIME_TOKEN || "").trim();
  }
  return {
    runtimeUrl: normalizeUrl(runtimeUrl),
    token
  };
}

function headers(token, json = false) {
  const out = {};
  if (json) out["content-type"] = "application/json";
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

async function requestJson(url, opts = {}) {
  const response = await fetch(url, opts);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`${opts.method || "GET"} ${url} failed (${response.status}): ${text}`);
  }
  return payload;
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function drawAgentMenu(runtimeUrl, agents, index) {
  clearScreen();
  process.stdout.write(`Connected to ${runtimeUrl}\n`);
  process.stdout.write("Select agent (up/down, enter):\n\n");
  agents.forEach((item, i) => {
    const prefix = i === index ? ">" : " ";
    const displayName = item.agent?.name || item.displayName || item.serviceId;
    const agentId = item.agent?.agentId || item.displayName || item.serviceId;
    process.stdout.write(`${prefix} ${displayName} (${agentId}) [${item.serviceId}]\n`);
  });
  process.stdout.write("\n");
}

async function selectAgentInteractive(runtimeUrl, agents) {
  return new Promise((resolve, reject) => {
    let index = 0;
    const stdin = process.stdin;

    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    };

    const onKeypress = (_str, key) => {
      if (key && key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\n");
        process.exit(130);
      }
      if (key && key.name === "up") {
        index = (index - 1 + agents.length) % agents.length;
        drawAgentMenu(runtimeUrl, agents, index);
        return;
      }
      if (key && key.name === "down") {
        index = (index + 1) % agents.length;
        drawAgentMenu(runtimeUrl, agents, index);
        return;
      }
      if (key && key.name === "return") {
        const selected = agents[index];
        cleanup();
        process.stdout.write("\n");
        resolve(selected);
        return;
      }
      if (key && key.name === "escape") {
        cleanup();
        reject(new Error("Selection cancelled."));
      }
    };

    drawAgentMenu(runtimeUrl, agents, index);
    stdin.on("keypress", onKeypress);
  });
}

function createRunId() {
  const suffix = Math.floor(Math.random() * 65535)
    .toString(16)
    .padStart(4, "0");
  return `run_cli_${Date.now()}_${suffix}`;
}

function eventMessage(event) {
  return event?.data?.message || event?.data?.text || event?.message || "";
}

function isTerminalEvent(kind) {
  return (
    kind === "agent.run_completed" || kind === "agent.run_failed" || kind === "agent.run_cancelled"
  );
}

async function bootstrapRun(runtimeUrl, token, serviceId, agentId, runId) {
  const base = `${runtimeUrl}/api/agents/events`;
  const triggerContext = {
    route: "/cli/runtime-chat",
    method: "CLI",
    requestId: runId,
    caller: "claritycli"
  };

  const created = {
    kind: "agent.run_created",
    level: "info",
    message: `agent.run_created (${runId})`,
    service_id: serviceId,
    run_id: runId,
    agent: agentId,
    data: {
      runId,
      serviceId,
      agent: agentId,
      trigger: "api",
      triggerContext,
      route: "/cli/runtime-chat",
      method: "CLI",
      requestId: runId,
      caller: "claritycli"
    }
  };
  const started = {
    kind: "agent.run_started",
    level: "info",
    message: `agent.run_started (${runId})`,
    service_id: serviceId,
    run_id: runId,
    agent: agentId,
    data: {
      runId,
      serviceId,
      agent: agentId,
      trigger: "api",
      triggerContext
    }
  };

  await requestJson(base, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify(created)
  });
  await requestJson(base, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify(started)
  });
}

async function sendMessage(runtimeUrl, token, runId, serviceId, agentId, message) {
  const url = `${runtimeUrl}/api/agents/runs/${encodeURIComponent(runId)}/messages`;
  await requestJson(url, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify({
      message,
      role: "user",
      service_id: serviceId,
      agent: agentId
    })
  });
}

async function fetchEvents(runtimeUrl, token, runId) {
  const url = `${runtimeUrl}/api/agents/runs/${encodeURIComponent(runId)}/events?limit=${EVENTS_LIMIT}`;
  const payload = await requestJson(url, {
    method: "GET",
    headers: headers(token)
  });
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function waitForAgentResponse(runtimeUrl, token, runId, state) {
  const deadline = Date.now() + RESPONSE_WAIT_MS;
  while (Date.now() < deadline) {
    const items = await fetchEvents(runtimeUrl, token, runId);
    let gotResponse = false;
    let sawAssistantEvent = false;
    let fallbackStepCompletedMessage = "";
    for (const item of items) {
      const seq = Number(item?.seq || 0);
      if (!Number.isFinite(seq) || seq <= state.lastSeq) continue;
      state.lastSeq = seq;
      const kind = String(item?.kind || "");
      if (kind === "agent.chat.assistant_message") {
        const msg = eventMessage(item);
        if (msg) {
          process.stdout.write(`bot> ${msg}\n`);
          sawAssistantEvent = true;
          gotResponse = true;
        }
      } else if (kind === "agent.step_completed") {
        const msg = eventMessage(item);
        if (msg) {
          // Some runtime paths emit chat replies as step_completed.data.message.
          // Keep the latest fallback candidate in case no assistant_message is emitted.
          fallbackStepCompletedMessage = msg;
        }
      } else if (isTerminalEvent(kind)) {
        process.stdout.write(`bot> [${kind}]\n`);
        state.terminal = true;
        return;
      }
    }
    if (!sawAssistantEvent && fallbackStepCompletedMessage) {
      process.stdout.write(`bot> ${fallbackStepCompletedMessage}\n`);
      gotResponse = true;
    }
    if (gotResponse || state.terminal) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  process.stdout.write("bot> [no response yet]\n");
}

async function chatLoop(runtimeUrl, token, selected, runId) {
  const agentId = selected.agent?.agentId || selected.displayName || selected.serviceId;
  const serviceId = selected.serviceId;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you> "
  });

  const state = { lastSeq: 0, terminal: false };

  process.stdout.write(`Connected: ${serviceId} (${agentId})\n`);
  process.stdout.write("Commands: /exit, /status, /help\n");
  rl.prompt();

  for await (const line of rl) {
    const input = String(line || "").trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "/exit" || input === "/quit") {
      rl.close();
      break;
    }
    if (input === "/help") {
      process.stdout.write("Commands: /exit, /status, /help\n");
      rl.prompt();
      continue;
    }
    if (input === "/status") {
      process.stdout.write(`run> ${runId} service=${serviceId} agent=${agentId}\n`);
      rl.prompt();
      continue;
    }

    try {
      await sendMessage(runtimeUrl, token, runId, serviceId, agentId, input);
      await waitForAgentResponse(runtimeUrl, token, runId, state);
      if (state.terminal) {
        rl.close();
        break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`send error: ${msg}\n`);
    }
    rl.prompt();
  }
}

async function main() {
  const { runtimeUrl, token } = parseArgs(process.argv.slice(2));
  const registry = await requestJson(`${runtimeUrl}/api/agents/registry`, {
    method: "GET",
    headers: headers(token)
  });
  const agents = Array.isArray(registry?.items) ? registry.items : [];
  if (agents.length === 0) {
    throw new Error(`No agents found at ${runtimeUrl}`);
  }

  const selected = await selectAgentInteractive(runtimeUrl, agents);
  const agentId = selected.agent?.agentId || selected.displayName || selected.serviceId;
  const runId = createRunId();
  await bootstrapRun(runtimeUrl, token, selected.serviceId, agentId, runId);
  await chatLoop(runtimeUrl, token, selected, runId);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
