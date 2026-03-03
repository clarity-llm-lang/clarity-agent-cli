#!/usr/bin/env node

const process = require("node:process");
const readline = require("node:readline");

const DEFAULT_RUNTIME_URL = "http://localhost:4707";
const EVENTS_LIMIT = 200;
const RESPONSE_WAIT_MS = 20000;
const POLL_MS = 400;
const DISCUSS_DEFAULT_TURNS = 6;

function usage() {
  process.stdout.write("claritycli [runtime-url] [--token <secret>]\n\n");
  process.stdout.write("Flow:\n");
  process.stdout.write("1. Connects to runtime (default http://localhost:4707)\n");
  process.stdout.write("2. Lets you invite one or more bots (up/down + space + enter)\n");
  process.stdout.write("3. Lets you name each bot with easy aliases (e.g. coder, ux)\n");
  process.stdout.write("4. Starts chat room with targeted messaging and discuss mode\n\n");
  process.stdout.write("Chat commands:\n");
  process.stdout.write("- @alias <text>         Send to one bot\n");
  process.stdout.write("- /to <alias> <text>    Send to one bot\n");
  process.stdout.write("- /broadcast <text>     Send to all invited bots\n");
  process.stdout.write("- discuss [turns]       Let bots discuss (default 6 turns)\n");
  process.stdout.write("- /rename <old> <new>   Rename bot alias\n");
  process.stdout.write("- /agents               Show invited bots\n");
  process.stdout.write("- /status               Show run ids\n");
  process.stdout.write("- /help                 Show help\n");
  process.stdout.write("- /exit                 Exit\n");
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

function displayAgent(item) {
  const name = item.agent?.name || item.displayName || item.serviceId;
  const agentId = item.agent?.agentId || item.displayName || item.serviceId;
  return `${name} (${agentId}) [${item.serviceId}]`;
}

function drawAgentMultiMenu(runtimeUrl, agents, index, selected) {
  clearScreen();
  process.stdout.write(`Connected to ${runtimeUrl}\n`);
  process.stdout.write(
    "Invite bots (up/down move, space toggle, enter confirm, a toggle all):\n\n"
  );
  agents.forEach((item, i) => {
    const cursor = i === index ? ">" : " ";
    const mark = selected.has(i) ? "[x]" : "[ ]";
    process.stdout.write(`${cursor} ${mark} ${displayAgent(item)}\n`);
  });
  process.stdout.write("\n");
}

function selectAgentsByPrompt(agents) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    agents.forEach((item, i) => {
      process.stdout.write(`${i + 1}. ${displayAgent(item)}\n`);
    });
    rl.question("Select bot numbers (comma-separated, default 1): ", (answer) => {
      rl.close();
      const raw = String(answer || "").trim();
      const indices = raw
        ? raw
            .split(",")
            .map((v) => Number(v.trim()) - 1)
            .filter((n) => Number.isInteger(n) && n >= 0 && n < agents.length)
        : [0];
      if (indices.length === 0) {
        reject(new Error("No valid bot selections."));
        return;
      }
      const deduped = [...new Set(indices)];
      resolve(deduped.map((i) => agents[i]));
    });
  });
}

async function selectAgentsInteractive(runtimeUrl, agents) {
  if (!process.stdin.isTTY) {
    return selectAgentsByPrompt(agents);
  }
  return new Promise((resolve, reject) => {
    let index = 0;
    const selected = new Set();
    const stdin = process.stdin;

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(false);
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
        drawAgentMultiMenu(runtimeUrl, agents, index, selected);
        return;
      }
      if (key && key.name === "down") {
        index = (index + 1) % agents.length;
        drawAgentMultiMenu(runtimeUrl, agents, index, selected);
        return;
      }
      if (key && key.name === "space") {
        if (selected.has(index)) selected.delete(index);
        else selected.add(index);
        drawAgentMultiMenu(runtimeUrl, agents, index, selected);
        return;
      }
      if (key && (key.name === "a" || key.name === "A")) {
        if (selected.size === agents.length) selected.clear();
        else {
          selected.clear();
          for (let i = 0; i < agents.length; i += 1) selected.add(i);
        }
        drawAgentMultiMenu(runtimeUrl, agents, index, selected);
        return;
      }
      if (key && key.name === "return") {
        if (selected.size === 0) selected.add(index);
        const out = [...selected].sort((a, b) => a - b).map((i) => agents[i]);
        cleanup();
        process.stdout.write("\n");
        resolve(out);
        return;
      }
      if (key && key.name === "escape") {
        cleanup();
        reject(new Error("Selection cancelled."));
      }
    };

    drawAgentMultiMenu(runtimeUrl, agents, index, selected);
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

function toAliasBase(text, fallback) {
  const raw = String(text || "")
    .trim()
    .toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 24);
  return slug || fallback;
}

function ensureUniqueAlias(candidate, used) {
  let alias = candidate;
  let i = 2;
  while (used.has(alias)) {
    alias = `${candidate}-${i}`;
    i += 1;
  }
  return alias;
}

function createPromptInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(String(answer || "")));
  });
}

async function assignAliases(selectedAgents) {
  const rl = createPromptInterface();
  const used = new Set();
  const participants = [];

  try {
    for (let i = 0; i < selectedAgents.length; i += 1) {
      const item = selectedAgents[i];
      const displayName = item.agent?.name || item.displayName || item.serviceId;
      const agentId = item.agent?.agentId || item.displayName || item.serviceId;
      const defaultAlias = ensureUniqueAlias(
        toAliasBase(displayName || agentId, `bot${i + 1}`),
        used
      );
      const answer = (await ask(rl, `Alias for ${displayName} [${defaultAlias}]: `)).trim();
      const alias = ensureUniqueAlias(toAliasBase(answer || defaultAlias, defaultAlias), used);
      used.add(alias);
      participants.push({
        alias,
        serviceId: item.serviceId,
        agentId,
        displayName,
        runId: "",
        state: { lastSeq: 0, terminal: false }
      });
    }
  } finally {
    rl.close();
  }

  return participants;
}

async function bootstrapRun(runtimeUrl, token, participant, runId) {
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
    service_id: participant.serviceId,
    run_id: runId,
    agent: participant.agentId,
    data: {
      runId,
      serviceId: participant.serviceId,
      agent: participant.agentId,
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
    service_id: participant.serviceId,
    run_id: runId,
    agent: participant.agentId,
    data: {
      runId,
      serviceId: participant.serviceId,
      agent: participant.agentId,
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

async function sendMessage(runtimeUrl, token, participant, message) {
  const url = `${runtimeUrl}/api/agents/runs/${encodeURIComponent(participant.runId)}/messages`;
  await requestJson(url, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify({
      message,
      role: "user",
      service_id: participant.serviceId,
      agent: participant.agentId
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

async function waitForSingleReply(runtimeUrl, token, participant) {
  const deadline = Date.now() + RESPONSE_WAIT_MS;
  while (Date.now() < deadline) {
    const items = await fetchEvents(runtimeUrl, token, participant.runId);
    let assistantMsg = "";
    let stepCompletedFallback = "";
    for (const item of items) {
      const seq = Number(item?.seq || 0);
      if (!Number.isFinite(seq) || seq <= participant.state.lastSeq) continue;
      participant.state.lastSeq = seq;
      const kind = String(item?.kind || "");
      if (kind === "agent.chat.assistant_message") {
        const msg = eventMessage(item);
        if (msg) assistantMsg = msg;
      } else if (kind === "agent.step_completed") {
        const msg = eventMessage(item);
        if (msg) stepCompletedFallback = msg;
      } else if (isTerminalEvent(kind)) {
        participant.state.terminal = true;
        return { message: `[${kind}]`, terminal: true };
      }
    }
    const msg = assistantMsg || stepCompletedFallback;
    if (msg) return { message: msg, terminal: false };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { message: "[no response yet]", terminal: false };
}

function printParticipants(participants) {
  process.stdout.write("Invited bots:\n");
  for (const p of participants) {
    process.stdout.write(`- ${p.alias}: ${p.displayName} (${p.serviceId})\n`);
  }
}

function buildAliasMap(participants) {
  const map = new Map();
  for (const p of participants) {
    map.set(p.alias, p);
  }
  return map;
}

function parseTurns(input) {
  const raw = String(input || "")
    .trim()
    .split(/\s+/);
  const maybe = Number(raw[1] || DISCUSS_DEFAULT_TURNS);
  if (!Number.isFinite(maybe)) return DISCUSS_DEFAULT_TURNS;
  return Math.min(20, Math.max(2, Math.floor(maybe)));
}

function formatTranscript(history) {
  if (history.length === 0) return "(no transcript yet)";
  const slice = history.slice(-10);
  return slice.map((row) => `${row.from}: ${row.text}`).join("\n");
}

async function sendToParticipant(runtimeUrl, token, participant, text, history, isDiscuss = false) {
  if (participant.state.terminal) {
    process.stdout.write(`${participant.alias}> [run already terminal]\n`);
    return;
  }
  if (!isDiscuss) {
    process.stdout.write(`you> @${participant.alias} ${text}\n`);
    history.push({ from: "you", text: `@${participant.alias} ${text}` });
  } else {
    process.stdout.write(`system> discuss turn for ${participant.alias}\n`);
  }

  await sendMessage(runtimeUrl, token, participant, text);
  const reply = await waitForSingleReply(runtimeUrl, token, participant);
  process.stdout.write(`${participant.alias}> ${reply.message}\n`);
  history.push({ from: participant.alias, text: reply.message });
}

async function runDiscuss(runtimeUrl, token, participants, history, input) {
  const turns = parseTurns(input);
  if (participants.length < 2) {
    process.stdout.write("system> discuss needs at least 2 invited bots.\n");
    return;
  }
  process.stdout.write(`system> discuss starting (${turns} turns)\n`);

  for (let i = 0; i < turns; i += 1) {
    const speaker = participants[i % participants.length];
    const others = participants
      .filter((p) => p.alias !== speaker.alias)
      .map((p) => p.alias)
      .join(", ");
    const prompt = [
      "You are in a multi-agent collaboration room.",
      `Your alias: ${speaker.alias}.`,
      `Other aliases: ${others}.`,
      "Discuss the solution and move toward a concrete shared conclusion.",
      "Respond with one concise message (max 4 sentences).",
      "Recent transcript:",
      formatTranscript(history)
    ].join("\n");
    await sendToParticipant(runtimeUrl, token, speaker, prompt, history, true);
  }

  process.stdout.write("system> discuss completed.\n");
}

function isRenameAliasValid(alias) {
  return /^[a-zA-Z0-9_-]{1,24}$/.test(alias);
}

function renameAlias(participants, oldAlias, newAlias) {
  const target = participants.find((p) => p.alias === oldAlias);
  if (!target) return "Unknown alias.";
  if (!isRenameAliasValid(newAlias)) return "Invalid alias. Use 1-24 chars [a-zA-Z0-9_-].";
  if (participants.some((p) => p.alias === newAlias)) return "Alias already exists.";
  target.alias = newAlias;
  return "";
}

function chatHelp() {
  process.stdout.write("Commands:\n");
  process.stdout.write("- @alias <text>\n");
  process.stdout.write("- /to <alias> <text>\n");
  process.stdout.write("- /broadcast <text>\n");
  process.stdout.write("- discuss [turns]\n");
  process.stdout.write("- /rename <old> <new>\n");
  process.stdout.write("- /agents\n");
  process.stdout.write("- /status\n");
  process.stdout.write("- /help\n");
  process.stdout.write("- /exit\n");
}

async function chatLoop(runtimeUrl, token, participants) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you> "
  });
  const history = [];

  printParticipants(participants);
  chatHelp();
  rl.prompt();

  for await (const rawLine of rl) {
    const input = String(rawLine || "").trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === "/exit" || input === "/quit") {
      rl.close();
      break;
    }
    if (input === "/help") {
      chatHelp();
      rl.prompt();
      continue;
    }
    if (input === "/agents") {
      printParticipants(participants);
      rl.prompt();
      continue;
    }
    if (input === "/status") {
      for (const p of participants) {
        process.stdout.write(
          `run> ${p.alias} service=${p.serviceId} run=${p.runId} terminal=${p.state.terminal}\n`
        );
      }
      rl.prompt();
      continue;
    }
    if (input.startsWith("/rename ")) {
      const m = input.match(/^\/rename\s+(\S+)\s+(\S+)$/);
      if (!m) {
        process.stdout.write("Usage: /rename <old> <new>\n");
        rl.prompt();
        continue;
      }
      const err = renameAlias(participants, m[1], m[2]);
      if (err) process.stdout.write(`system> ${err}\n`);
      else process.stdout.write(`system> renamed ${m[1]} -> ${m[2]}\n`);
      rl.prompt();
      continue;
    }
    if (input === "discuss" || input.startsWith("discuss ") || input.startsWith("/discuss")) {
      try {
        await runDiscuss(
          runtimeUrl,
          token,
          participants,
          history,
          input.replace("/discuss", "discuss")
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`discuss error: ${msg}\n`);
      }
      rl.prompt();
      continue;
    }

    const aliasMap = buildAliasMap(participants);
    const toMatch = input.match(/^\/to\s+(\S+)\s+(.+)$/);
    const atMatch = input.match(/^@(\S+)\s+(.+)$/);
    const broadcastMatch = input.match(/^\/broadcast\s+(.+)$/);

    try {
      if (toMatch || atMatch) {
        const alias = (toMatch ? toMatch[1] : atMatch[1]).trim();
        const text = (toMatch ? toMatch[2] : atMatch[2]).trim();
        const participant = aliasMap.get(alias);
        if (!participant) {
          process.stdout.write(`system> unknown alias '${alias}'. Use /agents.\n`);
        } else {
          await sendToParticipant(runtimeUrl, token, participant, text, history, false);
        }
      } else if (broadcastMatch) {
        const text = broadcastMatch[1].trim();
        for (const participant of participants) {
          await sendToParticipant(runtimeUrl, token, participant, text, history, false);
        }
      } else if (participants.length === 1) {
        await sendToParticipant(runtimeUrl, token, participants[0], input, history, false);
      } else {
        process.stdout.write(
          "system> multiple bots invited. Use @alias <text>, /to <alias> <text>, or /broadcast <text>.\n"
        );
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

  const selectedAgents = await selectAgentsInteractive(runtimeUrl, agents);
  const participants = await assignAliases(selectedAgents);
  for (const participant of participants) {
    participant.runId = createRunId();
    await bootstrapRun(runtimeUrl, token, participant, participant.runId);
  }

  await chatLoop(runtimeUrl, token, participants);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
