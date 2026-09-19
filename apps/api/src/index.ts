import Fastify from "fastify";
import cors from "@fastify/cors";
import { nanoid } from "nanoid";
import {
  computeInviteStatus,
  computeOfflineSessionStatus,
  db,
  finalizeOfflineExpiredInvites,
  finalizeOfflineExpiredSessions,
  getAdminPassword,
  inviteExamEndsAt,
  isOfflineSessionAlive,
  isSessionAlive,
  normalizeInviteSecurity,
  offlineEndsAt,
  parseInviteSecurity,
  problemToClient,
  setAdminPassword,
  type InviteRow,
  type InviteSecurity,
  type OfflineSessionRow,
  type ProblemRow,
  type SubmissionRow,
} from "./db.js";

const PORT = Number(process.env.PORT ?? 8787);
const ALLOW_RESUBMIT = process.env.ALLOW_RESUBMIT === "true";

const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });

await app.register(cors, {
  origin: true,
});

function parseProblemIds(raw: string): string[] {
  return JSON.parse(raw) as string[];
}

function requireAdmin(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  return Boolean(value) && value === getAdminPassword();
}

function listProblemRows(): ProblemRow[] {
  return db
    .prepare("SELECT * FROM problems ORDER BY sort_order ASC, created_at ASC")
    .all() as ProblemRow[];
}

function getProblemRow(id: string): ProblemRow | undefined {
  return db.prepare("SELECT * FROM problems WHERE id = ?").get(id) as ProblemRow | undefined;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

app.get("/api/health", async () => ({ ok: true }));

app.post<{ Body: { password?: string } }>("/api/admin/login", async (req, reply) => {
  const password = req.body?.password ?? "";
  if (!password || password !== getAdminPassword()) {
    return reply.code(401).send({ error: "Incorrect password" });
  }
  return { ok: true };
});

app.post<{
  Body: { previousPassword?: string; newPassword?: string };
}>("/api/admin/change-password", async (req, reply) => {
  const previousPassword = req.body?.previousPassword ?? "";
  const newPassword = req.body?.newPassword ?? "";

  if (!previousPassword || previousPassword !== getAdminPassword()) {
    return reply.code(401).send({ error: "Previous password is incorrect" });
  }
  if (!newPassword || newPassword.length < 8) {
    return reply.code(400).send({ error: "New password must be at least 8 characters" });
  }
  if (newPassword === previousPassword) {
    return reply.code(400).send({ error: "New password must be different from the previous password" });
  }

  setAdminPassword(newPassword);
  return { ok: true, message: "Password updated" };
});

app.get("/api/problems", async () => {
  return listProblemRows().map((row) => {
    const p = problemToClient(row);
    return {
      id: p.id,
      title: p.title,
      order: p.order,
      timeboxMinutes: p.timeboxMinutes,
      languages: p.languages,
      summary: p.summary,
    };
  });
});

app.get<{ Params: { token: string } }>("/api/invites/:token", async (req, reply) => {
  finalizeOfflineExpiredInvites();

  let invite = db
    .prepare("SELECT * FROM invites WHERE token = ?")
    .get(req.params.token) as InviteRow | undefined;

  if (!invite) {
    return reply.code(404).send({ error: "Invite not found" });
  }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return reply.code(410).send({ error: "Invite expired" });
  }

  const problemIds = parseProblemIds(invite.problem_ids);
  const problems = problemIds
    .map((id) => getProblemRow(id))
    .filter((row): row is ProblemRow => Boolean(row))
    .map(problemToClient);

  const totalTimeboxMinutes = invite.total_timebox_minutes ?? 90;
  const examStartedAt = invite.exam_started_at;
  const endsAt = inviteExamEndsAt(invite);
  const nowMs = Date.now();
  const status = computeInviteStatus(invite, nowMs);
  const closedWithoutSubmission = Boolean(invite.closed_at) && !invite.submitted_at;

  return {
    token: invite.token,
    candidateName: invite.candidate_name,
    candidateEmail: invite.candidate_email,
    expiresAt: invite.expires_at,
    submittedAt: invite.submitted_at,
    alreadySubmitted: Boolean(invite.submitted_at),
    closedWithoutSubmission,
    examClosed: status === "Expired" || closedWithoutSubmission,
    totalTimeboxMinutes,
    examStartedAt,
    endsAt,
    status,
    hasActiveSession: isSessionAlive(invite, nowMs),
    securityViolations: invite.security_violations ?? 0,
    security: parseInviteSecurity(invite.security_json),
    problems,
  };
});

