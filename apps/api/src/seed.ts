import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const root = dirname(fileURLToPath(import.meta.url));
const problemsRoot = join(root, "..", "..", "..", "packages", "problems");

const samples = [
  {
    id: "order-book",
    title: "Build a crypto order book",
    summary: "Aggregated order book with snapshot, incremental updates, and best bid/ask.",
    timeboxMinutes: 45,
    language: "py",
    sortOrder: 1,
    dir: "order-book",
  },
  {
    id: "risk-engine",
    title: "Implement a pre-trade risk engine",
    summary: "Validate orders against balances, position limits, notional caps, and price bands.",
    timeboxMinutes: 25,
    language: "py",
    sortOrder: 2,
    dir: "risk-engine",
  },
];

const now = new Date().toISOString();

for (const sample of samples) {
  const promptText = readFileSync(join(problemsRoot, sample.dir, "prompt.md"), "utf8");
  const starterText = readFileSync(join(problemsRoot, sample.dir, "starter.py"), "utf8");
  const existing = db.prepare("SELECT id FROM problems WHERE id = ?").get(sample.id);

  if (existing) {
    db.prepare(
      `UPDATE problems
       SET title = ?, summary = ?, timebox_minutes = ?, language = ?,
           sort_order = ?, prompt_text = ?, starter_text = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      sample.title,
      sample.summary,
      sample.timeboxMinutes,
      sample.language,
      sample.sortOrder,
      promptText,
      starterText,
      now,
      sample.id,
    );
    console.log(`Updated problem: ${sample.id}`);
  } else {
    db.prepare(
      `INSERT INTO problems
        (id, title, summary, timebox_minutes, language, sort_order,
         prompt_text, starter_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sample.id,
      sample.title,
      sample.summary,
      sample.timeboxMinutes,
      sample.language,
      sample.sortOrder,
      promptText,
      starterText,
      now,
      now,
    );
    console.log(`Inserted problem: ${sample.id}`);
  }
}

const token = process.env.SEED_TOKEN ?? "demo-candidate";
const name = process.env.SEED_NAME ?? "Demo Candidate";
const email = process.env.SEED_EMAIL ?? "demo@example.com";
const problemIds = samples.map((s) => s.id);
const createdAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

const existingInvite = db.prepare("SELECT token FROM invites WHERE token = ?").get(token);
if (existingInvite) {
  db.prepare(
    `UPDATE invites
     SET candidate_name = ?, candidate_email = ?, problem_ids = ?, total_timebox_minutes = ?,
         expires_at = ?, submitted_at = NULL, exam_started_at = NULL, active_session_id = NULL,
         session_last_seen_at = NULL, closed_at = NULL, security_violations = 0
     WHERE token = ?`,
  ).run(name, email, JSON.stringify(problemIds), 90, expiresAt, token);
  db.prepare("DELETE FROM submissions WHERE invite_token = ?").run(token);
  console.log(`Reset invite: ${token}`);
} else {
  db.prepare(
    `INSERT INTO invites
      (token, candidate_name, candidate_email, problem_ids, total_timebox_minutes,
       exam_started_at, expires_at, created_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
  ).run(token, name, email, JSON.stringify(problemIds), 90, expiresAt, createdAt);
  console.log(`Created invite: ${token}`);
}

console.log(`Interview: http://localhost:5173/interview/${token}`);
console.log(`Admin: http://localhost:5173/admin (password required; not stored in browser)`);
