import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/clarity-agent.cjs");
const clarityUiPath = path.resolve("dist/claritycli.cjs");

async function waitFor(check, timeoutMs = 5000, intervalMs = 25) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for expected condition");
}

async function findFreePort() {
  const probe = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function runCli(args, input = "", envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...envOverrides }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    if (input.length > 0) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function runUiCli(args, input = "", envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [clarityUiPath, ...args], {
      env: { ...process.env, ...envOverrides }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    if (input.length > 0) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    return {};
  }
  return JSON.parse(raw);
}

async function startRuntimeMock(options = {}) {
  const registryItems = options.registryItems ?? [
    {
      serviceId: "svc-1",
      displayName: "alpha",
      agent: { agentId: "alpha-agent", name: "Alpha Agent", triggers: ["api"] },
      lifecycle: "running",
      health: "healthy"
    },
    {
      serviceId: "svc-2",
      displayName: "beta",
      agent: { agentId: "beta-agent", name: "Beta Agent", triggers: ["api"] },
      lifecycle: "running",
      health: "healthy"
    }
  ];

  const runs = new Map();
  const calls = {
    eventsPosts: 0,
    messagePosts: 0,
    streamRequests: 0
  };

  function ensureRun(runId, serviceId, agent) {
    let run = runs.get(runId);
    if (!run) {
      run = {
        runId,
        serviceId,
        agent,
        status: "running",
        events: [],
        seq: 0,
        createdAt: Date.now()
      };
      runs.set(runId, run);
    }
    return run;
  }

  for (const seed of options.initialRuns ?? []) {
    runs.set(seed.runId, {
      runId: seed.runId,
      serviceId: seed.serviceId,
      agent: seed.agent,
      status: seed.status ?? "running",
      events: seed.events ?? [],
      seq: (seed.events ?? []).length,
      createdAt: Date.now()
    });
  }

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    const { pathname } = requestUrl;

    if (req.method === "GET" && pathname === "/api/agents/registry") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: registryItems }));
      return;
    }

    if (req.method === "GET" && pathname === "/api/agents/runs") {
      const items = Array.from(runs.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((run) => ({
          runId: run.runId,
          serviceId: run.serviceId,
          agent: run.agent,
          status: run.status
        }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items }));
      return;
    }

    if (req.method === "POST" && pathname === "/api/agents/events") {
      calls.eventsPosts += 1;
      const body = await readJsonBody(req);
      const runId = String(body.run_id ?? body.runId ?? body?.data?.runId ?? `run-${Date.now()}`);
      const serviceId = String(
        body.service_id ?? body.serviceId ?? body?.data?.serviceId ?? "svc-1"
      );
      const agent = String(body.agent ?? body?.data?.agent ?? "alpha-agent");
      const run = ensureRun(runId, serviceId, agent);
      const kind = String(body.kind ?? "agent.event");
      const message = String(body.message ?? kind);
      run.seq += 1;
      run.events.push({
        seq: run.seq,
        kind,
        message,
        data: body.data ?? {}
      });
      if (kind === "agent.run_completed") run.status = "completed";
      if (kind === "agent.run_failed") run.status = "failed";
      if (kind === "agent.run_cancelled") run.status = "cancelled";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const messageMatch = pathname.match(/^\/api\/agents\/runs\/([^/]+)\/messages$/);
    if (req.method === "POST" && messageMatch) {
      calls.messagePosts += 1;
      const runId = decodeURIComponent(messageMatch[1]);
      const body = await readJsonBody(req);
      const serviceId = String(body.service_id ?? "svc-1");
      const agent = String(body.agent ?? "alpha-agent");
      const run = ensureRun(runId, serviceId, agent);
      const userMessage = String(body.message ?? "");
      run.seq += 1;
      run.events.push({
        seq: run.seq,
        kind: "agent.chat.user_message",
        message: userMessage,
        data: { message: userMessage, agent }
      });
      run.seq += 1;
      run.events.push({
        seq: run.seq,
        kind: "agent.chat.assistant_message",
        message: `Echo: ${userMessage}`,
        data: { message: `Echo: ${userMessage}`, agent }
      });
      if (userMessage.toLowerCase().includes("finish")) {
        run.seq += 1;
        run.events.push({
          seq: run.seq,
          kind: "agent.run_completed",
          message: "completed",
          data: { runId }
        });
        run.status = "completed";
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const streamMatch = pathname.match(/^\/api\/agents\/runs\/([^/]+)\/events\/stream$/);
    if (req.method === "GET" && streamMatch) {
      calls.streamRequests += 1;
      if (options.enableStream === true) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write("\n");
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "stream-unavailable" }));
      return;
    }

    const eventsMatch = pathname.match(/^\/api\/agents\/runs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      const runId = decodeURIComponent(eventsMatch[1]);
      const run = runs.get(runId);
      const items = run?.events ?? [];
      res.writeHead(200, { "content-type": "application/json" });
      if (options.eventsAsArray === true) {
        res.end(JSON.stringify(items));
      } else {
        res.end(JSON.stringify({ items }));
      }
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found", path: pathname }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    runtimeUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test("help output is printed from native clarity router", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Clarity Agent CLI \(native Clarity\)/);
  assert.match(result.stdout, /runtime-chat/);
  assert.match(result.stdout, /runtime-agents/);
  assert.match(result.stdout, /watch/);
  assert.match(result.stdout, /list/);
  assert.match(result.stdout, /cancel/);
  assert.match(result.stdout, /serve/);
});