app.post<{
  Params: { token: string };
  Body: { sessionId?: string };
}>("/api/invites/:token/session", async (req, reply) => {
  const sessionId = req.body?.sessionId?.trim();
  if (!sessionId) {
    return reply.code(400).send({ error: "sessionId is required" });
  }

  let invite = db
    .prepare("SELECT * FROM invites WHERE token = ?")
    .get(req.params.token) as InviteRow | undefined;

  if (!invite) {
    return reply.code(404).send({ error: "Invite not found" });
  }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return reply.code(410).send({ error: "Invite expired" });
  }

  if (invite.submitted_at) {
    return reply.code(409).send({ error: "This invite was already submitted" });
  }

  if (invite.closed_at) {
    return reply.code(410).send({
      error: "This exam was closed after time expired with no active session. No answers were saved.",
      code: "EXAM_CLOSED",
    });
  }

  const endsAtExisting = inviteExamEndsAt(invite);
  if (endsAtExisting && new Date(endsAtExisting).getTime() <= Date.now()) {
    // Same live session may still submit; everyone else is blocked.
    if (invite.active_session_id === sessionId && isSessionAlive(invite)) {
      const nowIso = new Date().toISOString();
      db.prepare(
        `UPDATE invites SET session_last_seen_at = ? WHERE token = ?`,
      ).run(nowIso, invite.token);
      return {
        ok: true,
        sessionId,
        examStartedAt: invite.exam_started_at,
        endsAt: endsAtExisting,
        reaccessed: true,
        reclaimed: false,
        examExpired: true,
      };
    }
    finalizeOfflineExpiredInvites();
    return reply.code(410).send({
      error: "Exam time has expired for this invite.",
      code: "EXAM_EXPIRED",
    });
  }

  const nowIso = new Date().toISOString();
  const alive = isSessionAlive(invite);
  if (invite.active_session_id && invite.active_session_id !== sessionId && alive) {
    return reply.code(409).send({
      error:
        "This invite is already in use by another browser or device. Only one candidate session is allowed.",
      code: "SESSION_IN_USE",
    });
  }

  const started = invite.exam_started_at ?? nowIso;
  const previousSessionId = invite.active_session_id;
  const reaccessed = Boolean(previousSessionId === sessionId && invite.exam_started_at);
  const reclaimed = Boolean(
    previousSessionId && previousSessionId !== sessionId && !alive,
  );
  db.prepare(
    `UPDATE invites
     SET active_session_id = ?,
         session_last_seen_at = ?,
         exam_started_at = COALESCE(exam_started_at, ?)
     WHERE token = ?`,
  ).run(sessionId, nowIso, started, invite.token);

  invite = db
    .prepare("SELECT * FROM invites WHERE token = ?")
    .get(req.params.token) as InviteRow;

  return {
    ok: true,
    sessionId,
    examStartedAt: invite.exam_started_at,
    endsAt: inviteExamEndsAt(invite)!,
    reaccessed,
    reclaimed,
  };
});

