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

export function sessionStorageKey(token: string) {
  return `live-coding:session:${token}`;
}

export function getOrCreateSessionId(token: string): string {
  const key = sessionStorageKey(token);
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, id);
  return id;
}

/**
 * Detect multiple physical/logical displays.
 * Important: do NOT use availTop/availLeft heuristics — on macOS availTop is
 * non-zero because of the menu bar and causes false positives.
 */
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

  // Most reliable path (Chromium Window Management API).
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

  // isExtended is reliable when present; only block when explicitly true.
  if (typeof screenAny.isExtended === "boolean") {
    return {
      multiple: screenAny.isExtended,
      supported: true,
      detail: screenAny.isExtended
        ? "An extended / secondary display was detected."
        : "Single display confirmed.",
    };
  }

  // Unknown capability: allow the exam (never block on weak heuristics).
  return {
    multiple: false,
    supported: false,
    detail: "Display API unavailable; continuing without multi-monitor block.",
  };
}

/** Browser shortcuts that switch/close tabs or leave the exam surface. */
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
  // Chromium may deliver these when Keyboard Lock is active.
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