test("claritycli help is available", async () => {
  const result = await runUiCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /claritycli \[runtime-url\]/);
});

test("serve exposes broker HTTP API", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clarity-hitl-serve-"));
  const port = await findFreePort();
  const child = spawn(process.execPath, [cliPath, "serve", "--dir", dir, "--port", String(port)], {
    env: process.env
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    await waitFor(() => stdout.includes(`http://127.0.0.1:${port}`), 8000);

    const submit = await fetch(`http://127.0.0.1:${port}/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "review-step-3",
        question: "Does this summary look correct?",
        timestamp: 1708608000000,
        pid: 12345
      })
    });
    assert.equal(submit.status, 200);
    const submitBody = await submit.json();
    assert.equal(submitBody.key, "review-step-3");
    assert.equal(submitBody.safeKey, "review-step-3");

    const list = await fetch(`http://127.0.0.1:${port}/questions`);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(Array.isArray(listBody), true);
    assert.equal(listBody.length, 1);
    assert.equal(listBody[0].key, "review-step-3");
    assert.equal(listBody[0].question, "Does this summary look correct?");

    const pendingState = await fetch(`http://127.0.0.1:${port}/questions/review-step-3`);
    assert.equal(pendingState.status, 200);
    const pendingBody = await pendingState.json();
    assert.equal(pendingBody.status, "pending");

    const answer = await fetch(`http://127.0.0.1:${port}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "review-step-3",
        response: "Looks good, proceed"
      })
    });
    assert.equal(answer.status, 200);
    const answerBody = await answer.json();
    assert.equal(answerBody.safeKey, "review-step-3");

    const answeredState = await fetch(`http://127.0.0.1:${port}/questions/review-step-3`);
    assert.equal(answeredState.status, 200);
    const answeredBody = await answeredState.json();
    assert.equal(answeredBody.status, "answered");
    assert.equal(answeredBody.response, "Looks good, proceed");

    const cancel = await fetch(`http://127.0.0.1:${port}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "review-step-3" })
    });
    assert.equal(cancel.status, 200);
    const cancelBody = await cancel.json();
    assert.equal(cancelBody.removed, true);

    const missingState = await fetch(`http://127.0.0.1:${port}/questions/review-step-3`);
    assert.equal(missingState.status, 200);
    const missingBody = await missingState.json();
    assert.equal(missingBody.status, "missing");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
    await new Promise((resolve) => child.once("close", resolve));
    await rm(dir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
});

test("runtime-agents lists entries from runtime registry", async () => {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/agents/registry") {
      const body = JSON.stringify({
        items: [
          {
            serviceId: "svc-1",
            displayName: "openai-chat-agent",
            agent: {
              agentId: "openai-chat-agent",
              name: "OpenAI Chat Agent",
              triggers: ["chat.user_message"]
            },
            lifecycle: "running",
            health: "healthy"
          }
        ]
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const runtimeUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await runCli(["runtime-agents", runtimeUrl]);
    assert.equal(result.code, 0);
    assert.match(
      result.stdout,
      new RegExp(`Runtime: ${runtimeUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
    assert.match(result.stdout, /OpenAI Chat Agent/);
    assert.match(result.stdout, /service=svc-1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("list and cancel operate on local question files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clarity-hitl-"));
  const questionPath = path.join(dir, "review-step-3.question");
  const questionPayload = {
    key: "review-step-3",
    question: "Does this summary look correct?",
    timestamp: Date.now(),
    pid: 1234
  };
  await writeFile(questionPath, JSON.stringify(questionPayload), "utf8");

  try {
    const listBefore = await runCli(["list", "--dir", dir]);
    assert.equal(listBefore.code, 0);
    assert.match(listBefore.stdout, /Handshake directory:/);
    assert.match(listBefore.stdout, /review-step-3/);

    const cancel = await runCli(["cancel", "review-step-3", "--dir", dir]);
    assert.equal(cancel.code, 0);
    assert.match(cancel.stdout, /Cancelled: review-step-3/);

    const listAfter = await runCli(["list", "--dir", dir]);
    assert.equal(listAfter.code, 0);
    assert.match(listAfter.stdout, /No pending questions/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("answer writes .answer file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clarity-hitl-"));

  try {
    const result = await runCli(["answer", "review-step-9", "Looks good", "--dir", dir]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Wrote answer:/);
    const answerPath = path.join(dir, "review-step-9.answer");
    const content = await readFile(answerPath, "utf8");
    assert.equal(content, "Looks good");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime-chat attempts stream path and exits cleanly", async () => {
  const runtime = await startRuntimeMock();
  try {
    const result = await runCli(["runtime-chat", runtime.runtimeUrl, "svc-1"], "/exit\n");
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Started run:/);
    assert.match(result.stdout, /Closing runtime chat\./);
    assert.equal(runtime.calls.eventsPosts >= 2, true);
    assert.equal(runtime.calls.streamRequests >= 1, true);
  } finally {
    await runtime.close();
  }
});

test("runtime-chat --resume-latest reuses active run without bootstrap", async () => {
  const runtime = await startRuntimeMock({
    initialRuns: [
      {
        runId: "run_existing",
        serviceId: "svc-1",
        agent: "alpha-agent",
        status: "running",
        events: []
      }
    ]
  });
  try {
    const result = await runCli(
      [
        "runtime-chat",
        runtime.runtimeUrl,
        "svc-1",
        "--agent",
        "alpha-agent",
        "--resume-latest",
        "--no-stream"
      ],
      "/exit\n"
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Resumed run: run_existing/);
    assert.equal(runtime.calls.eventsPosts, 0);
  } finally {
    await runtime.close();
  }
});

test("runtime-chat exits when terminal event is observed", async () => {
  const runtime = await startRuntimeMock();
  try {
    const result = await runCli(
      ["runtime-chat", runtime.runtimeUrl, "svc-1", "--no-stream"],
      "finish this run\n"
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Run is terminal\. Exiting chat\./);
  } finally {
    await runtime.close();
  }
});

test("claritycli supports alias targeting and discuss loop", async () => {
  const runtime = await startRuntimeMock({ eventsAsArray: true });
  try {
    const input = ["1,2", "alpha", "beta", "@alpha hello", "discuss 2", "/exit"].join("\n") + "\n";
    const result = await runUiCli([runtime.runtimeUrl, "--no-tty-select"], input);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Invited bots:/);
    assert.match(result.stdout, /- alpha:/);
    assert.match(result.stdout, /- beta:/);
    assert.match(result.stdout, /alpha> Echo: hello/);
    assert.match(result.stdout, /system> discuss starting \(2 turns\)/);
    assert.match(result.stdout, /system> discuss completed\./);
    assert.equal(runtime.calls.messagePosts >= 3, true);
  } finally {
    await runtime.close();
  }
});

test("runtime-agents uses CLARITY_RUNTIME_TOKEN when --token is omitted", async () => {
  const expectedToken = "runtime-secret";
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/agents/registry") {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${expectedToken}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          items: [
            {
              serviceId: "svc-1",
              displayName: "token-agent",
              agent: { agentId: "token-agent", name: "Token Agent", triggers: ["api"] },
              lifecycle: "running",
              health: "healthy"
            }
          ]
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const runtimeUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await runCli(["runtime-agents", runtimeUrl], "", {
      CLARITY_RUNTIME_TOKEN: expectedToken
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Runtime:/);
    assert.match(result.stdout, /Token Agent/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("serve requires header token by default and only accepts query token with opt-in", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clarity-hitl-serve-auth-"));
  const token = "broker-secret";
  const port = await findFreePort();
  const child = spawn(
    process.execPath,
    [cliPath, "serve", "--dir", dir, "--port", String(port), "--token", token],
    {
      env: process.env
    }
  );

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });

  try {
    await waitFor(() => stdout.includes(`http://127.0.0.1:${port}`), 8000);
    const byQuery = await fetch(`http://127.0.0.1:${port}/questions?token=${token}`);
    assert.equal(byQuery.status, 401);

    const byHeader = await fetch(`http://127.0.0.1:${port}/questions`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(byHeader.status, 200);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
    await new Promise((resolve) => child.once("close", resolve));
  }

  const port2 = await findFreePort();
  const child2 = spawn(
    process.execPath,
    [
      cliPath,
      "serve",
      "--dir",
      dir,
      "--port",
      String(port2),
      "--token",
      token,
      "--allow-query-token"
    ],
    { env: process.env }
  );
  let stdout2 = "";
  child2.stdout.on("data", (chunk) => {
    stdout2 += chunk.toString("utf8");
  });

  try {
    await waitFor(() => stdout2.includes(`http://127.0.0.1:${port2}`), 8000);
    const byQuery = await fetch(`http://127.0.0.1:${port2}/questions?token=${token}`);
    assert.equal(byQuery.status, 200);
  } finally {
    if (child2.exitCode === null) {
      child2.kill("SIGTERM");
    }
    await new Promise((resolve) => child2.once("close", resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
