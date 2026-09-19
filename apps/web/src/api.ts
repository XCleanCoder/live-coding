export type Problem = {
  id: string;
  title: string;
  order: number;
  timeboxMinutes: number | null;
  languages: string[];
  summary: string;
  prompt: string;
  starters: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
};

export type InviteSecurity = {
  blockClipboard: boolean;
  blockMultiMonitor: boolean;
  blockFocusSwitch: boolean;
  cameraRequired: boolean;
  showCameraPreview: boolean;
};

export type InvitePayload = {
  token: string;
  candidateName: string;
  candidateEmail: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
  alreadySubmitted: boolean;
  closedWithoutSubmission?: boolean;
  examClosed?: boolean;
  totalTimeboxMinutes: number;
  examStartedAt: string | null;
  endsAt: string | null;
  status?: "Start" | "Pending" | "Stop" | "Expired" | "Submitted";
  hasActiveSession?: boolean;
  securityViolations?: number;
  security?: InviteSecurity;
  problems: Problem[];
};

export type Answer = {
  problemId: string;
  language: string;
  source: string;
};

export type SubmissionSummary = {
  id: string;
  inviteToken: string;
  candidateName: string;
  candidateEmail: string | null;
  client: string;
  startedAt: string | null;
  submittedAt: string;
  autoSubmitted?: boolean;
  answerCount: number;
};

export type SubmissionDetail = {
  id: string;
  inviteToken: string;
  candidateName: string;
  candidateEmail: string | null;
  client: string;
  startedAt: string | null;
  submittedAt: string;
  autoSubmitted?: boolean;
  userAgent: string | null;
  ip: string | null;
  answers: Answer[];
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function fetchInvite(token: string) {
  return fetch(`/api/invites/${encodeURIComponent(token)}`).then((r) =>
    parseJson<InvitePayload>(r),
  );
}

export function claimInviteSession(token: string, sessionId: string) {
  return fetch(`/api/invites/${encodeURIComponent(token)}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).then((r) =>
    parseJson<{
      ok: boolean;
      sessionId: string;
      examStartedAt: string;
      endsAt: string;
      reaccessed: boolean;
      reclaimed?: boolean;
    }>(r),
  );
}

export function sendInviteHeartbeat(token: string, sessionId: string) {
  return fetch(`/api/invites/${encodeURIComponent(token)}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).then((r) =>
    parseJson<{
      ok: boolean;
      lastSeenAt: string;
      endsAt: string | null;
      status: "Pending";
    }>(r),
  );
}

export function reportSecurityViolation(
  token: string,
  body: { sessionId: string; type: string; detail?: string },
) {
  return fetch(`/api/invites/${encodeURIComponent(token)}/violations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => parseJson<{ ok: boolean; type: string; violations: number }>(r));
}

export function submitAnswers(body: {
  token: string;
  client?: string;
  startedAt?: string;
  answers: Answer[];
  autoSubmitted?: boolean;
}) {
  return fetch("/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) =>
    parseJson<{
      id: string;
      submittedAt: string;
      message: string;
      autoSubmitted?: boolean;
    }>(r),
  );
}

export function adminHeaders(adminKey: string) {
  return { "x-admin-key": adminKey };
}

export function adminLogin(password: string) {
  return fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }).then((r) => parseJson<{ ok: boolean }>(r));
}

export function changeAdminPassword(body: {
  previousPassword: string;
  newPassword: string;
}) {
  return fetch("/api/admin/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => parseJson<{ ok: boolean; message: string }>(r));
}

export function listSubmissions(adminKey: string) {
  return fetch("/api/admin/submissions", {
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<SubmissionSummary[]>(r));
}

export function getSubmission(adminKey: string, id: string) {
  return fetch(`/api/admin/submissions/${encodeURIComponent(id)}`, {
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<SubmissionDetail>(r));
}

export function listAdminProblems(adminKey: string) {
  return fetch("/api/admin/problems", {
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<Problem[]>(r));
}

export function upsertProblem(
  adminKey: string,
  body: {
    id?: string;
    title: string;
    summary?: string;
    timeboxMinutes?: number | null;
    language?: string;
    sortOrder?: number;
    promptText: string;
    starterText: string;
  },
) {
  return fetch("/api/admin/problems", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders(adminKey),
    },
    body: JSON.stringify(body),
  }).then((r) => parseJson<Problem>(r));
}

export function deleteProblem(adminKey: string, id: string) {
  return fetch(`/api/admin/problems/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<{ ok: boolean; id: string }>(r));
}

export function createInvite(
  adminKey: string,
  body: {
    candidateName: string;
    candidateEmail?: string;
    problemIds?: string[];
    totalTimeboxMinutes: number;
    expiresInHours?: number;
    token?: string;
    security?: Partial<InviteSecurity>;
  },
) {
  return fetch("/api/admin/invites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...adminHeaders(adminKey),
    },
    body: JSON.stringify(body),
  }).then((r) =>
    parseJson<{
      token: string;
      candidateName: string;
      problemIds: string[];
      totalTimeboxMinutes: number;
      expiresAt: string;
      security: InviteSecurity;
      interviewUrl: string;
    }>(r),
  );
}

