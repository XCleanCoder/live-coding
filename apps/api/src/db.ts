import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "..", "data");
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH ?? join(dataDir, "live-coding.sqlite");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS problems (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    timebox_minutes INTEGER,
    language TEXT NOT NULL DEFAULT 'py',
    sort_order INTEGER NOT NULL DEFAULT 0,
    prompt_text TEXT NOT NULL,
    starter_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    candidate_name TEXT NOT NULL,
    candidate_email TEXT,
    problem_ids TEXT NOT NULL,
    total_timebox_minutes INTEGER NOT NULL DEFAULT 90,
    exam_started_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    submitted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    invite_token TEXT NOT NULL,
    client TEXT NOT NULL,
    started_at TEXT,
    submitted_at TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT,
    auto_submitted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (invite_token) REFERENCES invites(token)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("invites", "total_timebox_minutes", "INTEGER NOT NULL DEFAULT 90");
ensureColumn("invites", "exam_started_at", "TEXT");
ensureColumn("invites", "active_session_id", "TEXT");
ensureColumn("invites", "session_last_seen_at", "TEXT");
ensureColumn("invites", "security_violations", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("invites", "security_json", "TEXT");
ensureColumn("invites", "closed_at", "TEXT");
ensureColumn("submissions", "auto_submitted", "INTEGER NOT NULL DEFAULT 0");

/** Candidate must ping within this window to count as online (Pending). */
export const SESSION_HEARTBEAT_TTL_MS = 18_000;

{
  const offlineCols = db.prepare("PRAGMA table_info(offline_sessions)").all() as Array<{
    name: string;
  }>;
  const hasOffline = offlineCols.length > 0;
  const hasDeviceSession = offlineCols.some((c) => c.name === "device_session_id");
  if (hasOffline && !hasDeviceSession) {
    db.exec("DROP TABLE offline_sessions");
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS offline_sessions (
    id TEXT PRIMARY KEY,
    candidate_name TEXT NOT NULL,
    candidate_email TEXT NOT NULL,
    device_session_id TEXT NOT NULL,
    total_timebox_minutes INTEGER NOT NULL DEFAULT 90,
    started_at TEXT NOT NULL,
    last_seen_at TEXT,
    submitted_at TEXT,
    closed_at TEXT,
    ended_at TEXT,
    camera_enabled INTEGER NOT NULL DEFAULT 0,
    snapshot_data TEXT,
    snapshot_at TEXT,
    answers_json TEXT,
    auto_submitted INTEGER NOT NULL DEFAULT 0,
    security_violations INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

export type OfflineSessionRow = {
  id: string;
  candidate_name: string;
  candidate_email: string;
  device_session_id: string;
  total_timebox_minutes: number;
  started_at: string;
  last_seen_at: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  ended_at: string | null;
  camera_enabled: number;
  snapshot_data: string | null;
  snapshot_at: string | null;
  answers_json: string | null;
  auto_submitted: number;
  security_violations: number;
  created_at: string;
};

export function offlineEndsAt(row: Pick<OfflineSessionRow, "started_at" | "total_timebox_minutes">) {
  const minutes = row.total_timebox_minutes ?? 90;
  return new Date(new Date(row.started_at).getTime() + minutes * 60_000).toISOString();
}

export function isOfflineSessionAlive(
  row: Pick<OfflineSessionRow, "last_seen_at">,
  nowMs = Date.now(),
  ttlMs = SESSION_HEARTBEAT_TTL_MS,
): boolean {
  if (!row.last_seen_at) return false;
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Number.isNaN(lastSeen)) return false;
  return nowMs - lastSeen < ttlMs;
}

export type OfflineSessionStatus = "Pending" | "Stop" | "Expired" | "Submitted";

export function computeOfflineSessionStatus(
  row: Pick<
    OfflineSessionRow,
    | "submitted_at"
    | "closed_at"
    | "started_at"
    | "total_timebox_minutes"
    | "last_seen_at"
  >,
  nowMs = Date.now(),
): OfflineSessionStatus {
  if (row.submitted_at) return "Submitted";
  if (row.closed_at) return "Expired";
  const endsAt = offlineEndsAt(row);
  if (new Date(endsAt).getTime() <= nowMs) return "Expired";
  return isOfflineSessionAlive(row, nowMs) ? "Pending" : "Stop";
}

/** Close offline exams that timed out while the candidate was offline (no answers saved). */
export function finalizeOfflineExpiredSessions(nowMs = Date.now()): number {
  const rows = db
    .prepare(
      `SELECT * FROM offline_sessions
       WHERE submitted_at IS NULL AND closed_at IS NULL`,
    )
    .all() as OfflineSessionRow[];

  let closed = 0;
  const closedAt = new Date(nowMs).toISOString();
  for (const row of rows) {
    const endsAt = offlineEndsAt(row);
    if (new Date(endsAt).getTime() > nowMs) continue;
    if (isOfflineSessionAlive(row, nowMs)) continue;
    db.prepare(
      `UPDATE offline_sessions
       SET closed_at = ?, ended_at = COALESCE(ended_at, ?)
       WHERE id = ? AND submitted_at IS NULL AND closed_at IS NULL`,
    ).run(closedAt, closedAt, row.id);
    closed += 1;
  }
  return closed;
}

export type InviteSecurity = {
  blockClipboard: boolean;
  blockMultiMonitor: boolean;
  blockFocusSwitch: boolean;
  cameraRequired: boolean;
  showCameraPreview: boolean;
};

export const DEFAULT_INVITE_SECURITY: InviteSecurity = {
  blockClipboard: true,
  blockMultiMonitor: true,
  blockFocusSwitch: true,
  cameraRequired: false,
  showCameraPreview: true,
};

export function normalizeInviteSecurity(input?: Partial<InviteSecurity> | null): InviteSecurity {
  const merged = { ...DEFAULT_INVITE_SECURITY, ...(input ?? {}) };
  // Required camera implies preview is enabled.
  if (merged.cameraRequired) merged.showCameraPreview = true;
  return {
    blockClipboard: Boolean(merged.blockClipboard),
    blockFocusSwitch: Boolean(merged.blockFocusSwitch),
    blockMultiMonitor: Boolean(merged.blockMultiMonitor),
    cameraRequired: Boolean(merged.cameraRequired),
    showCameraPreview: Boolean(merged.showCameraPreview || merged.cameraRequired),
  };
}

export function parseInviteSecurity(raw: string | null | undefined): InviteSecurity {
  if (!raw) return { ...DEFAULT_INVITE_SECURITY };
  try {
    return normalizeInviteSecurity(JSON.parse(raw) as Partial<InviteSecurity>);
  } catch {
    return { ...DEFAULT_INVITE_SECURITY };
  }
}

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_KEY ?? "ASDQWE!@#0p";

const existingPassword = db
  .prepare("SELECT value FROM settings WHERE key = 'admin_password'")
  .get() as { value: string } | undefined;

if (!existingPassword) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', ?)").run(
    DEFAULT_ADMIN_PASSWORD,
  );
}

export function getAdminPassword(): string {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'admin_password'")
    .get() as { value: string } | undefined;
  return row?.value ?? DEFAULT_ADMIN_PASSWORD;
}

export function setAdminPassword(next: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(next);
}

export type ProblemRow = {
  id: string;
  title: string;
  summary: string;
  timebox_minutes: number | null;
  language: string;
  sort_order: number;
  prompt_text: string;
  starter_text: string;
  created_at: string;
  updated_at: string;
};

export type InviteRow = {
  token: string;
  candidate_name: string;
  candidate_email: string | null;
  problem_ids: string;
  total_timebox_minutes: number;
  exam_started_at: string | null;
  active_session_id: string | null;
  session_last_seen_at: string | null;
  security_violations: number;
  security_json: string | null;
  expires_at: string | null;
  created_at: string;
  submitted_at: string | null;
  closed_at: string | null;
};

export function isSessionAlive(
  invite: Pick<InviteRow, "active_session_id" | "session_last_seen_at">,
  nowMs = Date.now(),
  ttlMs = SESSION_HEARTBEAT_TTL_MS,
): boolean {
  if (!invite.active_session_id || !invite.session_last_seen_at) return false;
  const lastSeen = new Date(invite.session_last_seen_at).getTime();
  if (Number.isNaN(lastSeen)) return false;
  return nowMs - lastSeen < ttlMs;
}

export function inviteExamEndsAt(
  invite: Pick<InviteRow, "exam_started_at" | "total_timebox_minutes">,
): string | null {
  if (!invite.exam_started_at) return null;
  const minutes = invite.total_timebox_minutes ?? 90;
  return new Date(
    new Date(invite.exam_started_at).getTime() + minutes * 60_000,
  ).toISOString();
}

export type InviteStatus = "Start" | "Pending" | "Stop" | "Expired" | "Submitted";

export function computeInviteStatus(
  invite: Pick<
    InviteRow,
    | "submitted_at"
    | "exam_started_at"
    | "total_timebox_minutes"
    | "active_session_id"
    | "session_last_seen_at"
    | "closed_at"
  >,
  nowMs = Date.now(),
): InviteStatus {
  if (invite.submitted_at) return "Submitted";
  if (invite.closed_at) return "Expired";
  if (!invite.exam_started_at) return "Start";

  const endsAt = inviteExamEndsAt(invite);
  if (endsAt && new Date(endsAt).getTime() <= nowMs) return "Expired";

  return isSessionAlive(invite, nowMs) ? "Pending" : "Stop";
}

/**
 * If exam time ended while the candidate is offline (Stop), close the invite
 * without creating a submission.
 */
export function finalizeOfflineExpiredInvites(nowMs = Date.now()): number {
  const rows = db
    .prepare(
      `SELECT * FROM invites
       WHERE submitted_at IS NULL
         AND closed_at IS NULL
         AND exam_started_at IS NOT NULL`,
    )
    .all() as InviteRow[];

  let closed = 0;
  const closedAt = new Date(nowMs).toISOString();
  for (const row of rows) {
    const endsAt = inviteExamEndsAt(row);
    if (!endsAt || new Date(endsAt).getTime() > nowMs) continue;
    if (isSessionAlive(row, nowMs)) continue;

    db.prepare(
      `UPDATE invites
       SET closed_at = ?, active_session_id = NULL, session_last_seen_at = NULL
       WHERE token = ? AND submitted_at IS NULL AND closed_at IS NULL`,
    ).run(closedAt, row.token);
    closed += 1;
  }
  return closed;
}

export type SubmissionRow = {
  id: string;
  invite_token: string;
  client: string;
  started_at: string | null;
  submitted_at: string;
  answers_json: string;
  user_agent: string | null;
  ip: string | null;
  auto_submitted: number;
};

export function problemToClient(row: ProblemRow) {
  return {
    id: row.id,
    title: row.title,
    order: row.sort_order,
    timeboxMinutes: row.timebox_minutes,
    languages: [row.language],
    summary: row.summary,
    prompt: row.prompt_text,
    starters: { [row.language]: row.starter_text },
  };
}
