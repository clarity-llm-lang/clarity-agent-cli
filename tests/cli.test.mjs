import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/clarity-agent.cjs");
const clarityUiPath = path.resolve("bin/claritycli.cjs");

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

function runCli(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
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

function runUiCli(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [clarityUiPath, ...args], {
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
