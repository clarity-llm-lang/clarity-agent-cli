import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  getRuntimeRun,
  listRuntimeAgents,
  listRuntimeRunEvents,
  startRuntimeApiRun,
  streamRuntimeRunEvents,
  streamRuntimeEvents,
  submitRuntimeHitlInput
} from "../pkg/runtime/client.js";

interface CapturedRequest {
  method: string;
  path: string;
  body?: unknown;
}

async function startMockRuntimeServer(
  handler: (req: CapturedRequest) => { status?: number; body?: unknown }
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      parts.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(parts).toString("utf8").trim();
      let body: unknown = undefined;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      const out = handler({
        method,
        path: `${url.pathname}${url.search}`,
        ...(typeof body !== "undefined" ? { body } : {})
      });

      const status = out.status ?? 200;
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(`${JSON.stringify(out.body ?? { ok: true })}\n`);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock runtime server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function startMockSseServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    if (method !== "GET" || url.pathname !== "/api/events") {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(`${JSON.stringify({ error: "not found" })}\n`);
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    res.write(
      `data: ${JSON.stringify({
        seq: 11,
        at: "2026-02-24T10:00:00.000Z",
        kind: "agent.waiting",
        level: "info",
        message: "Awaiting input",
        data: { runId: "run_stream_1", reason: "Need approval" }
      })}\n\n`
    );

    const timer = setTimeout(() => {
      res.write(
        `data: ${JSON.stringify({
          seq: 12,
          at: "2026-02-24T10:00:02.000Z",
          kind: "agent.run_completed",
          level: "info",
          message: "Run completed",
          data: { runId: "run_stream_1" }
        })}\n\n`
      );
      res.end();
    }, 20);

    req.on("close", () => {
      clearTimeout(timer);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock SSE server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function startMockRunScopedSseServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    if (
      method !== "GET" ||
      url.pathname !== "/api/agents/runs/run_stream_1/events/stream" ||
      url.search !== "?limit=200"
    ) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(`${JSON.stringify({ error: "not found" })}\n`);
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    res.write(
      `data: ${JSON.stringify({
        seq: 21,
        at: "2026-02-24T11:00:00.000Z",
        kind: "agent.waiting",
        level: "info",
        message: "Run-specific waiting",
        data: { runId: "run_stream_1", reason: "Need approval" }
      })}\n\n`
    );

    const timer = setTimeout(() => {
      res.write(
        `data: ${JSON.stringify({
          seq: 22,
          at: "2026-02-24T11:00:02.000Z",
          kind: "agent.run_completed",
          level: "info",
          message: "Run completed",
          data: { runId: "run_stream_1" }
        })}\n\n`
      );
      res.end();
    }, 20);

    req.on("close", () => {
      clearTimeout(timer);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock run-scoped SSE server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

test("listRuntimeAgents parses runtime registry payload", async () => {
  const { baseUrl, close } = await startMockRuntimeServer((req) => {
    assert.equal(req.method, "GET");
    assert.equal(req.path, "/api/agents/registry");
    return {
      body: {
        count: 1,
        items: [
          {
            serviceId: "svc_123",
            displayName: "Coordinator Agent",
            lifecycle: "RUNNING",
            health: "HEALTHY",
            originType: "local_wasm",
            agent: {
              agentId: "coordinator",
              name: "Coordinator",
              role: "orchestrator",
              objective: "Coordinate workers",
              triggers: ["api", "timer"]
            }
          }
        ]
      }
    };
  });

  try {
    const agents = await listRuntimeAgents(baseUrl);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].serviceId, "svc_123");
    assert.equal(agents[0].agent.agentId, "coordinator");
    assert.deepEqual(agents[0].agent.triggers, ["api", "timer"]);
  } finally {
    await close();
  }
});

test("startRuntimeApiRun posts run_created and run_started events", async () => {
  const captured: CapturedRequest[] = [];
  const { baseUrl, close } = await startMockRuntimeServer((req) => {
    captured.push(req);
    return { body: { ok: true } };
  });

  try {
    await startRuntimeApiRun(baseUrl, {
      serviceId: "svc_abc",
      runId: "run_cli_001",
      agent: "coordinator",
      requestId: "req_001",
      caller: "clarity-agent-cli",
      route: "/cli/runtime-chat",
      method: "CLI"
    });

    assert.equal(captured.length, 2);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].path, "/api/agents/events");
    assert.equal(captured[1].method, "POST");
    assert.equal(captured[1].path, "/api/agents/events");

    const firstBody = captured[0].body as Record<string, unknown>;
    const secondBody = captured[1].body as Record<string, unknown>;
    assert.equal(firstBody.kind, "agent.run_created");
    assert.equal(firstBody.service_id, "svc_abc");
    assert.equal(firstBody.run_id, "run_cli_001");
    const firstData = firstBody.data as Record<string, unknown>;
    assert.equal(firstData.trigger, "api");
    const triggerContext = firstData.triggerContext as Record<string, unknown>;
    assert.equal(triggerContext.route, "/cli/runtime-chat");
    assert.equal(triggerContext.method, "CLI");
    assert.equal(triggerContext.requestId, "req_001");
    assert.equal(triggerContext.caller, "clarity-agent-cli");

    assert.equal(secondBody.kind, "agent.run_started");
    assert.equal(secondBody.service_id, "svc_abc");
    assert.equal(secondBody.run_id, "run_cli_001");
  } finally {
    await close();
  }
});

test("submitRuntimeHitlInput posts to run-specific endpoint", async () => {
  const captured: CapturedRequest[] = [];
  const { baseUrl, close } = await startMockRuntimeServer((req) => {
    captured.push(req);
    if (req.method === "POST" && req.path === "/api/agents/runs/run_cli_001/hitl") {
      return {
        body: {
          ok: true,
          runId: "run_cli_001",
          kind: "agent.hitl_input"
        }
      };
    }
    return { status: 404, body: { error: "not found" } };
  });

  try {
    const out = await submitRuntimeHitlInput(baseUrl, {
      runId: "run_cli_001",
      message: "Hello agent",
      serviceId: "svc_abc",
      agent: "coordinator"
    });
    assert.equal(out.ok, true);
    assert.equal(out.runId, "run_cli_001");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].path, "/api/agents/runs/run_cli_001/hitl");
    const body = captured[0].body as Record<string, unknown>;
    assert.equal(body.message, "Hello agent");
    assert.equal(body.service_id, "svc_abc");
    assert.equal(body.agent, "coordinator");
  } finally {
    await close();
  }
});

