import { IncomingMessage, ServerResponse, createServer } from "node:http";
import {
  answerQuestion,
  BrokerOptions,
  cancelQuestion,
  getQuestionByKey,
  listBrokerState,
  listQuestions,
  readQuestionState,
  submitQuestion
} from "../hitl/broker.js";
import { buildUiPage } from "../ui/page.js";

export interface HitlServerOptions {
  dir?: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

function brokerOptions(options: HitlServerOptions): BrokerOptions {
  const env = options.env ?? process.env;
  if (!options.dir) {
    return {
      env,
      cwd: options.cwd ?? process.cwd()
    };
  }
  return {
    env: {
      ...env,
      CLARITY_HITL_DIR: options.dir
    },
    cwd: options.cwd ?? process.cwd()
  };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload)}\n`);
}

function extractToken(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const xToken = req.headers["x-clarity-token"];
  if (typeof xToken === "string" && xToken.trim().length > 0) {
    return xToken.trim();
  }
  const queryToken = url.searchParams.get("token");
  if (queryToken && queryToken.trim().length > 0) {
    return queryToken.trim();
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readJsonBody(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: string[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  const raw = chunks.join("").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as JsonRecord;
}

function denied(res: ServerResponse): void {
  json(res, 401, { error: "unauthorized" });
}

function methodNotAllowed(res: ServerResponse): void {
  json(res, 405, { error: "method not allowed" });
}

export function createHitlServer(options: HitlServerOptions = {}) {
  return createServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://localhost");
    const expectedToken = normalizeString(options.token);
    const openRoute = method === "GET" && (url.pathname === "/" || url.pathname === "/health");

    if (expectedToken && !openRoute) {
      const incomingToken = extractToken(req, url);
      if (incomingToken !== expectedToken) {
        denied(res);
        return;
      }
    }

    const sharedOptions = brokerOptions(options);

    if (method === "GET" && url.pathname === "/") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(buildUiPage());
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/questions") {
      const questions = await listQuestions(sharedOptions);
      json(
        res,
        200,
        questions
          .filter((item) => !item.answered)
          .map((item) => ({
            key: item.key,
            question: item.question,
            timestamp: item.timestamp,
            ...(item.pid !== undefined ? { pid: item.pid } : {}),
            ageSeconds: item.ageSeconds
          }))
      );
      return;
    }

    const byKey = url.pathname.match(/^\/questions\/([^/]+)$/);
    if (method === "GET" && byKey) {
      const key = decodeURIComponent(byKey[1]);
      json(res, 200, await readQuestionState(key, sharedOptions));
      return;
    }

    if (method === "POST" && url.pathname === "/questions") {
      const body = await readJsonBody(req);
      const key = normalizeString(body.key);
      const question = normalizeString(body.question);
      if (!key || !question) {
        json(res, 400, { error: "expected { key, question }" });
        return;
      }
      const out = await submitQuestion(
        {
          key,
          question,
          ...(typeof body.timestamp === "number" && Number.isFinite(body.timestamp)
            ? { timestamp: body.timestamp }
            : {}),
          ...(typeof body.pid === "number" && Number.isFinite(body.pid) ? { pid: body.pid } : {})
        },
        sharedOptions
      );
      json(res, 200, out);
      return;
    }

    if (method === "POST" && url.pathname === "/answer") {
      const body = await readJsonBody(req);
      const key = normalizeString(body.key);
      if (!key || typeof body.response !== "string") {
        json(res, 400, { error: "expected { key, response }" });
        return;
      }
      const exists = await getQuestionByKey(key, sharedOptions);
      if (!exists) {
        json(res, 404, { error: `question not found: ${key}` });
        return;
      }
      json(res, 200, await answerQuestion(key, body.response, sharedOptions));
      return;
    }

    if (method === "POST" && url.pathname === "/cancel") {
      const body = await readJsonBody(req);
      const key = normalizeString(body.key);
      if (!key) {
        json(res, 400, { error: "expected { key }" });
        return;
      }
      json(res, 200, await cancelQuestion(key, sharedOptions));
      return;
    }

    if (method === "GET" && url.pathname === "/events") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-cache");
      res.setHeader("connection", "keep-alive");

      const writeEvent = (event: unknown): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      let previous = await listBrokerState(sharedOptions);
      const initial = await listQuestions(sharedOptions);
      for (const question of initial.filter((item) => !item.answered)) {
        writeEvent({
          type: "new_question",
          key: question.key,
          timestamp: question.timestamp
        });
      }

      const interval = setInterval(async () => {
        try {
          const current = await listBrokerState(sharedOptions);
          for (const [safeKey, row] of current.entries()) {
            const prev = previous.get(safeKey);
            if (!prev) {
              writeEvent({ type: "new_question", key: row.key });
              if (row.answered) {
                writeEvent({ type: "answered", key: row.key });
              }
              continue;
            }
            if (!prev.answered && row.answered) {
              writeEvent({ type: "answered", key: row.key });
            }
            if (row.questionMtimeMs > prev.questionMtimeMs) {
              writeEvent({ type: "new_question", key: row.key });
            }
          }
          previous = current;
        } catch {
          // Keep the SSE stream alive even if a polling pass fails.
        }
      }, 1000);

      const keepAlive = setInterval(() => {
        res.write(": ping\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(interval);
        clearInterval(keepAlive);
      });
      return;
    }

    if (["GET", "POST"].includes(method)) {
      json(res, 404, { error: `not found: ${url.pathname}` });
      return;
    }

    methodNotAllowed(res);
  });
}

export async function listenHitlServer(
  port: number,
  options: HitlServerOptions = {}
): Promise<{ close: () => Promise<void> }> {
  const server = createHitlServer(options);
  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      resolve();
    });
  });
  return {
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
