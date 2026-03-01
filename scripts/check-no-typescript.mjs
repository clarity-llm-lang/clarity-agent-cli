import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const skip = new Set([".git", "node_modules", "dist", "coverage"]);
const tsFiles = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      tsFiles.push(path.relative(root, full));
    }
  }
}

walk(root);

if (tsFiles.length > 0) {
  console.error("TypeScript files are not allowed in the native Clarity implementation:");
  for (const file of tsFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log("No TypeScript files found.");
