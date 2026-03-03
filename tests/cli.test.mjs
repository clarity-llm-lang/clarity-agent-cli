import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/clarity-agent.cjs");
const clarityUiPath = path.resolve("bin/claritycli.cjs");

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
});

test("claritycli help is available", async () => {
  const result = await runUiCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /claritycli \[runtime-url\]/);
});

test("unsupported command exits with requirements guidance", async () => {
  const result = await runCli(["serve"]);
  assert.equal(result.code, 2);
  assert.match(result.stdout, /Command not yet available in native Clarity: serve/);
  assert.match(result.stdout, /RQ-LANG-CLI-NET-001/);
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
