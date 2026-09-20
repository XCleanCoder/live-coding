/**
 * Production default API (used when no runtime config / env is present).
 * For real releases, prefer resources/config.json or VITE_API_BASE at build time.
 */
export const BUILT_IN_API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:8787";

export type AppRuntimeConfig = {
  apiBaseUrl: string;
};

let resolved: AppRuntimeConfig | null = null;
let resolvePromise: Promise<AppRuntimeConfig> | null = null;

function normalizeBase(url: string): string {
  return url.trim().replace(/\/$/, "");
}

export async function getRuntimeConfig(): Promise<AppRuntimeConfig> {
  if (resolved) return resolved;
  if (resolvePromise) return resolvePromise;

  resolvePromise = (async () => {
    try {
      if (window.electronAPI?.getRuntimeConfig) {
        const fromMain = await window.electronAPI.getRuntimeConfig();
        if (fromMain?.apiBaseUrl?.trim()) {
          resolved = { apiBaseUrl: normalizeBase(fromMain.apiBaseUrl) };
          return resolved;
        }
      }
    } catch {
      // fall through to built-in
    }
    resolved = { apiBaseUrl: normalizeBase(BUILT_IN_API_BASE) };
    return resolved;
  })();

  return resolvePromise;
}

export async function getApiBaseUrl(): Promise<string> {
  const cfg = await getRuntimeConfig();
  return cfg.apiBaseUrl;
}
