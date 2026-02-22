import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHitlServer } from "../pkg/http/server.js";

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

test("HTTP broker endpoints question lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarity-agent-cli-http-"));
  const { baseUrl, close } = await startServer({
    dir: path.join(root, "hitl")
  });

  try {
    const createRes = await fetch(`${baseUrl}/questions`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        key: "review-step-3",
        question: "Does this summary look correct?"
      })
    });
    assert.equal(createRes.status, 200);

    const listRes = await fetch(`${baseUrl}/questions`);
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as Array<Record<string, unknown>>;
    assert.equal(Array.isArray(listBody), true);
    assert.equal(listBody.length, 1);
    assert.equal(listBody[0].key, "review-step-3");

    const answerRes = await fetch(`${baseUrl}/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        key: "review-step-3",
        response: "Proceed"
      })
    });
    assert.equal(answerRes.status, 200);

    const stateRes = await fetch(`${baseUrl}/questions/review-step-3`);
    assert.equal(stateRes.status, 200);
    const stateBody = (await stateRes.json()) as Record<string, unknown>;
    assert.equal(stateBody.status, "answered");
    assert.equal(stateBody.response, "Proceed");

    const cancelRes = await fetch(`${baseUrl}/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        key: "review-step-3"
      })
    });
    assert.equal(cancelRes.status, 200);

    const missingRes = await fetch(`${baseUrl}/questions/review-step-3`);
    assert.equal(missingRes.status, 200);
    const missingBody = (await missingRes.json()) as Record<string, unknown>;
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
    const deniedRes = await fetch(`${baseUrl}/questions`);
    assert.equal(deniedRes.status, 401);

    const allowedRes = await fetch(`${baseUrl}/questions`, {
      headers: {
        Authorization: "Bearer secret-token"
      }
    });
    assert.equal(allowedRes.status, 200);
  } finally {
    await close();
  }
});
