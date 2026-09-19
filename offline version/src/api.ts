const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8787").replace(/\/$/, "");

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

function apiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
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

export function createOfflineSession(body: {
  candidateName: string;
  candidateEmail: string;
  deviceSessionId: string;
  cameraEnabled: boolean;
  totalTimeboxMinutes: number;
}) {
  return fetch(apiUrl("/api/offline/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => parseJson<OfflineSession & { ok?: boolean }>(r));
}

export function sendOfflineHeartbeat(sessionId: string, deviceSessionId: string) {
  return fetch(apiUrl(`/api/offline/sessions/${encodeURIComponent(sessionId)}/heartbeat`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceSessionId }),
  }).then((r) => parseJson<{ ok: boolean; status: string; endsAt: string }>(r));
}

export function uploadOfflineSnapshot(
  sessionId: string,
  deviceSessionId: string,
  imageBase64: string,
) {
  return fetch(apiUrl(`/api/offline/sessions/${encodeURIComponent(sessionId)}/snapshot`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceSessionId, imageBase64 }),
  }).then((r) => parseJson<{ ok: boolean; snapshotReceivedAt?: string }>(r));
}

export function submitOfflineAnswers(
  sessionId: string,
  deviceSessionId: string,
  body: {
    answers: Array<{ problemId: string; language: string; source: string }>;
    autoSubmitted?: boolean;
  },
) {
  return fetch(apiUrl(`/api/offline/sessions/${encodeURIComponent(sessionId)}/submit`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceSessionId, ...body }),
  }).then((r) =>
    parseJson<{
      ok: boolean;
      submittedAt: string;
      message: string;
      autoSubmitted?: boolean;
    }>(r),
  );
}
