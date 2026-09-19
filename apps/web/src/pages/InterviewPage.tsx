import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  claimInviteSession,
  fetchInvite,
  reportSecurityViolation,
  sendInviteHeartbeat,
  submitAnswers,
  type InvitePayload,
  type Problem,
} from "../api";
import {
  DEFAULT_SECURITY,
  detectMultipleDisplays,
  enterExamFullscreen,
  exitExamFullscreen,
  getOrCreateSessionId,
  isLeaveExamShortcut,
  type SecurityFlags,
} from "../security";

const LANG_LABEL: Record<string, string> = {
  py: "Python",
  go: "Go",
  java: "Java",
  cpp: "C++",
  rs: "Rust",
  cs: "C#",
};

function monacoLanguage(ext: string): string {
  if (ext === "py") return "python";
  if (ext === "ts") return "typescript";
  if (ext === "js") return "javascript";
  if (ext === "java") return "java";
  if (ext === "go") return "go";
  if (ext === "rs") return "rust";
  if (ext === "cs") return "csharp";
  if (ext === "cpp" || ext === "cc") return "cpp";
  return "plaintext";
}

function storageKey(token: string, problemId: string, language: string) {
  return `live-coding:${token}:${problemId}:${language}`;
}

function loadDraft(token: string, problem: Problem, language: string): string {
  const key = storageKey(token, problem.id, language);
  const saved = localStorage.getItem(key);
  if (saved != null) return saved;
  return problem.starters[language] ?? "";
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function InterviewPage() {
  const { token = "" } = useParams();
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateReady, setGateReady] = useState(false);
  const [gateMessage, setGateMessage] = useState("Preparing secure exam environment…");
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [focusWarning, setFocusWarning] = useState<string | null>(null);
  const [focusGuardEnabled, setFocusGuardEnabled] = useState(true);
  const [needsFullscreenClick, setNeedsFullscreenClick] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [rulesAck, setRulesAck] = useState(false);
  const [enableCamera, setEnableCamera] = useState(true);
  const [startingExam, setStartingExam] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityFlags>(DEFAULT_SECURITY);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);

  const [activeProblemId, setActiveProblemId] = useState<string | null>(null);
  const [language, setLanguage] = useState("py");
  const [sources, setSources] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [exitInSec, setExitInSec] = useState<number | null>(null);
  const [closingReason, setClosingReason] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourcesRef = useRef(sources);
  const inviteRef = useRef(invite);
  const lockedRef = useRef(locked);
  const submittingRef = useRef(submitting);
  const autoSubmitStarted = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const securityRef = useRef(security);
  const focusGuardEnabledRef = useRef(focusGuardEnabled);
  const ignoreFullscreenExitRef = useRef(false);
  const leaveLockActiveRef = useRef(false);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);
  useEffect(() => {
    inviteRef.current = invite;
  }, [invite]);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    securityRef.current = security;
  }, [security]);
  useEffect(() => {
    focusGuardEnabledRef.current = focusGuardEnabled;
  }, [focusGuardEnabled]);
  useEffect(() => {
    leaveLockActiveRef.current = Boolean(focusWarning);
  }, [focusWarning]);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraStream]);

  const reportViolation = useCallback(
    async (type: string, detail?: string) => {
      const sid = sessionIdRef.current;
      if (!sid || !token) return;
      try {
        await reportSecurityViolation(token, { sessionId: sid, type, detail });
      } catch {
        // Non-blocking — candidate alert still shows.
      }
    },
    [token],
  );

  const doSubmit = useCallback(
    async (autoSubmitted: boolean) => {
      const currentInvite = inviteRef.current;
      if (!currentInvite || lockedRef.current || submittingRef.current) return;
      if (!navigator.onLine) {
        setSubmitMessage(
          autoSubmitted
            ? "Time expired, but you are offline. Reconnect and submit manually if possible."
            : "Internet is required to submit. Your work is saved locally.",
        );
        return;
      }

      setSubmitting(true);
      setSubmitMessage(autoSubmitted ? "Time is up — submitting your answers…" : null);
      try {
        const answers = currentInvite.problems.flatMap((problem) =>
          problem.languages.map((lang) => ({
            problemId: problem.id,
            language: lang,
            source:
              sourcesRef.current[`${problem.id}:${lang}`] ??
              problem.starters[lang] ??
              "",
          })),
        );
        const result = await submitAnswers({
          token,
          client: "web",
          startedAt: currentInvite.examStartedAt ?? undefined,
          answers,
          autoSubmitted,
        });
        setLocked(true);
        setRemainingMs(0);
        setFocusWarning(null);
        const base = autoSubmitted
          ? `Time expired — answers auto-submitted at ${result.submittedAt}`
          : `Submitted successfully at ${result.submittedAt}`;
        setSubmitMessage(base);
        setClosingReason(base);
        setExitInSec(3);
        cameraStream?.getTracks().forEach((track) => track.stop());
        exitExamFullscreen();
      } catch (err) {
        if (autoSubmitted) autoSubmitStarted.current = false;
        setSubmitMessage(err instanceof Error ? err.message : "Submit failed");
      } finally {
        setSubmitting(false);
      }
    },
    [token, cameraStream],
  );

  const beginCloseWithoutSave = useCallback((message: string) => {
    setLocked(true);
    setRemainingMs(0);
    setRulesAccepted(true);
    setGateReady(true);
    setFocusWarning(null);
    setClosingReason(message);
    setSubmitMessage(message);
    setExitInSec(3);
    cameraStream?.getTracks().forEach((track) => track.stop());
    exitExamFullscreen();
  }, [cameraStream]);

  // Load invite only — show rules before starting the secure session / timer
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setBlockedReason(null);
      setGateReady(false);
      setRulesAccepted(false);
      setExitInSec(null);
      setClosingReason(null);
      autoSubmitStarted.current = false;

      try {
        setGateMessage("Loading invite…");
        const data = await fetchInvite(token);
        if (cancelled) return;

        const flags = data.security ?? DEFAULT_SECURITY;
        setSecurity(flags);
        setInvite(data);

        if (data.alreadySubmitted) {
          setLocked(true);
          setRemainingMs(0);
          setRulesAccepted(true);
          setGateReady(true);
          const first = data.problems[0];
          if (first) {
            setActiveProblemId(first.id);
            setLanguage(first.languages[0] ?? "py");
          }
          setClosingReason("This exam was already submitted.");
          setSubmitMessage("This exam was already submitted.");
          setExitInSec(3);
          return;
        }

        if (
          data.closedWithoutSubmission ||
          (data.status === "Expired" && !data.hasActiveSession && !data.alreadySubmitted)
        ) {
          const first = data.problems[0];
          if (first) {
            setActiveProblemId(first.id);
            setLanguage(first.languages[0] ?? "py");
          }
          beginCloseWithoutSave(
            data.closedWithoutSubmission || data.status === "Expired"
              ? "Exam time ended while you were offline. This invite is closed and no answers were saved."
              : "Exam time has ended. This invite is closed.",
          );
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open interview");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token, beginCloseWithoutSave]);

  useEffect(() => {
    if (!invite?.security) return;
    if (invite.security.cameraRequired) {
      setEnableCamera(true);
    } else if (!invite.security.showCameraPreview) {
      setEnableCamera(false);
    }
  }, [invite?.security]);

  const startSecureExam = useCallback(async () => {
    if (!invite || startingExam) return;

    setStartingExam(true);
    setError(null);
    setBlockedReason(null);
    setGateMessage("Preparing secure exam environment…");
    setRulesAccepted(true);

    let localStream: MediaStream | null = null;

    try {
      const flags = security;

      if (flags.blockMultiMonitor) {
        setGateMessage("Checking display configuration…");
        const display = await detectMultipleDisplays();
        if (display.multiple) {
          setBlockedReason(
            `${display.detail} Please disconnect extra monitors/displays and reload this page.`,
          );
          setRulesAccepted(false);
          return;
        }
      }

      if (flags.showCameraPreview && enableCamera) {
        setGateMessage("Requesting camera (optional)…");
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
          setCameraStream(localStream);
          setCameraFailed(false);
        } catch {
          setCameraFailed(true);
          setCameraStream(null);
          if (flags.cameraRequired) {
            setBlockedReason(
              "Camera access is required for this exam. Enable your camera and reload.",
            );
            setRulesAccepted(false);
            return;
          }
        }
      } else {
        setCameraStream(null);
        setCameraFailed(!enableCamera);
      }

      setGateMessage("Starting secure session…");
      const sid = getOrCreateSessionId(token);
      const session = await claimInviteSession(token, sid);

      setSessionId(sid);
      const merged: InvitePayload = {
        ...invite,
        examStartedAt: session.examStartedAt,
        endsAt: session.endsAt,
      };
      setInvite(merged);
      setLocked(false);
      setRemainingMs(new Date(session.endsAt).getTime() - Date.now());

      const first = merged.problems[0];
      if (first) {
        setActiveProblemId(first.id);
        const lang = first.languages[0] ?? "py";
        setLanguage(lang);
        const initial: Record<string, string> = {};
        for (const problem of merged.problems) {
          for (const langId of problem.languages) {
            initial[`${problem.id}:${langId}`] = loadDraft(token, problem, langId);
          }
        }
        setSources(initial);
      }

      setGateReady(true);
    } catch (err) {
      localStream?.getTracks().forEach((t) => t.stop());
      setRulesAccepted(false);
      setError(err instanceof Error ? err.message : "Could not start interview");
    } finally {
      setStartingExam(false);
    }
  }, [invite, startingExam, security, enableCamera, token]);

  // Presence heartbeat — keeps admin status Pending while this tab is open
  useEffect(() => {
    if (!gateReady || locked || !sessionId || !token) return;

    let cancelled = false;

    const ping = async () => {
      try {
        await sendInviteHeartbeat(token, sessionId);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Heartbeat failed";
        if (/expired|exam closed/i.test(message)) {
          if (!autoSubmitStarted.current) {
            autoSubmitStarted.current = true;
            void doSubmit(true);
          }
          return;
        }
        if (/submitted/i.test(message)) {
          setLocked(true);
          setRemainingMs(0);
          setSubmitMessage(message);
          setExitInSec(3);
        }
      }
    };

    void ping();
    const id = window.setInterval(() => void ping(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [gateReady, locked, sessionId, token, doSubmit]);

  // After submit / close, count down and leave the invite page
  useEffect(() => {
    if (exitInSec == null) return;
    if (exitInSec <= 0) {
      window.location.replace("/");
      return;
    }
    const id = window.setTimeout(() => {
      setExitInSec((prev) => (prev == null ? null : prev - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [exitInSec]);

  useEffect(() => {
    if (exitInSec == null || !closingReason) return;
    setSubmitMessage(`${closingReason} Closing in ${exitInSec}…`);
  }, [exitInSec, closingReason]);

  // Block clipboard / context menu
  useEffect(() => {
    if (!gateReady || locked || !security.blockClipboard) return;

    const block = (event: Event) => {
      event.preventDefault();
      setFocusWarning("Copy / paste is disabled during this exam.");
      void reportViolation("clipboard", event.type);
    };

    document.addEventListener("copy", block, true);
    document.addEventListener("cut", block, true);
    document.addEventListener("paste", block, true);
    document.addEventListener("contextmenu", block, true);

    return () => {
      document.removeEventListener("copy", block, true);
      document.removeEventListener("cut", block, true);
      document.removeEventListener("paste", block, true);
      document.removeEventListener("contextmenu", block, true);
    };
  }, [gateReady, locked, security.blockClipboard, reportViolation]);

  // Fullscreen + block leave shortcuts; lock exam if they still leave
  useEffect(() => {
    if (!gateReady || locked || !security.blockFocusSwitch || !focusGuardEnabled) {
      return;
    }

    const lockExam = (detail: string, message: string) => {
      if (leaveLockActiveRef.current) return;
      leaveLockActiveRef.current = true;
      setFocusWarning(message);
      void reportViolation("focus_switch", detail);
    };

    const armFullscreen = async () => {
      const ok = await enterExamFullscreen();
      setNeedsFullscreenClick(!ok);
      if (!ok) {
        setFocusWarning(
          "Fullscreen mode is required. Click the button below to enter secure fullscreen, then continue the exam.",
        );
      }
    };

    void armFullscreen();

    const onLeave = (detail: string) => {
      lockExam(
        detail,
        "Leaving this exam tab or window is not allowed. Return here and re-enter fullscreen to continue.",
      );
    };

    const onVisibility = () => {
      if (document.hidden) onLeave("visibilitychange");
    };

    const onBlur = () => {
      // Ignore blur while our own modal has focus / during brief focus moves.
      window.setTimeout(() => {
        if (!focusGuardEnabledRef.current || lockedRef.current) return;
        if (document.hidden || !document.hasFocus()) {
          onLeave("window_blur");
        }
      }, 0);
    };

    const onFullscreenChange = () => {
      if (ignoreFullscreenExitRef.current) return;
      if (!document.fullscreenElement) {
        onLeave("fullscreen_exit");
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isLeaveExamShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      lockExam(
        `shortcut:${event.key}`,
        "Tab / window switching shortcuts are disabled during this exam.",
      );
    };

    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [gateReady, locked, security.blockFocusSwitch, focusGuardEnabled, reportViolation]);

  // Dev bypass: Insert key disables/enables screen-switch guard
  useEffect(() => {
    if (!gateReady || locked || !security.blockFocusSwitch) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Insert" && event.code !== "Insert") return;
      event.preventDefault();
      setFocusGuardEnabled((prev) => {
        const next = !prev;
        setFocusWarning(null);
        setNeedsFullscreenClick(false);
        if (next) {
          setSubmitMessage("Screen-switch protection re-enabled.");
          void enterExamFullscreen().then((ok) => setNeedsFullscreenClick(!ok));
        } else {
          setSubmitMessage("Dev mode: screen-switch protection disabled (Insert).");
          ignoreFullscreenExitRef.current = true;
          exitExamFullscreen();
          window.setTimeout(() => {
            ignoreFullscreenExitRef.current = false;
          }, 400);
        }
        return next;
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gateReady, locked, security.blockFocusSwitch]);

  // Warn before unexpected close
  useEffect(() => {
    if (!gateReady || locked) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!focusGuardEnabledRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [gateReady, locked]);

  useEffect(() => {
    if (!invite?.endsAt || locked || invite.alreadySubmitted || !gateReady) return;

    const tick = () => {
      const left = new Date(invite.endsAt!).getTime() - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !autoSubmitStarted.current) {
        autoSubmitStarted.current = true;
        void doSubmit(true);
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [invite, locked, doSubmit, gateReady]);

  const activeProblem = useMemo(
    () => invite?.problems.find((p) => p.id === activeProblemId) ?? null,
    [invite, activeProblemId],
  );

  const sourceKey = activeProblem ? `${activeProblem.id}:${language}` : "";
  const currentSource = sources[sourceKey] ?? "";
  const timerUrgent = remainingMs != null && remainingMs <= 5 * 60_000;

  function updateSource(value: string | undefined) {
    if (!activeProblem || locked || focusWarning) return;
    const next = value ?? "";
    setSources((prev) => ({ ...prev, [sourceKey]: next }));
    localStorage.setItem(storageKey(token, activeProblem.id, language), next);
  }

  if (loading && !blockedReason && !error) {
    return (
      <div className="shell">
        <div className="secure-gate">
          <h1>Secure exam check</h1>
          <p className="hint">{gateMessage}</p>
        </div>
      </div>
    );
  }

  if (blockedReason) {
    return (
      <div className="shell">
        <div className="secure-gate blocked">
          <h1>Exam blocked</h1>
          <p>{blockedReason}</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload and retry
          </button>
        </div>
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="shell">
        <div className="secure-gate blocked">
          <h1>Unable to open exam</h1>
          <p className="error">{error ?? "Invite not found"}</p>
          <a className="link" href="/">
            Back home
          </a>
        </div>
      </div>
    );
  }

  if (!rulesAccepted && !invite.alreadySubmitted) {
    return (
      <div className="shell">
        <div className="secure-gate rules-gate">
          <p className="eyebrow">Live Coding Interview</p>
          <h1>Exam rules</h1>
          <p className="hint">
            Hi {invite.candidateName}. Please read these rules before you start. The timer begins
            only after you continue.
          </p>

          <ul className="rules-list">
            <li>
              Total time limit: <strong>{invite.totalTimeboxMinutes} minutes</strong>. When time
              runs out, your answers are submitted automatically.
            </li>
            <li>
              <strong>One browser / device only</strong>. Opening this invite elsewhere while you
              are online will be blocked.
            </li>
            {security.blockClipboard && (
              <li>
                <strong>No copy / paste</strong> and no right-click paste during the exam.
              </li>
            )}
            {security.blockFocusSwitch && (
              <li>
                <strong>Stay on this exam tab</strong> in fullscreen. Switching tabs, apps, or
                monitors is not allowed and will lock the editor until you return.
              </li>
            )}
            {security.blockMultiMonitor && (
              <li>
                Use a <strong>single display</strong>. Disconnect extra monitors before starting.
              </li>
            )}
            {security.cameraRequired ? (
              <li>
                <strong>Camera is required</strong>. You must allow camera access to start this
                exam.
              </li>
            ) : security.showCameraPreview ? (
              <li>
                <strong>Camera is optional</strong>. You may enable a camera preview for integrity
                checks, or continue without a camera.
              </li>
            ) : null}
            <li>Do not close this page until you submit. Unsaved work may be lost if you leave.</li>
          </ul>

          {security.showCameraPreview && (
            <label className="rules-check">
              <input
                type="checkbox"
                checked={enableCamera}
                onChange={(e) => setEnableCamera(e.target.checked)}
                disabled={security.cameraRequired}
              />
              <span>
                {security.cameraRequired
                  ? "Camera access is required for this exam"
                  : "Enable camera preview "}
                {!security.cameraRequired && <em>(optional)</em>}
              </span>
            </label>
          )}

          <label className="rules-check">
            <input
              type="checkbox"
              checked={rulesAck}
              onChange={(e) => setRulesAck(e.target.checked)}
            />
            <span>I have read and agree to follow these exam rules.</span>
          </label>

          <button
            type="button"
            className="btn-primary"
            disabled={
              !rulesAck ||
              startingExam ||
              (security.cameraRequired && !enableCamera)
            }
            onClick={() => void startSecureExam()}
          >
            {startingExam ? "Starting…" : "Agree and start exam"}
          </button>
        </div>
      </div>
    );
  }

  if (!gateReady) {
    return (
      <div className="shell">
        <div className="secure-gate">
          <h1>Secure exam check</h1>
          <p className="hint">{gateMessage}</p>
        </div>
      </div>
    );
  }

  if (exitInSec != null) {
    return (
      <div className="shell">
        <div className="secure-gate">
          <h1>{locked && closingReason?.toLowerCase().includes("submitted") ? "Submitted" : "Exam closed"}</h1>
          <p>{submitMessage ?? closingReason}</p>
          <p className="hint">Returning to home…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`shell interview ${focusWarning ? "exam-locked-overlay" : ""}`}>
      <header className="topbar">
        <div>
          <div className="brand">Live Coding Interview</div>
          <div className="meta">
            {invite.candidateName}
            {locked ? " · submitted" : " · in progress"}
            {` · total ${invite.totalTimeboxMinutes} min`}
            {" · secure mode"}
          </div>
        </div>
        <div className="topbar-actions">
          <div
            className={`timer ${locked ? "timer-done" : timerUrgent ? "timer-urgent" : ""}`}
            aria-live="polite"
          >
            {locked
              ? "Time ended"
              : remainingMs == null
                ? "—"
                : `Time left ${formatRemaining(remainingMs)}`}
          </div>
          <span className="badge">
            {security.blockFocusSwitch && !focusGuardEnabled
              ? "Dev: switch allowed (Insert)"
              : [
                  security.blockClipboard ? "No copy/paste" : null,
                  security.blockFocusSwitch ? "No screen switch" : null,
                  security.blockMultiMonitor ? "Single display" : null,
                  security.cameraRequired
                    ? "Camera required"
                    : security.showCameraPreview
                      ? "Camera optional"
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Relaxed mode"}
          </span>
          <button
            type="button"
            className="submit"
            disabled={submitting || locked || Boolean(focusWarning)}
            onClick={() => void doSubmit(false)}
          >
            {locked ? "Submitted" : submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </header>

      {submitMessage && (
        <div className={locked ? "banner ok" : "banner warn"}>{submitMessage}</div>
      )}

      {focusWarning && (
        <div className="focus-blocker" role="alertdialog" aria-modal="true">
          <div className="focus-card">
            <h2>Action not allowed</h2>
            <p>{focusWarning}</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                void (async () => {
                  const ok = await enterExamFullscreen();
                  setNeedsFullscreenClick(!ok);
                  if (ok || !focusGuardEnabled) {
                    setFocusWarning(null);
                    window.focus();
                  } else {
                    setFocusWarning(
                      "Fullscreen was blocked by the browser. Allow fullscreen, then click again to continue.",
                    );
                  }
                })();
              }}
            >
              {needsFullscreenClick
                ? "Enter fullscreen & continue"
                : "I understand — return to exam"}
            </button>
          </div>
        </div>
      )}

      <div className="interview-layout">
        <aside className="problem-nav">
          <h2>Problems</h2>
          <ul>
            {invite.problems.map((problem) => (
              <li key={problem.id}>
                <button
                  type="button"
                  className={problem.id === activeProblemId ? "active" : ""}
                  disabled={Boolean(focusWarning)}
                  onClick={() => {
                    setActiveProblemId(problem.id);
                    setLanguage(problem.languages[0] ?? "py");
                  }}
                >
                  <span className="problem-title">{problem.title}</span>
                  {problem.timeboxMinutes != null && (
                    <span className="problem-time">Suggested {problem.timeboxMinutes} min</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="prompt-pane">
          {activeProblem && (
            <>
              <h1>{activeProblem.title}</h1>
              <p className="summary">{activeProblem.summary}</p>
              <article className="markdown">{activeProblem.prompt}</article>
            </>
          )}
        </section>

        <section className="editor-pane">
          {activeProblem && (
            <>
              <div className="editor-toolbar">
                <label>
                  Language
                  <select
                    value={language}
                    disabled={locked || Boolean(focusWarning)}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {activeProblem.languages.map((lang) => (
                      <option key={lang} value={lang}>
                        {LANG_LABEL[lang] ?? lang}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="autosave">Autosaved locally</span>
              </div>
              <Editor
                height="100%"
                language={monacoLanguage(language)}
                theme="vs-dark"
                value={currentSource}
                onChange={updateSource}
                options={{
                  readOnly: locked || Boolean(focusWarning),
                  minimap: { enabled: false },
                  fontSize: 14,
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  contextmenu: !security.blockClipboard,
                  copyWithSyntaxHighlighting: false,
                }}
              />
            </>
          )}
        </section>
      </div>

      {security.showCameraPreview && !locked && (
        <div className="camera-pip" aria-label="Camera preview">
          {cameraStream && !cameraFailed ? (
            <video ref={videoRef} autoPlay muted playsInline />
          ) : (
            <div className="camera-black">
              <span>Camera off</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
