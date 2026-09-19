import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

function loadProblem(id) {
  const dir = join(root, id);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const prompt = readFileSync(join(dir, "prompt.md"), "utf8");
  const starters = {};
  for (const file of readdirSync(dir)) {
    if (file.startsWith("starter.")) {
      const ext = file.slice("starter.".length);
      starters[ext] = readFileSync(join(dir, file), "utf8");
    }
  }
  return { ...meta, id, prompt, starters };
}

export function listProblems() {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "meta.json")))
    .map((d) => loadProblem(d.name))
    .sort((a, b) => a.order - b.order);
}

export function getProblem(id) {
  return listProblems().find((p) => p.id === id) ?? null;
}