app.post<{
  Params: { token: string };
  Body: { sessionId?: string };
}>("/api/invites/:token/heartbeat", async (req, reply) => {
  const sessionId = req.body?.sessionId?.trim();
  if (!sessionId) {
    return reply.code(400).send({ error: "sessionId is required" });
  }

  const invite = db
    .prepare("SELECT * FROM invites WHERE token = ?")
    .get(req.params.token) as InviteRow | undefined;

  if (!invite) {
    return reply.code(404).send({ error: "Invite not found" });
  }
  if (invite.submitted_at) {
    return reply.code(409).send({ error: "Invite already submitted", code: "SUBMITTED" });
  }
  if (invite.closed_at) {
    return reply.code(410).send({ error: "Exam closed", code: "EXAM_CLOSED" });
  }

  const endsAt = inviteExamEndsAt(invite);
  if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
    return reply.code(410).send({ error: "Exam time expired", code: "EXAM_EXPIRED" });
  }

  if (!invite.active_session_id || invite.active_session_id !== sessionId) {
    return reply.code(403).send({ error: "Invalid session", code: "SESSION_MISMATCH" });
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE invites SET session_last_seen_at = ? WHERE token = ?`,
  ).run(nowIso, invite.token);

  return {
    ok: true,
    lastSeenAt: nowIso,
    endsAt,
    status: "Pending" as const,
  };
});

app.post<{
  Params: { token: string };
  Body: { sessionId?: string; type?: string; detail?: string };
}>("/api/invites/:token/violations", async (req, reply) => {
  const sessionId = req.body?.sessionId?.trim();
  const invite = db
    .prepare("SELECT * FROM invites WHERE token = ?")
    .get(req.params.token) as InviteRow | undefined;

  if (!invite) {
    return reply.code(404).send({ error: "Invite not found" });
  }
  if (invite.submitted_at) {
    return reply.code(409).send({ error: "Invite already submitted" });
  }
  if (!sessionId || invite.active_session_id !== sessionId) {
    return reply.code(403).send({ error: "Invalid session" });
  }

  db.prepare(
    "UPDATE invites SET security_violations = COALESCE(security_violations, 0) + 1 WHERE token = ?",
  ).run(invite.token);

  const updated = db
    .prepare("SELECT security_violations FROM invites WHERE token = ?")
    .get(invite.token) as { security_violations: number };

  return {
    ok: true,
    type: req.body?.type ?? "unknown",
    violations: updated.security_violations,
  };
});

type AnswerBody = {
  problemId: string;
  language: string;
  source: string;
};

type SubmitBody = {
  token: string;
  client?: string;
  startedAt?: string;
  answers: AnswerBody[];
  autoSubmitted?: boolean;
};

app.post<{ Body: SubmitBody }>("/api/submissions", async (req, reply) => {
  const { token, answers, startedAt, client, autoSubmitted } = req.body ?? {};

  if (!token || !Array.isArray(answers) || answers.length === 0) {
    return reply.code(400).send({ error: "token and answers are required" });
  }

  const invite = db.prepare("SELECT * FROM invites WHERE token = ?").get(token) as
    | InviteRow
    | undefined;

  if (!invite) {
    return reply.code(404).send({ error: "Invite not found" });
  }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return reply.code(410).send({ error: "Invite expired" });
  }

  if (invite.submitted_at && !ALLOW_RESUBMIT) {
    return reply.code(409).send({ error: "This invite was already submitted" });
  }

  if (invite.closed_at) {
    return reply.code(410).send({
      error: "This exam was closed after time expired. No answers were saved.",
      code: "EXAM_CLOSED",
    });
  }

  const allowed = new Set(parseProblemIds(invite.problem_ids));
  for (const answer of answers) {
    if (!allowed.has(answer.problemId)) {
      return reply.code(400).send({ error: `Unexpected problemId: ${answer.problemId}` });
    }
    if (typeof answer.source !== "string" || !answer.language) {
      return reply.code(400).send({ error: "Each answer needs language and source" });
    }
  }

  const id = nanoid();
  const submittedAt = new Date().toISOString();
  const ua = req.headers["user-agent"] ?? null;
  const ip = req.ip;

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO submissions
        (id, invite_token, client, started_at, submitted_at, answers_json, user_agent, ip, auto_submitted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      token,
      client ?? "web",
      startedAt ?? invite.exam_started_at ?? null,
      submittedAt,
      JSON.stringify(answers),
      ua,
      ip,
      autoSubmitted ? 1 : 0,
    );

    db.prepare(
      "UPDATE invites SET submitted_at = ?, active_session_id = NULL, session_last_seen_at = NULL WHERE token = ?",
    ).run(submittedAt, token);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return {
    id,
    submittedAt,
    message: autoSubmitted ? "Time expired — answers auto-submitted" : "Submission received",
    autoSubmitted: Boolean(autoSubmitted),
  };
});

app.get("/api/admin/problems", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  return listProblemRows().map((row) => ({
    ...problemToClient(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
});

type UpsertProblemBody = {
  id?: string;
  title: string;
  summary?: string;
  timeboxMinutes?: number | null;
  language?: string;
  sortOrder?: number;
  promptText: string;
  starterText: string;
};

app.post<{ Body: UpsertProblemBody }>("/api/admin/problems", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const title = req.body?.title?.trim();
  const promptText = req.body?.promptText;
  const starterText = req.body?.starterText;

  if (!title) {
    return reply.code(400).send({ error: "title is required" });
  }
  if (typeof promptText !== "string" || !promptText.trim()) {
    return reply.code(400).send({ error: "prompt .txt content is required" });
  }
  if (typeof starterText !== "string") {
    return reply.code(400).send({ error: "starter .txt content is required" });
  }

  const now = new Date().toISOString();
  const language = (req.body.language?.trim() || "py").toLowerCase();
  const sortOrder =
    typeof req.body.sortOrder === "number"
      ? req.body.sortOrder
      : listProblemRows().length + 1;

  const timeboxMinutes =
    req.body.timeboxMinutes == null || Number.isNaN(Number(req.body.timeboxMinutes))
      ? null
      : Number(req.body.timeboxMinutes);

  let id = req.body.id?.trim() || slugify(title) || nanoid(10);
  if (!req.body.id && getProblemRow(id)) {
    id = `${id}-${nanoid(4)}`;
  }

  const existing = getProblemRow(id);
  if (existing) {
    db.prepare(
      `UPDATE problems
       SET title = ?, summary = ?, timebox_minutes = ?, language = ?,
           sort_order = ?, prompt_text = ?, starter_text = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      title,
      req.body.summary?.trim() ?? existing.summary,
      timeboxMinutes,
      language,
      req.body.sortOrder ?? existing.sort_order,
      promptText,
      starterText,
      now,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO problems
        (id, title, summary, timebox_minutes, language, sort_order,
         prompt_text, starter_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      title,
      req.body.summary?.trim() ?? "",
      timeboxMinutes,
      language,
      sortOrder,
      promptText,
      starterText,
      now,
      now,
    );
  }

  const row = getProblemRow(id)!;
  return { ...problemToClient(row), createdAt: row.created_at, updatedAt: row.updated_at };
});

