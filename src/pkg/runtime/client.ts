export interface RuntimeAgentProfile {
  agentId: string;
  name: string;
  role?: string;
  objective?: string;
  triggers: string[];
}

export interface RuntimeAgentRegistryItem {
  serviceId: string;
  displayName?: string;
  lifecycle: string;
  health: string;
  originType?: string;
  agent: RuntimeAgentProfile;
}

export interface RuntimeRunSummary {
  runId: string;
  agent: string;
  serviceId?: string;
  status: string;
  trigger?: string;
  updatedAt: string;
  lastEventKind?: string;
  lastEventMessage?: string;
}

export interface RuntimeRunEvent {
  seq?: number;
  at: string;
  kind: string;
  level: string;
  message: string;
  serviceId?: string;
  data: Record<string, unknown>;
}

export interface RuntimeEventsStreamOptions {
  token?: string;
  signal?: AbortSignal;
  onOpen?: () => void;
  onEvent: (event: RuntimeRunEvent) => void | Promise<void>;
}

export interface RuntimeAgentEventInput {
  kind: string;
  level?: "info" | "warn" | "error";
  message?: string;
  serviceId?: string;
  runId?: string;
  stepId?: string;
  agent?: string;
  data?: Record<string, unknown>;
}

export interface StartRuntimeApiRunInput {
  serviceId: string;
  runId: string;
  agent: string;
  route?: string;
  method?: string;
  requestId?: string;
  caller?: string;
}

export interface RuntimeHitlInput {
  runId: string;
  message: string;
  serviceId?: string;
  agent?: string;
  kind?: string;
}

export interface RuntimeHitlResponse {
  ok?: boolean;
  runId?: string;
  kind?: string;
  serviceId?: string;
  agent?: string;
  message_truncated?: boolean;
  message_redacted?: boolean;
}

interface RequestOptions {
  method?: "GET" | "POST";
  token?: string;
  body?: unknown;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as Record<string, unknown>;
}

function asString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => asString(item))
    .filter((item): item is string => typeof item === "string");
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("runtime url is required");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  return `http://${trimmed}`.replace(/\/+$/, "");
}

function withRoute(baseUrl: string, route: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  return `${normalized}${normalizedRoute}`;
}

function authHeaders(token?: string): Record<string, string> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return {};
  }
  return {
    Authorization: `Bearer ${trimmed}`
  };
}

async function readResponseError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as unknown;
      const obj = asRecord(payload);
      const error = asString(obj.error);
      if (error) {
        return error;
      }
    } catch {
      return `request failed with status ${response.status}`;
    }
  }
  try {
    const text = (await response.text()).trim();
    if (text.length > 0) {
      return text;
    }
  } catch {
    return `request failed with status ${response.status}`;
  }
  return `request failed with status ${response.status}`;
}

async function requestJson<T>(
  baseUrl: string,
  route: string,
  options: RequestOptions = {}
): Promise<T> {
  const hasBody = typeof options.body !== "undefined";
  const response = await fetch(withRoute(baseUrl, route), {
    method: options.method ?? (hasBody ? "POST" : "GET"),
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...authHeaders(options.token)
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {})
  });

  if (!response.ok) {
    const reason = await readResponseError(response);
    throw new Error(
      `${options.method ?? (hasBody ? "POST" : "GET")} ${route} failed (${response.status}): ${reason}`
    );
  }

  return (await response.json()) as T;
}

function parseRuntimeRunEvent(input: unknown): RuntimeRunEvent | null {
  const row = asRecord(input);
  const kind = asString(row.kind);
  if (!kind) {
    return null;
  }
  const seq = typeof row.seq === "number" && Number.isFinite(row.seq) ? row.seq : undefined;
  return {
    ...(typeof seq === "number" ? { seq } : {}),
    at: asString(row.at) ?? new Date(0).toISOString(),
    kind,
    level: asString(row.level) ?? "info",
    message: asString(row.message) ?? kind,
    ...(asString(row.serviceId) ? { serviceId: asString(row.serviceId) } : {}),
    data: asRecord(row.data)
  };
}

