import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHitlServer } from "../pkg/http/server.js";

interface JsonResponse {
  status: number;
  body: unknown;
}

async function startServer(options: { dir: string; token?: string }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createHitlServer(options);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind server");
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

async function jsonRequest(
  baseUrl: string,
  route: string,
  options: {
    method?: "GET" | "POST";
    token?: string;
    body?: unknown;
  } = {}
): Promise<JsonResponse> {
  const target = new URL(route, baseUrl);
  const hasBody = typeof options.body !== "undefined";
  const payload = hasBody ? JSON.stringify(options.body) : null;

  return await new Promise<JsonResponse>((resolve, reject) => {
    const req = http.request(
      target,
      {
        method: options.method ?? (hasBody ? "POST" : "GET"),
        headers: {
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload).toString()
              }
            : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        agent: false
      },
      (res) => {
        const parts: string[] = [];
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          parts.push(chunk);
        });
        res.on("end", () => {
          const text = parts.join("").trim();
          let body: unknown = text;
          if (text.length > 0) {
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            body
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test("HTTP broker endpoints question lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-cli-http-"));
  const { baseUrl, close } = await startServer({
    dir: path.join(root, "hitl")
  });

  try {
    const createRes = await jsonRequest(baseUrl, "/questions", {
      method: "POST",
      body: {
        key: "review-step-3",
        question: "Does this summary look correct?"
      }
    });
    assert.equal(createRes.status, 200);

    const listRes = await jsonRequest(baseUrl, "/questions");
    assert.equal(listRes.status, 200);
    assert.equal(Array.isArray(listRes.body), true);
    const listBody = listRes.body as Array<Record<string, unknown>>;
    assert.equal(listBody.length, 1);
    assert.equal(listBody[0].key, "review-step-3");

    const answerRes = await jsonRequest(baseUrl, "/answer", {
      method: "POST",
      body: {
        key: "review-step-3",
        response: "Proceed"
      }
    });
    assert.equal(answerRes.status, 200);

    const stateRes = await jsonRequest(baseUrl, "/questions/review-step-3");
    assert.equal(stateRes.status, 200);
    const stateBody = stateRes.body as Record<string, unknown>;
    assert.equal(stateBody.status, "answered");
    assert.equal(stateBody.response, "Proceed");

    const cancelRes = await jsonRequest(baseUrl, "/cancel", {
      method: "POST",
      body: {
        key: "review-step-3"
      }
    });
    assert.equal(cancelRes.status, 200);

    const missingRes = await jsonRequest(baseUrl, "/questions/review-step-3");
    assert.equal(missingRes.status, 200);
    const missingBody = missingRes.body as Record<string, unknown>;
    assert.equal(missingBody.status, "missing");
  } finally {
    await close();
  }
});

test("token-protected endpoints reject unauthorized requests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-cli-token-"));
  const { baseUrl, close } = await startServer({
    dir: path.join(root, "hitl"),
    token: "secret-token"
  });

  try {
    const deniedRes = await jsonRequest(baseUrl, "/questions");
    assert.equal(deniedRes.status, 401);

    const allowedRes = await jsonRequest(baseUrl, "/questions", {
      token: "secret-token"
    });
    assert.equal(allowedRes.status, 200);
  } finally {
    await close();
  }
});
