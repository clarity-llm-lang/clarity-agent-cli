import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("bin/clarity-agent.js");

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

test("help output is printed from native clarity router", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Clarity Agent CLI \(native Clarity commands\)/);
  assert.match(result.stdout, /runtime-chat/);
  assert.match(result.stdout, /runtime-agents/);
});

test("unsupported command exits with requirements guidance", async () => {
  const result = await runCli(["watch"]);
  assert.equal(result.code, 2);
  assert.match(result.stdout, /Command not yet available in native Clarity: watch/);
  assert.match(result.stdout, /RQ-LANG-CLI-FS-001/);
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