export async function listRuntimeAgents(
  baseUrl: string,
  token?: string
): Promise<RuntimeAgentRegistryItem[]> {
  const payload = (await requestJson<unknown>(baseUrl, "/api/agents/registry", {
    token
  })) as unknown;
  const root = asRecord(payload);
  const rawItems = Array.isArray(root.items) ? root.items : [];
  const items: RuntimeAgentRegistryItem[] = [];

  for (const rawItem of rawItems) {
    const row = asRecord(rawItem);
    const serviceId = asString(row.serviceId);
    if (!serviceId) {
      continue;
    }
    const agentRow = asRecord(row.agent);
    const agentId = asString(agentRow.agentId) ?? "";
    const name = asString(agentRow.name) ?? "";
    items.push({
      serviceId,
      ...(asString(row.displayName) ? { displayName: asString(row.displayName) } : {}),
      lifecycle: asString(row.lifecycle) ?? "UNKNOWN",
      health: asString(row.health) ?? "UNKNOWN",
      ...(asString(row.originType) ? { originType: asString(row.originType) } : {}),
      agent: {
        agentId,
        name,
        ...(asString(agentRow.role) ? { role: asString(agentRow.role) } : {}),
        ...(asString(agentRow.objective) ? { objective: asString(agentRow.objective) } : {}),
        triggers: asStringList(agentRow.triggers)
      }
    });
  }

  return items.sort((a, b) => a.serviceId.localeCompare(b.serviceId));
}

export async function listRuntimeRuns(
  baseUrl: string,
  token?: string,
  limit = 100
): Promise<RuntimeRunSummary[]> {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 2000) : 100;
  const payload = await requestJson<unknown>(baseUrl, `/api/agents/runs?limit=${safeLimit}`, {
    token
  });
  const root = asRecord(payload);
  const rawItems = Array.isArray(root.items) ? root.items : [];
  const items: RuntimeRunSummary[] = [];

  for (const rawItem of rawItems) {
    const row = asRecord(rawItem);
    const runId = asString(row.runId);
    if (!runId) {
      continue;
    }
    items.push({
      runId,
      agent: asString(row.agent) ?? "unknown",
      ...(asString(row.serviceId) ? { serviceId: asString(row.serviceId) } : {}),
      status: asString(row.status) ?? "unknown",
      ...(asString(row.trigger) ? { trigger: asString(row.trigger) } : {}),
      updatedAt: asString(row.updatedAt) ?? new Date(0).toISOString(),
      ...(asString(row.lastEventKind) ? { lastEventKind: asString(row.lastEventKind) } : {}),
      ...(asString(row.lastEventMessage)
        ? { lastEventMessage: asString(row.lastEventMessage) }
        : {})
    });
  }

  return items;
}

export async function getRuntimeRun(
  baseUrl: string,
  runId: string,
  token?: string
): Promise<RuntimeRunSummary | null> {
  const target = runId.trim();
  if (!target) {
    return null;
  }
  const runs = await listRuntimeRuns(baseUrl, token, 2000);
  for (const run of runs) {
    if (run.runId === target) {
      return run;
    }
  }
  return null;
}

export async function listRuntimeRunEvents(
  baseUrl: string,
  runId: string,
  token?: string,
  limit = 200
): Promise<RuntimeRunEvent[]> {
  const safeRunId = runId.trim();
  if (!safeRunId) {
    throw new Error("run id is required");
  }
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 5000) : 200;
  const payload = await requestJson<unknown>(
    baseUrl,
    `/api/agents/runs/${encodeURIComponent(safeRunId)}/events?limit=${safeLimit}`,
    { token }
  );
  const root = asRecord(payload);
  const rawItems = Array.isArray(root.items) ? root.items : [];
  const items = rawItems
    .map((rawItem) => parseRuntimeRunEvent(rawItem))
    .filter((item): item is RuntimeRunEvent => item !== null);

  return items;
}