app.delete<{ Params: { id: string } }>("/api/admin/problems/:id", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const existing = getProblemRow(req.params.id);
  if (!existing) {
    return reply.code(404).send({ error: "Problem not found" });
  }

  db.prepare("DELETE FROM problems WHERE id = ?").run(req.params.id);
  return { ok: true, id: req.params.id };
});

app.post<{
  Body: {
    candidateName: string;
    candidateEmail?: string;
    problemIds?: string[];
    totalTimeboxMinutes?: number;
    expiresInHours?: number;
    token?: string;
    security?: Partial<InviteSecurity>;
  };
}>("/api/admin/invites", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const name = req.body?.candidateName?.trim();
  if (!name) {
    return reply.code(400).send({ error: "candidateName is required" });
  }

  const available = listProblemRows();
  if (available.length === 0) {
    return reply.code(400).send({
      error: "Upload at least one problem (prompt.txt + starter.txt) before creating an invite",
    });
  }

  const problemIds = req.body.problemIds?.length
    ? req.body.problemIds
    : available.map((p) => p.id);

  if (problemIds.length === 0) {
    return reply.code(400).send({ error: "Select at least one uploaded problem" });
  }

  for (const id of problemIds) {
    if (!getProblemRow(id)) {
      return reply.code(400).send({ error: `Unknown problem: ${id}. Upload it first.` });
    }
  }

  const totalTimeboxMinutes = Number(req.body.totalTimeboxMinutes);
  if (!Number.isFinite(totalTimeboxMinutes) || totalTimeboxMinutes <= 0) {
    return reply.code(400).send({
      error: "totalTimeboxMinutes is required and must be a positive number",
    });
  }

  const security = normalizeInviteSecurity(req.body.security);
  const token = req.body.token?.trim() || nanoid(12);
  const createdAt = new Date().toISOString();
  const hours = req.body.expiresInHours ?? 168;
  const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();

  db.prepare(
    `INSERT INTO invites
      (token, candidate_name, candidate_email, problem_ids, total_timebox_minutes,
       exam_started_at, expires_at, created_at, submitted_at, security_json)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
  ).run(
    token,
    name,
    req.body.candidateEmail ?? null,
    JSON.stringify(problemIds),
    Math.round(totalTimeboxMinutes),
    expiresAt,
    createdAt,
    JSON.stringify(security),
  );

  return {
    token,
    candidateName: name,
    problemIds,
    totalTimeboxMinutes: Math.round(totalTimeboxMinutes),
    expiresAt,
    security,
    interviewUrl: `/interview/${token}`,
  };
});

app.get("/api/admin/submissions", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const rows = db
    .prepare(
      `SELECT s.*, i.candidate_name, i.candidate_email
       FROM submissions s
       JOIN invites i ON i.token = s.invite_token
       ORDER BY s.submitted_at DESC`,
    )
    .all() as Array<SubmissionRow & { candidate_name: string; candidate_email: string | null }>;

  return rows.map((row) => ({
    id: row.id,
    inviteToken: row.invite_token,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    client: row.client,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    autoSubmitted: Boolean(row.auto_submitted),
    answerCount: (JSON.parse(row.answers_json) as AnswerBody[]).length,
  }));
});

app.get<{ Params: { id: string } }>("/api/admin/submissions/:id", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const row = db
    .prepare(
      `SELECT s.*, i.candidate_name, i.candidate_email
       FROM submissions s
       JOIN invites i ON i.token = s.invite_token
       WHERE s.id = ?`,
    )
    .get(req.params.id) as
    | (SubmissionRow & { candidate_name: string; candidate_email: string | null })
    | undefined;

  if (!row) {
    return reply.code(404).send({ error: "Submission not found" });
  }

  return {
    id: row.id,
    inviteToken: row.invite_token,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    client: row.client,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    autoSubmitted: Boolean(row.auto_submitted),
    userAgent: row.user_agent,
    ip: row.ip,
    answers: JSON.parse(row.answers_json),
  };
});

app.get("/api/admin/invites", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  finalizeOfflineExpiredInvites();

  const rows = db
    .prepare("SELECT * FROM invites ORDER BY created_at DESC")
    .all() as InviteRow[];

  const now = Date.now();

  return rows.map((row) => {
    const totalTimeboxMinutes = row.total_timebox_minutes ?? 90;
    const status = computeInviteStatus(row, now);
    const examStartedAt = row.exam_started_at;
    const endsAt = inviteExamEndsAt(row);
    const online = isSessionAlive(row, now);
    const remainingMs =
      (status === "Pending" || status === "Stop") && endsAt
        ? Math.max(0, new Date(endsAt).getTime() - now)
        : null;
    const elapsedMs =
      (status === "Pending" || status === "Stop" || status === "Expired") && examStartedAt
        ? Math.max(
            0,
            Math.min(now, endsAt ? new Date(endsAt).getTime() : now) -
              new Date(examStartedAt).getTime(),
          )
        : null;

    return {
      token: row.token,
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      problemIds: parseProblemIds(row.problem_ids),
      status,
      online,
      lastSeenAt: row.session_last_seen_at,
      closedAt: row.closed_at,
      closedWithoutSubmission: Boolean(row.closed_at) && !row.submitted_at,
      totalTimeboxMinutes,
      examStartedAt,
      endsAt,
      remainingMs,
      elapsedMs,
      currentTime: new Date(now).toISOString(),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      security: parseInviteSecurity(row.security_json),
      interviewUrl: `/interview/${row.token}`,
    };
  });
});

app.delete<{ Params: { token: string } }>("/api/admin/invites/:token", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const invite = db
    .prepare("SELECT * FROM invites WHERE token = ?")
    .get(req.params.token) as InviteRow | undefined;

  if (!invite) {
    return reply.code(404).send({ error: "Invite not found" });
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM submissions WHERE invite_token = ?").run(req.params.token);
    db.prepare("DELETE FROM invites WHERE token = ?").run(req.params.token);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { ok: true, token: req.params.token };
});

app.delete<{ Params: { id: string } }>("/api/admin/submissions/:id", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const row = db
    .prepare("SELECT * FROM submissions WHERE id = ?")
    .get(req.params.id) as SubmissionRow | undefined;

  if (!row) {
    return reply.code(404).send({ error: "Submission not found" });
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM submissions WHERE id = ?").run(req.params.id);
    // If this invite has no submissions left, clear submitted_at so status can return to Pending/Start.
    const remaining = db
      .prepare("SELECT COUNT(*) AS count FROM submissions WHERE invite_token = ?")
      .get(row.invite_token) as { count: number };
    if (Number(remaining.count) === 0) {
      db.prepare(
        `UPDATE invites
         SET submitted_at = NULL
         WHERE token = ?`,
      ).run(row.invite_token);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { ok: true, id: req.params.id, inviteToken: row.invite_token };
});

// ——— Offline exam sessions (Electron app) ———

function getOfflineSession(id: string): OfflineSessionRow | undefined {
  return db.prepare("SELECT * FROM offline_sessions WHERE id = ?").get(id) as
    | OfflineSessionRow
    | undefined;
}

function offlineSessionPublic(row: OfflineSessionRow, nowMs = Date.now()) {
  const status = computeOfflineSessionStatus(row, nowMs);
  const endsAt = offlineEndsAt(row);
  const remainingMs =
    status === "Pending" || status === "Stop"
      ? Math.max(0, new Date(endsAt).getTime() - nowMs)
      : null;
  return {
    id: row.id,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    status,
    startedAt: row.started_at,
    endsAt,
    remainingMs,
    endedAt: row.ended_at,
    closedAt: row.closed_at,
    submittedAt: row.submitted_at,
    cameraEnabled: Boolean(row.camera_enabled),
    hasSnapshot: Boolean(row.snapshot_data),
    snapshotAt: row.snapshot_at,
    lastSeenAt: row.last_seen_at,
    online: isOfflineSessionAlive(row, nowMs),
    totalTimeboxMinutes: row.total_timebox_minutes,
    autoSubmitted: Boolean(row.auto_submitted),
    closedWithoutSubmission: Boolean(row.closed_at) && !row.submitted_at,
  };
}

app.post<{
  Body: {
    candidateName?: string;
    candidateEmail?: string;
    deviceSessionId?: string;
    cameraEnabled?: boolean;
    totalTimeboxMinutes?: number;
  };
}>("/api/offline/sessions", async (req, reply) => {
  const candidateName = req.body?.candidateName?.trim();
  const candidateEmail = req.body?.candidateEmail?.trim();
  const deviceSessionId = req.body?.deviceSessionId?.trim();
  if (!candidateName || !candidateEmail || !deviceSessionId) {
    return reply.code(400).send({
      error: "candidateName, candidateEmail, and deviceSessionId are required",
    });
  }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail);
  if (!emailOk) {
    return reply.code(400).send({ error: "A valid email address is required" });
  }

  const totalTimeboxMinutes = Math.max(
    1,
    Math.round(Number(req.body?.totalTimeboxMinutes) || 90),
  );
  const id = nanoid(12);
  const nowIso = new Date().toISOString();
  const cameraEnabled = Boolean(req.body?.cameraEnabled);

  db.prepare(
    `INSERT INTO offline_sessions
      (id, candidate_name, candidate_email, device_session_id, total_timebox_minutes,
       started_at, last_seen_at, camera_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    candidateName,
    candidateEmail,
    deviceSessionId,
    totalTimeboxMinutes,
    nowIso,
    nowIso,
    cameraEnabled ? 1 : 0,
    nowIso,
  );

  const row = getOfflineSession(id)!;
  return { ok: true, ...offlineSessionPublic(row) };
});

