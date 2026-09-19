export type SecurityFlags = {
  blockClipboard: boolean;
  blockMultiMonitor: boolean;
  blockFocusSwitch: boolean;
  cameraRequired: boolean;
  showCameraPreview: boolean;
};

export const DEFAULT_SECURITY: SecurityFlags = {
  blockClipboard: true,
  blockMultiMonitor: true,
  blockFocusSwitch: true,
  cameraRequired: false,
  showCameraPreview: true,
};

const DEVICE_SESSION_KEY = "live-coding:offline:deviceSessionId";

export function getOrCreateDeviceSessionId(): string {
  const existing = localStorage.getItem(DEVICE_SESSION_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(DEVICE_SESSION_KEY, id);
  return id;
}

export async function detectMultipleDisplays(): Promise<{
  multiple: boolean;
  supported: boolean;
  detail: string;
}> {
  const getScreenDetails = (
    window as Window & {
      getScreenDetails?: () => Promise<{ screens: Array<{ label?: string }> }>;
    }
  ).getScreenDetails;

  if (typeof getScreenDetails === "function") {
    try {
      const details = await getScreenDetails();
      const count = details.screens?.length ?? 1;
      return {
        multiple: count > 1,
        supported: true,
        detail:
          count > 1
            ? `${count} displays were detected. Disconnect extra monitors to continue.`
            : "Single display confirmed.",
      };
    } catch {
      // Permission denied or unavailable — fall through.
    }
  }

  const screenAny = window.screen as Screen & { isExtended?: boolean };

  if (typeof screenAny.isExtended === "boolean") {
    return {
      multiple: screenAny.isExtended,
      supported: true,
      detail: screenAny.isExtended
        ? "An extended / secondary display was detected."
        : "Single display confirmed.",
    };
  }

  return {
    multiple: false,
    supported: false,
    detail: "Display API unavailable; continuing without multi-monitor block.",
  };
}

export function isLeaveExamShortcut(event: KeyboardEvent): boolean {
  const key = event.key;
  const code = event.code;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && (key === "Tab" || code === "Tab")) return true;
  if (mod && (key === "PageUp" || key === "PageDown" || code === "PageUp" || code === "PageDown")) {
    return true;
  }
  if (mod && (key === "w" || key === "W" || code === "KeyW")) return true;
  if (mod && (key === "t" || key === "T" || code === "KeyT")) return true;
  if (mod && (key === "n" || key === "N" || code === "KeyN")) return true;
  if (mod && event.shiftKey && (key === "t" || key === "T" || code === "KeyT")) return true;
  if (key === "F11" || code === "F11") return true;
  if (event.altKey && (key === "Tab" || code === "Tab" || key === "F4" || code === "F4")) {
    return true;
  }
  return false;
}

export async function enterExamFullscreen(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) {
      const el = document.documentElement as HTMLElement & {
        requestFullscreen: (options?: { navigationUI?: string }) => Promise<void>;
      };
      await el.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    return false;
  }

  try {
    const keyboard = (
      navigator as Navigator & {
        keyboard?: { lock?: (keys?: string[]) => Promise<void> };
      }
    ).keyboard;
    if (keyboard?.lock) {
      await keyboard.lock([
        "Escape",
        "Tab",
        "F11",
        "MetaLeft",
        "MetaRight",
        "OSLeft",
        "OSRight",
        "AltLeft",
        "AltRight",
      ]);
    }
  } catch {
    // Keyboard Lock is Chromium-only and may be denied; fullscreen still helps.
  }

  return Boolean(document.fullscreenElement);
}

export function exitExamFullscreen(): void {
  try {
    const keyboard = (
      navigator as Navigator & { keyboard?: { unlock?: () => void } }
    ).keyboard;
    keyboard?.unlock?.();
  } catch {
    // ignore
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}
