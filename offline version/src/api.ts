import { getApiBaseUrl } from "./runtimeConfig";

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 800;

async function parseJson<T>(res: Response): Promise<T> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned an invalid response (${res.status}).`);
  }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiUrl(path: string): Promise<string> {
  if (path.startsWith("http")) return path;
  const base = await getApiBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  options?: { timeoutMs?: number; retries?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options?.retries ?? RETRY_COUNT;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = await apiUrl(path);
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      return await parseJson<T>(res);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const message = aborted
        ? "Could not reach the exam server (timeout). Check your internet connection."
        : err instanceof TypeError
          ? "Could not reach the exam server. Check your internet connection."
          : err instanceof Error
            ? err.message
            : "Network request failed";
      lastError = new Error(message);
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("Network request failed");
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

export async function checkApiHealth(): Promise<{ ok: boolean; apiBaseUrl: string }> {
  const apiBaseUrl = await getApiBaseUrl();
  await requestJson<{ ok?: boolean }>("/api/health", { method: "GET" }, { retries: 1, timeoutMs: 8_000 });
  return { ok: true, apiBaseUrl };
}

export function createOfflineSession(body: {
  candidateName: string;
  candidateEmail: string;
  deviceSessionId: string;
  cameraEnabled: boolean;
  totalTimeboxMinutes: number;
}) {
  return requestJson<OfflineSession & { ok?: boolean }>("/api/offline/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function sendOfflineHeartbeat(sessionId: string, deviceSessionId: string) {
  return requestJson<{ ok: boolean; status: string; endsAt: string }>(
    `/api/offline/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
    {
      method: "POST",
      body: JSON.stringify({ deviceSessionId }),
    },
    { retries: 1, timeoutMs: 12_000 },
  );
}

export function uploadOfflineSnapshot(
  sessionId: string,
  deviceSessionId: string,
  imageBase64: string,
) {
  return requestJson<{ ok: boolean; snapshotReceivedAt?: string }>(
    `/api/offline/sessions/${encodeURIComponent(sessionId)}/snapshot`,
    {
      method: "POST",
      body: JSON.stringify({ deviceSessionId, imageBase64 }),
    },
    { retries: 1, timeoutMs: 30_000 },
  );
}

export function submitOfflineAnswers(
  sessionId: string,
  deviceSessionId: string,
  body: {
    answers: Array<{ problemId: string; language: string; source: string }>;
    autoSubmitted?: boolean;
  },
) {
  return requestJson<{
    ok: boolean;
    submittedAt: string;
    message: string;
    autoSubmitted?: boolean;
  }>(`/api/offline/sessions/${encodeURIComponent(sessionId)}/submit`, {
    method: "POST",
    body: JSON.stringify({ deviceSessionId, ...body }),
  }, { retries: 3, timeoutMs: 30_000 });
}