test("getRuntimeRun and listRuntimeRunEvents parse run data", async () => {
  const { baseUrl, close } = await startMockRuntimeServer((req) => {
    if (req.method === "GET" && req.path.startsWith("/api/agents/runs?")) {
      return {
        body: {
          items: [
            {
              runId: "run_a",
              agent: "coordinator",
              serviceId: "svc_abc",
              status: "running",
              trigger: "api",
              updatedAt: "2026-02-24T10:00:00.000Z",
              lastEventKind: "agent.waiting",
              lastEventMessage: "Awaiting input"
            }
          ]
        }
      };
    }
    if (req.method === "GET" && req.path === "/api/agents/runs/run_a/events?limit=200") {
      return {
        body: {
          runId: "run_a",
          items: [
            {
              seq: 7,
              at: "2026-02-24T10:00:00.000Z",
              kind: "agent.waiting",
              level: "info",
              message: "Awaiting input",
              data: {
                runId: "run_a",
                reason: "Need approval"
              }
            }
          ]
        }
      };
    }
    return { status: 404, body: { error: "not found" } };
  });

  try {
    const run = await getRuntimeRun(baseUrl, "run_a");
    assert.ok(run);
    assert.equal(run?.status, "running");
    assert.equal(run?.serviceId, "svc_abc");

    const events = await listRuntimeRunEvents(baseUrl, "run_a");
    assert.equal(events.length, 1);
    assert.equal(events[0].seq, 7);
    assert.equal(events[0].kind, "agent.waiting");
    assert.equal(events[0].data.reason, "Need approval");
  } finally {
    await close();
  }
});

test("streamRuntimeEvents parses SSE payloads", async () => {
  const { baseUrl, close } = await startMockSseServer();

  try {
    const received: Array<{ kind: string; runId: string | undefined }> = [];
    await streamRuntimeEvents(baseUrl, {
      onEvent: async (event) => {
        const runId = typeof event.data.runId === "string" ? event.data.runId : undefined;
        received.push({ kind: event.kind, runId });
      }
    });

    assert.equal(received.length, 2);
    assert.equal(received[0].kind, "agent.waiting");
    assert.equal(received[0].runId, "run_stream_1");
    assert.equal(received[1].kind, "agent.run_completed");
    assert.equal(received[1].runId, "run_stream_1");
  } finally {
    await close();
  }
});

test("streamRuntimeRunEvents parses run-scoped SSE payloads", async () => {
  const { baseUrl, close } = await startMockRunScopedSseServer();

  try {
    const received: Array<{ kind: string; runId: string | undefined }> = [];
    await streamRuntimeRunEvents(baseUrl, "run_stream_1", {
      onEvent: async (event) => {
        const runId = typeof event.data.runId === "string" ? event.data.runId : undefined;
        received.push({ kind: event.kind, runId });
      }
    });

    assert.equal(received.length, 2);
    assert.equal(received[0].kind, "agent.waiting");
    assert.equal(received[0].runId, "run_stream_1");
    assert.equal(received[1].kind, "agent.run_completed");
    assert.equal(received[1].runId, "run_stream_1");
  } finally {
    await close();
  }
});
