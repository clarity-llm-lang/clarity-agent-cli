import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

export interface PromptOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function promptLine(question: string, options: PromptOptions = {}): Promise<string> {
  const rl = readline.createInterface({
    input: options.input ?? stdin,
    output: options.output ?? stdout
  });
  try {
    const out = await rl.question(question);
    return out;
  } finally {
    rl.close();
  }
}
