async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export type OfflineSession = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: "Pending" | "Stop" | "Expired" | "Submitted";
  startedAt: string;
  endsAt: string;
  remainingMs: number | null;
};

export function startOfflineSession(body: {
  candidateName: string;
  candidateEmail: string;
  totalTimeboxMinutes: number;
  cameraEnabled: boolean;
}) {
  return fetch("/api/offline/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => parseJson<OfflineSession & { ok: boolean }>(r));
}

export function sendOfflineHeartbeat(sessionId: string) {
  return fetch(`/api/offline/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((r) => parseJson<{ ok: boolean; status: string; endsAt: string }>(r));
}

export function uploadOfflinePhoto(sessionId: string, imageBase64: string) {
  return fetch(`/api/offline/sessions/${encodeURIComponent(sessionId)}/photo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64 }),
  }).then((r) => parseJson<{ ok: boolean; photoReceivedAt: string }>(r));
}

export function submitOfflineAnswers(
  sessionId: string,
  body: {
    answers: Array<{ problemId: string; language: string; source: string }>;
    autoSubmitted?: boolean;
  },
) {
  return fetch(`/api/offline/sessions/${encodeURIComponent(sessionId)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) =>
    parseJson<{
      ok: boolean;
      submittedAt: string;
      message: string;
      autoSubmitted?: boolean;
    }>(r),
  );
}
