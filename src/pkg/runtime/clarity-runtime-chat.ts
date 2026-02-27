import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLARITY_BIN_CANDIDATES = ["clarityc", "clarity"];

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const clarityRuntimeChatScript = path.resolve(thisDir, "../../../clarity/runtime-chat/main.clarity");

export interface ClarityRuntimeChatInput {
  runtimeUrlArg?: string;
  serviceIdArg?: string;
  token?: string;
  pollMs?: number;
  eventsLimit?: number;
  stream?: boolean;
  runId?: string;
  agent?: string;
}

function resolveBridgeBinary(): string {
  const envOverride = process.env.CLARITYC_BIN?.trim();
  if (envOverride && envOverride.length > 0) {
    return envOverride;
  }
  return CLARITY_BIN_CANDIDATES[0];
}

function appendFlagArg(args: string[], flag: string, value: string | undefined): void {
  const normalized = value?.trim();
  if (!normalized || normalized.length === 0) {
    return;
  }
  args.push(flag, normalized);
}

function appendFlagInt(args: string[], flag: string, value: number | undefined): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }
  args.push(flag, String(Math.max(1, Math.floor(value))));
}

async function ensureScriptExists(): Promise<void> {
  await access(clarityRuntimeChatScript);
}

function buildProgramArgs(input: ClarityRuntimeChatInput): string[] {
  const out: string[] = [];
  const runtimeUrl = input.runtimeUrlArg?.trim();
  if (runtimeUrl && runtimeUrl.length > 0) {
    out.push(runtimeUrl);
  }
  appendFlagArg(out, "--token", input.token);
  appendFlagInt(out, "--poll-ms", input.pollMs);
  if (input.stream === false) {
    out.push("--no-stream");
  }
  return out;
}

function printUnsupportedOptionWarnings(input: ClarityRuntimeChatInput): void {
  if (input.serviceIdArg?.trim()) {
    process.stdout.write(
      "Clarity runtime-chat uses runtime discovery + numbered selection. Ignoring positional service-id.\n"
    );
  }
  if (input.agent?.trim()) {
    process.stdout.write("Clarity runtime-chat resolves agent from selected service. Ignoring --agent.\n");
  }
  if (input.runId?.trim()) {
    process.stdout.write("Clarity runtime-chat currently creates a fresh run per session. Ignoring --run-id.\n");
  }
  if (typeof input.eventsLimit === "number") {
    process.stdout.write("Clarity runtime-chat currently uses a fixed event page size. Ignoring --events-limit.\n");
  }
}

export async function runRuntimeChatViaClarity(input: ClarityRuntimeChatInput): Promise<void> {
  await ensureScriptExists();
  printUnsupportedOptionWarnings(input);

  const clarityBin = resolveBridgeBinary();
  const programArgs = buildProgramArgs(input);
  const clarityArgs = ["run", clarityRuntimeChatScript, "-f", "main", ...(programArgs.length > 0 ? ["-a", ...programArgs] : [])];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(clarityBin, clarityArgs, {
      stdio: "inherit",
      env: process.env
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Native Clarity bridge requires '${clarityBin}' in PATH. Install clarity-lang or set CLARITYC_BIN.`
          )
        );
        return;
      }
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Clarity runtime-chat terminated by signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`Clarity runtime-chat exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}
