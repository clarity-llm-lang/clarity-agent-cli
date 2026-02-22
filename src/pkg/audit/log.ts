import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface AuditEntry {
  type: string;
  key: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export async function appendAuditLine(filePath: string, entry: AuditEntry): Promise<void> {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(resolved, line, "utf8");
}