export type InviteAdmin = {
  token: string;
  candidateName: string;
  candidateEmail: string | null;
  problemIds: string[];
  status: "Start" | "Pending" | "Stop" | "Expired" | "Submitted";
  online?: boolean;
  lastSeenAt?: string | null;
  totalTimeboxMinutes: number;
  examStartedAt: string | null;
  endsAt: string | null;
  remainingMs: number | null;
  elapsedMs: number | null;
  currentTime: string;
  expiresAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  security?: InviteSecurity;
  closedAt?: string | null;
  closedWithoutSubmission?: boolean;
  interviewUrl: string;
};

export function listInvites(adminKey: string) {
  return fetch("/api/admin/invites", {
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<InviteAdmin[]>(r));
}

export function deleteInvite(adminKey: string, token: string) {
  return fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
    method: "DELETE",
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<{ ok: boolean; token: string }>(r));
}

export function deleteSubmission(adminKey: string, id: string) {
  return fetch(`/api/admin/submissions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<{ ok: boolean; id: string; inviteToken: string }>(r));
}

export type OfflineSessionAdmin = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: "Pending" | "Stop" | "Expired" | "Submitted";
  startedAt: string;
  endsAt: string;
  remainingMs: number | null;
  elapsedMs?: number | null;
  endedAt: string | null;
  closedAt: string | null;
  submittedAt: string | null;
  cameraEnabled: boolean;
  hasSnapshot: boolean;
  snapshotAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  totalTimeboxMinutes: number;
  autoSubmitted: boolean;
  closedWithoutSubmission: boolean;
  answerCount?: number;
};

export function listOfflineSessions(adminKey: string) {
  return fetch("/api/admin/offline-sessions", {
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<OfflineSessionAdmin[]>(r));
}

export function getOfflineSessionDetail(adminKey: string, id: string) {
  return fetch(`/api/admin/offline-sessions/${encodeURIComponent(id)}`, {
    headers: adminHeaders(adminKey),
  }).then((r) =>
    parseJson<
      OfflineSessionAdmin & {
        answers: Array<{ problemId: string; language: string; source: string }>;
      }
    >(r),
  );
}

export function getOfflineSessionSnapshot(adminKey: string, id: string) {
  return fetch(`/api/admin/offline-sessions/${encodeURIComponent(id)}/snapshot`, {
    headers: adminHeaders(adminKey),
  }).then((r) =>
    parseJson<{ ok: boolean; snapshotAt: string | null; imageBase64: string }>(r),
  );
}

export function deleteOfflineSession(adminKey: string, id: string) {
  return fetch(`/api/admin/offline-sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: adminHeaders(adminKey),
  }).then((r) => parseJson<{ ok: boolean; id: string }>(r));
}
