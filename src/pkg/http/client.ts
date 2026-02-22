export interface RemoteQuestion {
  key: string;
  question: string;
  timestamp: number;
  pid?: number;
  ageSeconds?: number;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("broker url is required");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, "");
  }
  return `http://${trimmed}`.replace(/\/$/, "");
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

export async function listRemoteQuestions(
  baseUrl: string,
  token?: string
): Promise<RemoteQuestion[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/questions`;
  const response = await fetch(url, {
    headers: {
      ...authHeaders(token)
    }
  });
  if (!response.ok) {
    throw new Error(`GET /questions failed (${response.status})`);
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      if (typeof row.key !== "string" || typeof row.question !== "string") {
        return null;
      }
      const timestamp =
        typeof row.timestamp === "number" && Number.isFinite(row.timestamp)
          ? row.timestamp
          : Date.now();
      return {
        key: row.key,
        question: row.question,
        timestamp,
        ...(typeof row.pid === "number" && Number.isFinite(row.pid) ? { pid: row.pid } : {}),
        ...(typeof row.ageSeconds === "number" && Number.isFinite(row.ageSeconds)
          ? { ageSeconds: row.ageSeconds }
          : {})
      } satisfies RemoteQuestion;
    })
    .filter((item): item is RemoteQuestion => item !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function answerRemoteQuestion(
  baseUrl: string,
  key: string,
  responseText: string,
  token?: string
): Promise<void> {
  const url = `${normalizeBaseUrl(baseUrl)}/answer`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify({
      key,
      response: responseText
    })
  });
  if (!response.ok) {
    throw new Error(`POST /answer failed (${response.status})`);
  }
}

export async function cancelRemoteQuestion(
  baseUrl: string,
  key: string,
  token?: string
): Promise<void> {
  const url = `${normalizeBaseUrl(baseUrl)}/cancel`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify({ key })
  });
  if (!response.ok) {
    throw new Error(`POST /cancel failed (${response.status})`);
  }
}