export async function streamRuntimeEvents(
  baseUrl: string,
  options: RuntimeEventsStreamOptions
): Promise<void> {
  const response = await fetch(withRoute(baseUrl, "/api/events"), {
    method: "GET",
    headers: {
      accept: "text/event-stream",
      ...authHeaders(options.token)
    },
    signal: options.signal
  });

  if (!response.ok) {
    const reason = await readResponseError(response);
    throw new Error(`GET /api/events failed (${response.status}): ${reason}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("stream response body is unavailable");
  }

  options.onOpen?.();

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const flushEvent = async (): Promise<void> => {
    if (dataLines.length === 0) {
      return;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    try {
      const parsed = JSON.parse(payload) as unknown;
      const event = parseRuntimeRunEvent(parsed);
      if (event) {
        await options.onEvent(event);
      }
    } catch {
      // Ignore malformed events and continue stream processing.
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length === 0) {
          await flushEvent();
          continue;
        }
        if (line.startsWith(":")) {
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const tail = buffer.replace(/\r$/, "");
      if (tail.startsWith("data:")) {
        dataLines.push(tail.slice(5).trimStart());
      }
    }
    await flushEvent();
  } catch (error) {
    if (
      options.signal?.aborted &&
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError"
    ) {
      return;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function postRuntimeAgentEvent(
  baseUrl: string,
  event: RuntimeAgentEventInput,
  token?: string
): Promise<void> {
  const kind = event.kind.trim();
  if (!kind.startsWith("agent.")) {
    throw new Error(`invalid event kind: ${event.kind}`);
  }

  await requestJson<Record<string, unknown>>(baseUrl, "/api/agents/events", {
    method: "POST",
    token,
    body: {
      kind,
      level: event.level ?? "info",
      ...(event.message ? { message: event.message } : {}),
      ...(event.serviceId ? { service_id: event.serviceId } : {}),
      ...(event.runId ? { run_id: event.runId } : {}),
      ...(event.stepId ? { step_id: event.stepId } : {}),
      ...(event.agent ? { agent: event.agent } : {}),
      ...(event.data ? { data: event.data } : {})
    }
  });
}

export async function startRuntimeApiRun(
  baseUrl: string,
  input: StartRuntimeApiRunInput,
  token?: string
): Promise<void> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("run id is required");
  }
  const serviceId = input.serviceId.trim();
  if (!serviceId) {
    throw new Error("service id is required");
  }
  const agent = input.agent.trim();
  if (!agent) {
    throw new Error("agent id is required");
  }

  const triggerContext = {
    route: input.route?.trim() || "/cli/runtime-chat",
    method: input.method?.trim() || "CLI",
    requestId: input.requestId?.trim() || runId,
    caller: input.caller?.trim() || "clarity-agent-cli"
  };

  await postRuntimeAgentEvent(
    baseUrl,
    {
      kind: "agent.run_created",
      serviceId,
      runId,
      agent,
      message: `agent.run_created (${runId})`,
      data: {
        runId,
        serviceId,
        agent,
        trigger: "api",
        triggerContext,
        route: triggerContext.route,
        method: triggerContext.method,
        requestId: triggerContext.requestId,
        caller: triggerContext.caller
      }
    },
    token
  );

  await postRuntimeAgentEvent(
    baseUrl,
    {
      kind: "agent.run_started",
      serviceId,
      runId,
      agent,
      message: `agent.run_started (${runId})`,
      data: {
        runId,
        serviceId,
        agent,
        trigger: "api",
        triggerContext
      }
    },
    token
  );
}

export async function submitRuntimeHitlInput(
  baseUrl: string,
  input: RuntimeHitlInput,
  token?: string
): Promise<RuntimeHitlResponse> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("run id is required");
  }
  const message = input.message.trim();
  if (!message) {
    throw new Error("message is required");
  }
  return await requestJson<RuntimeHitlResponse>(
    baseUrl,
    `/api/agents/runs/${encodeURIComponent(runId)}/hitl`,
    {
      method: "POST",
      token,
      body: {
        message,
        ...(input.serviceId ? { service_id: input.serviceId } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.kind ? { kind: input.kind } : {})
      }
    }
  );
}

export function isTerminalRunStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "completed" || normalized === "failed" || normalized === "cancelled";
}
