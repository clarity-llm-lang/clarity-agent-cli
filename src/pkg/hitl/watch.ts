import { appendAuditLine } from "../audit/log.js";
import {
  answerQuestion,
  BrokerOptions,
  HitlQuestion,
  listQuestions,
  resolveHitlDir
} from "./broker.js";
import { promptLine } from "../tty/prompt.js";

export interface WatchOptions {
  dir?: string;
  timeoutSeconds?: number;
  autoApprove?: boolean;
  logFile?: string;
  pollMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toBrokerOptions(options: WatchOptions): BrokerOptions {
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

function ageLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatPrompt(question: HitlQuestion): string {
  const lines = question.question.split(/\r?\n/);
  const header = `HITL request: ${question.key}`;
  const width = Math.max(header.length + 2, ...lines.map((line) => line.length + 2), 36);
  const border = "=".repeat(width);
  const out: string[] = [];
  out.push(`+${border}+`);
  out.push(`| ${header.padEnd(width - 1, " ")}|`);
  out.push(`+${border}+`);
  if (lines.length === 0) {
    out.push(`| ${"".padEnd(width - 1, " ")}|`);
  }
  for (const line of lines) {
    out.push(`| ${line.slice(0, width - 1).padEnd(width - 1, " ")}|`);
  }
  out.push(`+${border}+`);
  return out.join("\n");
}

export async function runWatch(options: WatchOptions = {}): Promise<void> {
  const output = options.output ?? process.stdout;
  const pollMs = Math.max(250, options.pollMs ?? 1000);
  const timeoutSeconds = options.timeoutSeconds;
  const brokerOptions = toBrokerOptions(options);
  const seen = new Set<string>();
  const hitlDir = resolveHitlDir(brokerOptions);

  output.write(`Watching HITL directory: ${hitlDir}\n`);

  while (true) {
    try {
      const pending = (await listQuestions(brokerOptions))
        .filter((item) => !item.answered)
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const question of pending) {
        const marker = `${question.safeKey}:${question.timestamp}`;
        if (seen.has(marker)) {
          continue;
        }

        if (
          typeof timeoutSeconds === "number" &&
          timeoutSeconds >= 0 &&
          question.ageSeconds > timeoutSeconds
        ) {
          seen.add(marker);
          output.write(
            `[${new Date().toISOString()}] skipped ${question.key} (age ${ageLabel(question.ageSeconds)} exceeds timeout ${timeoutSeconds}s)\n`
          );
          continue;
        }

        output.write(`\n${formatPrompt(question)}\n`);
        output.write(`Age: ${ageLabel(question.ageSeconds)}\n`);

        let response = "";
        if (options.autoApprove) {
          output.write("Auto-approve enabled: submitting empty response.\n");
        } else {
          response = await promptLine("Answer (Enter to confirm): ", {
            input: options.input,
            output
          });
        }

        await answerQuestion(question.safeKey, response, brokerOptions);
        seen.add(marker);

        const nowIso = new Date().toISOString();
        output.write(`[${nowIso}] answered ${question.key}\n`);

        if (options.logFile) {
          await appendAuditLine(options.logFile, {
            type: "answered",
            key: question.key,
            timestamp: nowIso,
            details: {
              safeKey: question.safeKey,
              responseLength: response.length,
              ageSeconds: question.ageSeconds
            }
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.write(`[${new Date().toISOString()}] watch loop error: ${message}\n`);
    }

    await wait(pollMs);
  }
}