app.post<{
  Params: { id: string };
  Body: { deviceSessionId?: string };
}>("/api/offline/sessions/:id/heartbeat", async (req, reply) => {
  finalizeOfflineExpiredSessions();
  const row = getOfflineSession(req.params.id);
  if (!row) return reply.code(404).send({ error: "Offline session not found" });

  const deviceSessionId = req.body?.deviceSessionId?.trim();
  if (!deviceSessionId || deviceSessionId !== row.device_session_id) {
    return reply.code(403).send({ error: "Invalid device session", code: "SESSION_MISMATCH" });
  }
  if (row.submitted_at) {
    return reply.code(409).send({ error: "Already submitted", code: "SUBMITTED" });
  }
  if (row.closed_at) {
    return reply.code(410).send({ error: "Exam closed", code: "EXAM_CLOSED" });
  }

  const endsAt = offlineEndsAt(row);
  if (new Date(endsAt).getTime() <= Date.now()) {
    return reply.code(410).send({ error: "Exam time expired", code: "EXAM_EXPIRED" });
  }

  const nowIso = new Date().toISOString();
  db.prepare(`UPDATE offline_sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso, row.id);
  const updated = getOfflineSession(row.id)!;
  return {
    ok: true,
    status: computeOfflineSessionStatus(updated),
    endsAt,
    lastSeenAt: nowIso,
  };
});

app.post<{
  Params: { id: string };
  Body: { deviceSessionId?: string; imageBase64?: string };
}>("/api/offline/sessions/:id/snapshot", async (req, reply) => {
  const row = getOfflineSession(req.params.id);
  if (!row) return reply.code(404).send({ error: "Offline session not found" });

  const deviceSessionId = req.body?.deviceSessionId?.trim();
  if (!deviceSessionId || deviceSessionId !== row.device_session_id) {
    return reply.code(403).send({ error: "Invalid device session" });
  }
  if (row.submitted_at || row.closed_at) {
    return reply.code(409).send({ error: "Session already finished" });
  }

  const imageBase64 = req.body?.imageBase64?.trim();
  if (!imageBase64 || imageBase64.length < 32) {
    return reply.code(400).send({ error: "imageBase64 is required" });
  }

  const snapshotAt = new Date().toISOString();
  db.prepare(
    `UPDATE offline_sessions SET snapshot_data = ?, snapshot_at = ?, last_seen_at = ? WHERE id = ?`,
  ).run(imageBase64, snapshotAt, snapshotAt, row.id);

  return { ok: true, snapshotReceivedAt: snapshotAt };
});

app.post<{
  Params: { id: string };
  Body: {
    deviceSessionId?: string;
    answers?: Array<{ problemId: string; language: string; source: string }>;
    autoSubmitted?: boolean;
  };
}>("/api/offline/sessions/:id/submit", async (req, reply) => {
  const row = getOfflineSession(req.params.id);
  if (!row) return reply.code(404).send({ error: "Offline session not found" });

  const deviceSessionId = req.body?.deviceSessionId?.trim();
  if (!deviceSessionId || deviceSessionId !== row.device_session_id) {
    return reply.code(403).send({ error: "Invalid device session" });
  }
  if (row.closed_at && !row.submitted_at) {
    return reply.code(410).send({
      error: "This exam was closed after time expired. No answers were saved.",
      code: "EXAM_CLOSED",
    });
  }
  if (row.submitted_at && !ALLOW_RESUBMIT) {
    return reply.code(409).send({ error: "Already submitted" });
  }

  const answers = req.body?.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    return reply.code(400).send({ error: "answers are required" });
  }

  const submittedAt = new Date().toISOString();
  const autoSubmitted = Boolean(req.body?.autoSubmitted);
  db.prepare(
    `UPDATE offline_sessions
     SET submitted_at = ?, ended_at = ?, answers_json = ?, auto_submitted = ?,
         last_seen_at = ?, closed_at = NULL
     WHERE id = ?`,
  ).run(
    submittedAt,
    submittedAt,
    JSON.stringify(answers),
    autoSubmitted ? 1 : 0,
    submittedAt,
    row.id,
  );

  return {
    ok: true,
    submittedAt,
    message: autoSubmitted ? "Time expired — answers auto-submitted" : "Submission received",
    autoSubmitted,
  };
});

app.get("/api/admin/offline-sessions", async (req, reply) => {
  if (!requireAdmin(req.headers["x-admin-key"])) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  finalizeOfflineExpiredSessions();
  const now = Date.now();
  const rows = db
    .prepare("SELECT * FROM offline_sessions ORDER BY started_at DESC")
    .all() as OfflineSessionRow[];

  return rows.map((row) => {
    const pub = offlineSessionPublic(row, now);
    const startedMs = new Date(row.started_at).getTime();
    const endsAtMs = new Date(pub.endsAt).getTime();
    const elapsedMs = Math.max(0, Math.min(now, endsAtMs) - startedMs);
    return {
      ...pub,
      elapsedMs:
        pub.status === "Pending" || pub.status === "Stop" || pub.status === "Expired"
          ? elapsedMs
          : row.ended_at
            ? Math.max(0, new Date(row.ended_at).getTime() - startedMs)
            : elapsedMs,
      answerCount: row.answers_json
        ? (JSON.parse(row.answers_json) as unknown[]).length
        : 0,
    };
  });
});

app.get<{ Params: { id: string } }>(
  "/api/admin/offline-sessions/:id",
  async (req, reply) => {
    if (!requireAdmin(req.headers["x-admin-key"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const row = getOfflineSession(req.params.id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    const pub = offlineSessionPublic(row);
    return {
      ...pub,
      answers: row.answers_json ? JSON.parse(row.answers_json) : [],
      hasSnapshot: Boolean(row.snapshot_data),
    };
  },
);

app.get<{ Params: { id: string } }>(
  "/api/admin/offline-sessions/:id/snapshot",
  async (req, reply) => {
    if (!requireAdmin(req.headers["x-admin-key"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const row = getOfflineSession(req.params.id);
    if (!row?.snapshot_data) {
      return reply.code(404).send({ error: "No snapshot" });
    }
    return {
      ok: true,
      snapshotAt: row.snapshot_at,
      imageBase64: row.snapshot_data,
    };
  },
);

app.delete<{ Params: { id: string } }>(
  "/api/admin/offline-sessions/:id",
  async (req, reply) => {
    if (!requireAdmin(req.headers["x-admin-key"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const row = getOfflineSession(req.params.id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    db.prepare("DELETE FROM offline_sessions WHERE id = ?").run(req.params.id);
    return { ok: true, id: req.params.id };
  },
);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`API listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
