import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOfflineSession,
  sendOfflineHeartbeat,
  submitOfflineAnswers,
  uploadOfflineSnapshot,
  type OfflineSession,
} from "./api";
import { OFFLINE_EXAM, type OfflineProblem } from "./examPack";
import {
  detectMultipleDisplays,
  enterExamFullscreen,
  exitExamFullscreen,
  getOrCreateDeviceSessionId,
  isLeaveExamShortcut,
  type SecurityFlags,
} from "./security";

type Phase = "register" | "rules" | "gate" | "exam" | "closing";

const LANG_LABEL: Record<string, string> = { py: "Python" };

function monacoLanguage(ext: string): string {
  if (ext === "py") return "python";
  return "plaintext";
}

function storageKey(problemId: string, language: string): string {
  return `live-coding:offline:${problemId}:${language}`;
}

function loadDraft(problem: OfflineProblem, language: string): string {
  const saved = localStorage.getItem(storageKey(problem.id, language));
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

function captureVideoJpeg(video: HTMLVideoElement): string | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function App() {
  const [phase, setPhase] = useState<Phase>("register");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [enableCamera, setEnableCamera] = useState(false);
  const [rulesAck, setRulesAck] = useState(false);
  const [startingExam, setStartingExam] = useState(false);
  const [gateMessage, setGateMessage] = useState("Preparing secure exam environment…");
  const [error, setError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const [session, setSession] = useState<OfflineSession | null>(null);
  const [deviceSessionId] = useState(() => getOrCreateDeviceSessionId());
  const security: SecurityFlags = OFFLINE_EXAM.security;

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const snapshotTakenRef = useRef(false);

  const [activeProblemId, setActiveProblemId] = useState<string | null>(
    OFFLINE_EXAM.problems[0]?.id ?? null,
  );
  const [language, setLanguage] = useState("py");
  const [sources, setSources] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [exitInSec, setExitInSec] = useState<number | null>(null);
  const [closingReason, setClosingReason] = useState<string | null>(null);
  const [closingDone, setClosingDone] = useState(false);

  const [focusWarning, setFocusWarning] = useState<string | null>(null);
  const [focusGuardEnabled, setFocusGuardEnabled] = useState(true);
  const [needsFullscreenClick, setNeedsFullscreenClick] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourcesRef = useRef(sources);
  const sessionRef = useRef(session);
  const lockedRef = useRef(locked);
  const submittingRef = useRef(submitting);
  const autoSubmitStarted = useRef(false);
  const focusGuardEnabledRef = useRef(focusGuardEnabled);
  const ignoreFullscreenExitRef = useRef(false);
  const leaveLockActiveRef = useRef(false);
  const endsAtRef = useRef<string | null>(null);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);
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

  const doSubmit = useCallback(
    async (autoSubmitted: boolean) => {
      const currentSession = sessionRef.current;
      if (!currentSession || lockedRef.current || submittingRef.current) return;

      setSubmitting(true);
      setSubmitMessage(autoSubmitted ? "Time is up — submitting your answers…" : null);
      try {
        const answers = OFFLINE_EXAM.problems.flatMap((problem) =>
          problem.languages.map((lang) => ({
            problemId: problem.id,
            language: lang,
            source:
              sourcesRef.current[`${problem.id}:${lang}`] ??
              problem.starters[lang] ??
              "",
          })),
        );
        const result = await submitOfflineAnswers(currentSession.id, deviceSessionId, {
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
        setPhase("closing");
        cameraStream?.getTracks().forEach((track) => track.stop());
        exitExamFullscreen();
      } catch (err) {
        if (autoSubmitted) autoSubmitStarted.current = false;
        setSubmitMessage(err instanceof Error ? err.message : "Submit failed");
      } finally {
        setSubmitting(false);
      }
    },
    [deviceSessionId, cameraStream],
  );

  const startSecureExam = useCallback(async () => {
    if (startingExam) return;
    const name = candidateName.trim();
    const email = candidateEmail.trim();
    if (!name || !email) {
      setError("Name and email are required.");
      return;
    }

    setStartingExam(true);
    setError(null);
    setBlockedReason(null);
    setGateMessage("Preparing secure exam environment…");
    setPhase("gate");

    let localStream: MediaStream | null = null;

    try {
      if (security.blockMultiMonitor) {
        setGateMessage("Checking display configuration…");
        const display = await detectMultipleDisplays();
        if (display.multiple) {
          setBlockedReason(
            `${display.detail} Please disconnect extra monitors/displays and retry.`,
          );
          setPhase("rules");
          return;
        }
      }

      if (enableCamera) {
        setGateMessage("Requesting camera…");
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
          if (security.cameraRequired) {
            setBlockedReason(
              "Camera access is required for this exam. Enable your camera and retry.",
            );
            setPhase("rules");
            return;
          }
        }
      } else {
        setCameraStream(null);
        setCameraFailed(false);
      }

      setGateMessage("Starting exam session…");
      const created = await createOfflineSession({
        candidateName: name,
        candidateEmail: email,
        deviceSessionId,
        cameraEnabled: enableCamera,
        totalTimeboxMinutes: OFFLINE_EXAM.totalTimeboxMinutes,
      });

      setSession(created);
      endsAtRef.current = created.endsAt;
      setLocked(false);
      setRemainingMs(new Date(created.endsAt).getTime() - Date.now());
      snapshotTakenRef.current = false;

      const first = OFFLINE_EXAM.problems[0];
      if (first) {
        setActiveProblemId(first.id);
        const lang = first.languages[0] ?? "py";
        setLanguage(lang);
        const initial: Record<string, string> = {};
        for (const problem of OFFLINE_EXAM.problems) {
          for (const langId of problem.languages) {
            initial[`${problem.id}:${langId}`] = loadDraft(problem, langId);
          }
        }
        setSources(initial);
      }

      setPhase("exam");
    } catch (err) {
      localStream?.getTracks().forEach((t) => t.stop());
      setPhase("rules");
      setError(err instanceof Error ? err.message : "Could not start exam");
    } finally {
      setStartingExam(false);
    }
  }, [
    startingExam,
    candidateName,
    candidateEmail,
    enableCamera,
    deviceSessionId,
    security.blockMultiMonitor,
    security.cameraRequired,
  ]);

  // Heartbeat every 5s
  useEffect(() => {
    if (phase !== "exam" || locked || !session) return;

    let cancelled = false;

    const ping = async () => {
      try {
        const result = await sendOfflineHeartbeat(session.id, deviceSessionId);
        if (result.endsAt) {
          endsAtRef.current = result.endsAt;
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Heartbeat failed";
        if (/expired|exam closed/i.test(message)) {
          if (!autoSubmitStarted.current) {
            autoSubmitStarted.current = true;
            void doSubmit(true);
          }
        }
      }
    };

    void ping();
    const id = window.setInterval(() => void ping(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, locked, session, deviceSessionId, doSubmit]);

  // Camera snapshot ~10s after exam start
  useEffect(() => {
    if (phase !== "exam" || !session || !enableCamera || !cameraStream || snapshotTakenRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      const video = videoRef.current;
      if (!video || snapshotTakenRef.current) return;
      const base64 = captureVideoJpeg(video);
      if (!base64) return;
      snapshotTakenRef.current = true;
      void uploadOfflineSnapshot(session.id, deviceSessionId, base64).catch(() => {
        snapshotTakenRef.current = false;
      });
    }, 10_000);

    return () => window.clearTimeout(timer);
  }, [phase, session, enableCamera, cameraStream, deviceSessionId]);

  // Closing countdown
  useEffect(() => {
    if (phase !== "closing" || exitInSec == null) return;
    if (exitInSec <= 0) {
      setClosingDone(true);
      return;
    }
    const id = window.setTimeout(() => {
      setExitInSec((prev) => (prev == null ? null : prev - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [phase, exitInSec]);

  useEffect(() => {
    if (exitInSec == null || !closingReason) return;
    setSubmitMessage(`${closingReason} Closing in ${exitInSec}…`);
  }, [exitInSec, closingReason]);

  // Clipboard block
  useEffect(() => {
    if (phase !== "exam" || locked || !security.blockClipboard) return;

    const block = (event: Event) => {
      event.preventDefault();
      setFocusWarning("Copy / paste is disabled during this exam.");
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
  }, [phase, locked, security.blockClipboard]);

  // Fullscreen + focus guard
  useEffect(() => {
    if (phase !== "exam" || locked || !security.blockFocusSwitch || !focusGuardEnabled) {
      return;
    }

    const lockExam = (detail: string, message: string) => {
      if (leaveLockActiveRef.current) return;
      leaveLockActiveRef.current = true;
      setFocusWarning(message);
      void detail;
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
        "Leaving this exam window is not allowed. Return here and re-enter fullscreen to continue.",
      );
    };

    const onVisibility = () => {
      if (document.hidden) onLeave("visibilitychange");
    };

    const onBlur = () => {
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
  }, [phase, locked, security.blockFocusSwitch, focusGuardEnabled]);

  // Dev bypass: Insert key toggles focus guard
  useEffect(() => {
    if (phase !== "exam" || locked || !security.blockFocusSwitch) return;

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
  }, [phase, locked, security.blockFocusSwitch]);

  // Timer + auto-submit
  useEffect(() => {
    if (phase !== "exam" || locked || !endsAtRef.current) return;

    const tick = () => {
      const left = new Date(endsAtRef.current!).getTime() - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !autoSubmitStarted.current) {
        autoSubmitStarted.current = true;
        void doSubmit(true);
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase, locked, doSubmit, session]);

  const activeProblem = useMemo(
    () => OFFLINE_EXAM.problems.find((p) => p.id === activeProblemId) ?? null,
    [activeProblemId],
  );

  const sourceKey = activeProblem ? `${activeProblem.id}:${language}` : "";
  const currentSource = sources[sourceKey] ?? "";
  const timerUrgent = remainingMs != null && remainingMs <= 5 * 60_000;

  function updateSource(value: string | undefined) {
    if (!activeProblem || locked || focusWarning) return;
    const next = value ?? "";
    setSources((prev) => ({ ...prev, [sourceKey]: next }));
    localStorage.setItem(storageKey(activeProblem.id, language), next);
  }

  function canProceedFromRegister(): boolean {
    return candidateName.trim().length > 0 && candidateEmail.trim().includes("@");
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

  if (phase === "register") {
    return (
      <div className="shell">
        <div className="secure-gate rules-gate">
          <p className="eyebrow">Live Coding Exam</p>
          <h1>Candidate registration</h1>
          <p className="hint">Enter your details before reviewing the exam rules.</p>

          <label className="field-label">
            Full name
            <input
              type="text"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </label>

          <label className="field-label">
            Email
            <input
              type="email"
              value={candidateEmail}
              onChange={(e) => setCandidateEmail(e.target.value)}
              placeholder="jane@example.com"
              autoComplete="email"
            />
          </label>

          <label className="rules-check">
            <input
              type="checkbox"
              checked={enableCamera}
              onChange={(e) => setEnableCamera(e.target.checked)}
            />
            <span>
              Enable camera for integrity snapshot <em>(optional, off by default)</em>
            </span>
          </label>

          {error && <p className="error">{error}</p>}

          <button
            type="button"
            className="btn-primary"
            disabled={!canProceedFromRegister()}
            onClick={() => {
              setError(null);
              setPhase("rules");
            }}
          >
            Continue to rules
          </button>
        </div>
      </div>
    );
  }

  if (phase === "rules") {
    return (
      <div className="shell">
        <div className="secure-gate rules-gate">
          <p className="eyebrow">Live Coding Exam</p>
          <h1>Exam rules</h1>
          <p className="hint">
            Hi {candidateName.trim()}. Please read these rules before you start. The timer begins
            only after you agree.
          </p>

          <ul className="rules-list">
            <li>
              Total time limit: <strong>{OFFLINE_EXAM.totalTimeboxMinutes} minutes</strong>. When
              time runs out, your answers are submitted automatically.
            </li>
            <li>
              <strong>No copy / paste</strong> and no right-click paste during the exam.
            </li>
            <li>
              <strong>Stay in this exam window</strong> in fullscreen. Switching tabs, apps, or
              monitors is not allowed and will lock the editor until you return.
            </li>
            <li>
              Use a <strong>single display</strong>. Disconnect extra monitors before starting.
            </li>
            {enableCamera ? (
              <li>
                <strong>Camera enabled</strong>. A snapshot will be captured shortly after the exam
                starts.
              </li>
            ) : (
              <li>
                <strong>Camera is off</strong>. You may continue without a camera for this session.
              </li>
            )}
            <li>Do not close this app until you submit. Unsaved work may be lost if you leave.</li>
          </ul>

          <label className="rules-check">
            <input
              type="checkbox"
              checked={rulesAck}
              onChange={(e) => setRulesAck(e.target.checked)}
            />
            <span>I have read and agree to follow these exam rules.</span>
          </label>

          {error && <p className="error">{error}</p>}

          <button
            type="button"
            className="btn-primary"
            disabled={!rulesAck || startingExam}
            onClick={() => void startSecureExam()}
          >
            {startingExam ? "Starting…" : "Agree and start exam"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "gate") {
    return (
      <div className="shell">
        <div className="secure-gate">
          <h1>Secure exam check</h1>
          <p className="hint">{gateMessage}</p>
        </div>
      </div>
    );
  }

  if (phase === "closing") {
    return (
      <div className="shell">
        <div className="secure-gate">
          <h1>{locked ? "Submitted" : "Exam closed"}</h1>
          <p>{submitMessage ?? closingReason}</p>
          {closingDone ? (
            <div className="closing-actions">
              <p className="hint">You may now close the application.</p>
              {window.electronAPI?.isElectron ? (
                <button type="button" className="btn-primary" onClick={() => window.electronAPI?.quit()}>
                  Quit application
                </button>
              ) : (
                <p className="hint">Done.</p>
              )}
            </div>
          ) : (
            <p className="hint">Please wait…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`shell interview ${focusWarning ? "exam-locked-overlay" : ""}`}>
      <header className="topbar">
        <div>
          <div className="brand">Live Coding Exam</div>
          <div className="meta">
            {candidateName.trim()}
            {locked ? " · submitted" : " · in progress"}
            {` · total ${OFFLINE_EXAM.totalTimeboxMinutes} min`}
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
                  enableCamera ? "Camera on" : "Camera off",
                ]
                  .filter(Boolean)
                  .join(" · ")}
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

      {submitMessage && phase === "exam" && (
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
                      "Fullscreen was blocked. Allow fullscreen, then click again to continue.",
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
            {OFFLINE_EXAM.problems.map((problem) => (
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

      {enableCamera && !locked && (
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
