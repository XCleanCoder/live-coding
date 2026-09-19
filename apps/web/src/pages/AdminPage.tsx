import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  adminLogin,
  changeAdminPassword,
  createInvite,
  deleteInvite,
  deleteOfflineSession,
  deleteProblem,
  deleteSubmission,
  getOfflineSessionDetail,
  getOfflineSessionSnapshot,
  getSubmission,
  listAdminProblems,
  listInvites,
  listOfflineSessions,
  listSubmissions,
  upsertProblem,
  type InviteAdmin,
  type InviteSecurity,
  type OfflineSessionAdmin,
  type Problem,
  type SubmissionDetail,
  type SubmissionSummary,
} from "../api";

async function readTextFile(file: File | null): Promise<string> {
  if (!file) return "";
  return file.text();
}

function assertTxt(file: File | null, label: string) {
  if (!file) return;
  const name = file.name.toLowerCase();
  if (!name.endsWith(".txt")) {
    throw new Error(`${label} must be a .txt file`);
  }
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

type FieldErrors = Record<string, string>;

function ModalShell({
  open,
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-root" role="presentation" onClick={onClose}>
      <div
        className={`modal-card ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="hint">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  const [problems, setProblems] = useState<Problem[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [invites, setInvites] = useState<InviteAdmin[]>([]);
  const [offlineSessions, setOfflineSessions] = useState<OfflineSessionAdmin[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toast, setToast] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [previousPassword, setPreviousPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<FieldErrors>({});
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [problemModalOpen, setProblemModalOpen] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SubmissionDetail | null>(null);
  const [offlineDetail, setOfflineDetail] = useState<{
    session: OfflineSessionAdmin;
    answers: Array<{ problemId: string; language: string; source: string }>;
  } | null>(null);
  const [offlineSnapshot, setOfflineSnapshot] = useState<{
    name: string;
    at: string | null;
    src: string;
  } | null>(null);

  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [totalTimeboxMinutes, setTotalTimeboxMinutes] = useState("90");
  const [selectedProblemIds, setSelectedProblemIds] = useState<string[]>([]);
  const [inviteErrors, setInviteErrors] = useState<FieldErrors>({});
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [secBlockClipboard, setSecBlockClipboard] = useState(true);
  const [secBlockFocusSwitch, setSecBlockFocusSwitch] = useState(true);
  const [secBlockMultiMonitor, setSecBlockMultiMonitor] = useState(true);
  const [secShowCamera, setSecShowCamera] = useState(true);
  const [secRequireCamera, setSecRequireCamera] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [timeboxMinutes, setTimeboxMinutes] = useState("");
  const [language, setLanguage] = useState("py");
  const [promptText, setPromptText] = useState("");
  const [starterText, setStarterText] = useState("");
  const [problemErrors, setProblemErrors] = useState<FieldErrors>({});
  const [problemSubmitting, setProblemSubmitting] = useState(false);

  const counts = useMemo(() => {
    return {
      start: invites.filter((i) => i.status === "Start").length,
      pending: invites.filter((i) => i.status === "Pending").length,
      stop: invites.filter((i) => i.status === "Stop").length,
      expired: invites.filter((i) => i.status === "Expired").length,
      submitted: invites.filter((i) => i.status === "Submitted").length,
    };
  }, [invites]);

  const offlineCounts = useMemo(() => {
    return {
      pending: offlineSessions.filter((i) => i.status === "Pending").length,
      stop: offlineSessions.filter((i) => i.status === "Stop").length,
      expired: offlineSessions.filter((i) => i.status === "Expired").length,
      submitted: offlineSessions.filter((i) => i.status === "Submitted").length,
    };
  }, [offlineSessions]);

  function showToast(type: "ok" | "error", text: string) {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4200);
  }

  async function refresh(key = adminKey) {
    if (!key) return;
    try {
      const [subs, inv, probs, offline] = await Promise.all([
        listSubmissions(key),
        listInvites(key),
        listAdminProblems(key),
        listOfflineSessions(key),
      ]);
      setSubmissions(subs);
      setInvites(inv);
      setProblems(probs);
      setOfflineSessions(offline);
      setLoading(false);
    } catch (err) {
      setLoading(false);
      const message = err instanceof Error ? err.message : "Failed to load admin data";
      if (message.toLowerCase().includes("unauthorized")) {
        setUnlocked(false);
        setAdminKey("");
        showToast("error", "Access denied. Please sign in again.");
        return;
      }
      showToast("error", message);
    }
  }

  useEffect(() => {
    localStorage.removeItem("live-coding:admin-key");
  }, []);

  useEffect(() => {
    if (!unlocked || !adminKey) return;
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    const poll = window.setInterval(() => void refresh(adminKey), 3000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, adminKey]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    if (!loginPassword.trim()) {
      setLoginError("Password is required.");
      return;
    }
    setLoginSubmitting(true);
    try {
      await adminLogin(loginPassword);
      setAdminKey(loginPassword);
      setUnlocked(true);
      setLoginPassword("");
      setLoading(true);
      await refresh(loginPassword);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Incorrect password");
    } finally {
      setLoginSubmitting(false);
    }
  }

  function lockAdmin() {
    setUnlocked(false);
    setAdminKey("");
    setInvites([]);
    setOfflineSessions([]);
    setProblems([]);
    setSubmissions([]);
    setSelectedResult(null);
    setOfflineDetail(null);
    setOfflineSnapshot(null);
    setInviteModalOpen(false);
    setProblemModalOpen(false);
    setResultsModalOpen(false);
    setPasswordModalOpen(false);
  }

  function validatePasswordChange(): FieldErrors {
    const errors: FieldErrors = {};
    if (!previousPassword) errors.previousPassword = "Previous password is required.";
    if (!newPassword) errors.newPassword = "New password is required.";
    else if (newPassword.length < 8) {
      errors.newPassword = "New password must be at least 8 characters.";
    }
    if (!confirmPassword) errors.confirmPassword = "Confirm the new password.";
    else if (confirmPassword !== newPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }
    if (newPassword && previousPassword && newPassword === previousPassword) {
      errors.newPassword = "New password must be different from the previous password.";
    }
    return errors;
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    const errors = validatePasswordChange();
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPasswordSubmitting(true);
    try {
      await changeAdminPassword({
        previousPassword,
        newPassword,
      });
      setAdminKey(newPassword);
      setPasswordModalOpen(false);
      setPreviousPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("ok", "Password updated. Use the new password next time you sign in.");
    } catch (err) {
      setPasswordErrors({
        previousPassword: err instanceof Error ? err.message : "Could not change password",
      });
    } finally {
      setPasswordSubmitting(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="shell admin-shell">
        <header className="topbar admin-topbar">
          <div>
            <div className="brand">Live Coding Admin</div>
            <div className="meta">Password required</div>
          </div>
        </header>
        <main className="admin-single">
          <section className="admin-card login-card">
            <div className="card-kicker">Secure access</div>
            <h1 className="card-title">HR Admin sign in</h1>
            <p className="hint">
              Enter the admin password to continue. Access is not remembered — you will need
              the password every time you open this page.
            </p>
            <form className="modal-form" onSubmit={onLogin} noValidate>
              <label className={loginError ? "has-error" : ""}>
                Password
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter admin password"
                />
                {loginError && <span className="field-error">{loginError}</span>}
              </label>
              <button type="submit" className="btn-primary" disabled={loginSubmitting}>
                {loginSubmitting ? "Checking…" : "Sign in"}
              </button>
            </form>
          </section>
        </main>
      </div>
    );
  }

  function openCreateInvite() {
    setCandidateName("");
    setCandidateEmail("");
    setTotalTimeboxMinutes("90");
    setSelectedProblemIds(problems.map((p) => p.id));
    setSecBlockClipboard(true);
    setSecBlockFocusSwitch(true);
    setSecBlockMultiMonitor(true);
    setSecShowCamera(true);
    setSecRequireCamera(false);
    setInviteErrors({});
    setInviteModalOpen(true);
  }

  function openAddProblem() {
    setEditingId(null);
    setTitle("");
    setSummary("");
    setTimeboxMinutes("");
    setLanguage("py");
    setPromptText("");
    setStarterText("");
    setProblemErrors({});
    setProblemModalOpen(true);
  }

  function openEditProblem(problem: Problem) {
    const lang = problem.languages[0] ?? "py";
    setEditingId(problem.id);
    setTitle(problem.title);
    setSummary(problem.summary);
    setTimeboxMinutes(problem.timeboxMinutes == null ? "" : String(problem.timeboxMinutes));
    setLanguage(lang);
    setPromptText(problem.prompt);
    setStarterText(problem.starters[lang] ?? Object.values(problem.starters)[0] ?? "");
    setProblemErrors({});
    setProblemModalOpen(true);
  }

  function validateInvite(): FieldErrors {
    const errors: FieldErrors = {};
    if (!candidateName.trim()) errors.candidateName = "Candidate name is required.";
    else if (candidateName.trim().length < 2) {
      errors.candidateName = "Name must be at least 2 characters.";
    }

    if (candidateEmail.trim()) {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail.trim());
      if (!ok) errors.candidateEmail = "Enter a valid email address.";
    }

    const minutes = Number(totalTimeboxMinutes);
    if (!totalTimeboxMinutes.trim()) {
      errors.totalTimeboxMinutes = "Total exam time is required.";
    } else if (!Number.isFinite(minutes) || minutes <= 0) {
      errors.totalTimeboxMinutes = "Enter a positive number of minutes.";
    } else if (minutes > 24 * 60) {
      errors.totalTimeboxMinutes = "Maximum allowed is 1440 minutes (24 hours).";
    }

    if (problems.length === 0) {
      errors.problems = "Add at least one problem before creating an invite.";
    } else if (selectedProblemIds.length === 0) {
      errors.problems = "Select at least one problem for this invite.";
    }

    return errors;
  }

  function validateProblem(): FieldErrors {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = "Problem title is required.";
    else if (title.trim().length < 3) errors.title = "Title must be at least 3 characters.";

    if (timeboxMinutes.trim()) {
      const minutes = Number(timeboxMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        errors.timeboxMinutes = "Optional timebox must be a positive number.";
      }
    }

    if (!promptText.trim()) {
      errors.promptText = "Problem prompt is required.";
    } else if (promptText.trim().length < 20) {
      errors.promptText = "Prompt looks too short. Add clearer instructions.";
    }

    if (!starterText.trim()) {
      errors.starterText = "Starter code is required.";
    }

    if (!language) errors.language = "Select a language.";

    return errors;
  }

  async function onCreateInvite(e: FormEvent) {
    e.preventDefault();
    const errors = validateInvite();
    setInviteErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setInviteSubmitting(true);
    try {
      const security: InviteSecurity = {
        blockClipboard: secBlockClipboard,
        blockFocusSwitch: secBlockFocusSwitch,
        blockMultiMonitor: secBlockMultiMonitor,
        showCameraPreview: secShowCamera || secRequireCamera,
        cameraRequired: secRequireCamera,
      };
      const result = await createInvite(adminKey, {
        candidateName: candidateName.trim(),
        candidateEmail: candidateEmail.trim() || undefined,
        problemIds: selectedProblemIds,
        totalTimeboxMinutes: Number(totalTimeboxMinutes),
        security,
      });
      const url = `${window.location.origin}${result.interviewUrl}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast("ok", `Invite created for ${result.candidateName}. Link copied.`);
      } catch {
        showToast("ok", `Invite created for ${result.candidateName}: ${url}`);
      }
      setInviteModalOpen(false);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not create invite");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function onSaveProblem(e: FormEvent) {
    e.preventDefault();
    const errors = validateProblem();
    setProblemErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setProblemSubmitting(true);
    try {
      const saved = await upsertProblem(adminKey, {
        id: editingId ?? undefined,
        title: title.trim(),
        summary: summary.trim(),
        timeboxMinutes: timeboxMinutes.trim() === "" ? null : Number(timeboxMinutes),
        language,
        promptText,
        starterText,
      });
      showToast("ok", editingId ? `Updated “${saved.title}”` : `Added “${saved.title}”`);
      setProblemModalOpen(false);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not save problem");
    } finally {
      setProblemSubmitting(false);
    }
  }

  async function onPromptFileChange(file: File | null) {
    if (!file) return;
    try {
      assertTxt(file, "Prompt");
      setPromptText(await readTextFile(file));
      setProblemErrors((prev) => {
        const next = { ...prev };
        delete next.promptText;
        return next;
      });
    } catch (err) {
      setProblemErrors((prev) => ({
        ...prev,
        promptText: err instanceof Error ? err.message : "Invalid prompt file",
      }));
    }
  }

  async function onStarterFileChange(file: File | null) {
    if (!file) return;
    try {
      assertTxt(file, "Starter");
      setStarterText(await readTextFile(file));
      setProblemErrors((prev) => {
        const next = { ...prev };
        delete next.starterText;
        return next;
      });
    } catch (err) {
      setProblemErrors((prev) => ({
        ...prev,
        starterText: err instanceof Error ? err.message : "Invalid starter file",
      }));
    }
  }

  async function onDeleteInvite(token: string, status: string) {
    if (!confirm(`Delete invite (${status})?\nSubmissions for this invite will also be removed.`)) {
      return;
    }
    try {
      await deleteInvite(adminKey, token);
      showToast("ok", "Invite deleted");
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not delete invite");
    }
  }

  async function onDeleteProblem(id: string) {
    if (!confirm(`Delete problem ${id}?`)) return;
    try {
      await deleteProblem(adminKey, id);
      showToast("ok", "Problem deleted");
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not delete problem");
    }
  }

  async function openResults(inviteToken: string) {
    const match = submissions.find((s) => s.inviteToken === inviteToken);
    if (!match) {
      showToast("error", "No submission found for this invite");
      return;
    }
    try {
      setSelectedResult(await getSubmission(adminKey, match.id));
      setResultsModalOpen(true);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not load results");
    }
  }

  async function onDeleteResult() {
    if (!selectedResult) return;
    if (!confirm(`Delete results for ${selectedResult.candidateName}?`)) return;
    try {
      await deleteSubmission(adminKey, selectedResult.id);
      showToast("ok", "Submission deleted");
      setResultsModalOpen(false);
      setSelectedResult(null);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not delete submission");
    }
  }

  async function openOfflineResults(id: string) {
    try {
      const detail = await getOfflineSessionDetail(adminKey, id);
      setOfflineDetail({ session: detail, answers: detail.answers });
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not load offline results");
    }
  }

  async function openOfflineSnapshot(session: OfflineSessionAdmin) {
    try {
      const snap = await getOfflineSessionSnapshot(adminKey, session.id);
      const raw = snap.imageBase64;
      const src = raw.startsWith("data:") ? raw : `data:image/jpeg;base64,${raw}`;
      setOfflineSnapshot({
        name: session.candidateName,
        at: snap.snapshotAt,
        src,
      });
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "No snapshot available");
    }
  }

  async function onDeleteOfflineSession(id: string, name: string) {
    if (!confirm(`Delete offline session for ${name}?`)) return;
    try {
      await deleteOfflineSession(adminKey, id);
      showToast("ok", "Offline session deleted");
      setOfflineDetail(null);
      setOfflineSnapshot(null);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Could not delete session");
    }
  }

  function toggleProblem(id: string) {
    setSelectedProblemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="shell admin-shell">
      <header className="topbar admin-topbar">
        <div>
          <div className="brand">Live Coding Admin</div>
          <div className="meta">Invite & problem control center</div>
        </div>
        <a className="ghost-link" href="/">
          Home
        </a>
      </header>

      <main className="admin-single">
        {toast && (
          <div className={`toast toast-${toast.type}`} role="status">
            {toast.text}
          </div>
        )}

        <section className="admin-card">
          <div className="section-head">
            <div>
              <div className="card-kicker">Access</div>
              <h2 className="card-title">Signed in</h2>
              <p className="hint">Password is required again after you leave or refresh this page.</p>
            </div>
            <div className="entity-actions">
              <button type="button" className="btn-ghost" onClick={() => void refresh()}>
                Refresh
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setPreviousPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setPasswordErrors({});
                  setPasswordModalOpen(true);
                }}
              >
                Change password
              </button>
              <button type="button" className="btn-danger-ghost" onClick={lockAdmin}>
                Lock
              </button>
            </div>
          </div>
        </section>

        <section className="admin-card">
          <div className="section-head">
            <div>
              <div className="card-kicker">Workflow</div>
              <h2 className="card-title">Invites</h2>
              <p className="hint">
                {counts.start} Start · {counts.pending} Pending · {counts.stop} Stop ·{" "}
                {counts.expired} Expired · {counts.submitted} Submitted
              </p>
            </div>
            <button type="button" className="btn-primary" onClick={openCreateInvite}>
              Create invite
            </button>
          </div>

          {loading ? (
            <p className="hint">Loading invites…</p>
          ) : invites.length === 0 ? (
            <div className="empty-state">
              <p>No invites yet.</p>
              <p className="hint">Create an invite after you have at least one problem.</p>
            </div>
          ) : (
            <ul className="entity-list">
              {invites.map((invite) => {
                const endsAtMs = invite.endsAt ? new Date(invite.endsAt).getTime() : null;
                const startedMs = invite.examStartedAt
                  ? new Date(invite.examStartedAt).getTime()
                  : null;
                const remainingMs =
                  (invite.status === "Pending" || invite.status === "Stop") && endsAtMs != null
                    ? Math.max(0, endsAtMs - nowMs)
                    : null;
                const elapsedMs =
                  (invite.status === "Pending" ||
                    invite.status === "Stop" ||
                    invite.status === "Expired") &&
                  startedMs != null
                    ? Math.max(
                        0,
                        Math.min(nowMs, endsAtMs ?? nowMs) - startedMs,
                      )
                    : null;
                const problemTitles = invite.problemIds
                  .map((id) => problems.find((p) => p.id === id)?.title ?? id)
                  .join(", ");

                return (
                  <li key={invite.token} className="entity-row">
                    <div className="entity-main">
                      <div className="entity-title-row">
                        <strong className="entity-name">{invite.candidateName}</strong>
                        <span className={`status-pill status-${invite.status.toLowerCase()}`}>
                          {invite.status}
                        </span>
                      </div>

                      <dl className="meta-grid">
                        <div>
                          <dt>Token</dt>
                          <dd className="mono">{invite.token}</dd>
                        </div>
                        <div>
                          <dt>Total time</dt>
                          <dd>{invite.totalTimeboxMinutes} min</dd>
                        </div>
                        <div>
                          <dt>Problems</dt>
                          <dd>{invite.problemIds.length}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{formatDateTime(invite.createdAt)}</dd>
                        </div>
                        {invite.candidateEmail && (
                          <div className="meta-span">
                            <dt>Email</dt>
                            <dd>{invite.candidateEmail}</dd>
                          </div>
                        )}
                        <div className="meta-span">
                          <dt>Assigned problems</dt>
                          <dd>{problemTitles || "—"}</dd>
                        </div>
                        <div className="meta-span">
                          <dt>Security</dt>
                          <dd>
                            <span className="security-tags">
                              {invite.security?.blockClipboard ? (
                                <span className="sec-tag">No copy/paste</span>
                              ) : null}
                              {invite.security?.blockFocusSwitch ? (
                                <span className="sec-tag">No tab switch</span>
                              ) : null}
                              {invite.security?.blockMultiMonitor ? (
                                <span className="sec-tag">Single display</span>
                              ) : null}
                              {invite.security?.cameraRequired ? (
                                <span className="sec-tag">Camera required</span>
                              ) : invite.security?.showCameraPreview ? (
                                <span className="sec-tag">Camera optional</span>
                              ) : null}
                              {!invite.security?.blockClipboard &&
                              !invite.security?.blockFocusSwitch &&
                              !invite.security?.blockMultiMonitor &&
                              !invite.security?.showCameraPreview ? (
                                <span className="sec-tag muted">No extra locks</span>
                              ) : null}
                            </span>
                          </dd>
                        </div>
                      </dl>

                      {invite.status === "Start" && (
                        <div className="info-chip">Waiting for candidate to open the link</div>
                      )}

                      {(invite.status === "Pending" || invite.status === "Stop") && (
                        <div className="timing-grid compact">
                          <div>
                            <span className="timing-label">Elapsed</span>
                            <span>{elapsedMs == null ? "—" : formatClock(elapsedMs)}</span>
                          </div>
                          <div>
                            <span className="timing-label">Remaining</span>
                            <span className="emphasis">
                              {remainingMs == null ? "—" : formatClock(remainingMs)}
                            </span>
                          </div>
                          <div>
                            <span className="timing-label">Presence</span>
                            <span>
                              {invite.status === "Pending" ? "Online (pinging)" : "Offline"}
                            </span>
                          </div>
                          <div>
                            <span className="timing-label">Started</span>
                            <span>{formatDateTime(invite.examStartedAt)}</span>
                          </div>
                        </div>
                      )}

                      {invite.status === "Stop" && (
                        <div className="info-chip warn">
                          Candidate left or closed the exam tab. They can reopen this link to
                          continue (timer keeps running).
                        </div>
                      )}

                      {invite.status === "Expired" && (
                        <div className="info-chip warn">
                          {invite.closedWithoutSubmission
                            ? "Closed after time expired while offline — no answers saved"
                            : "Exam time ran out without a submission"}
                          {" · elapsed "}
                          {elapsedMs == null ? "—" : formatClock(elapsedMs)}
                        </div>
                      )}

                      {invite.status === "Submitted" && (
                        <div className="info-chip ok">
                          Finished {formatDateTime(invite.submittedAt)}
                        </div>
                      )}
                    </div>

                    <div className="entity-actions">
                      <a className="btn-ghost" href={invite.interviewUrl}>
                        Open link
                      </a>
                      {invite.status === "Submitted" && (
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void openResults(invite.token)}
                        >
                          View results
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-danger-ghost"
                        onClick={() => void onDeleteInvite(invite.token, invite.status)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="admin-card">
          <div className="section-head">
            <div>
              <div className="card-kicker">Desktop</div>
              <h2 className="card-title">Offline app manager</h2>
              <p className="hint">
                {offlineCounts.pending} Pending · {offlineCounts.stop} Stop ·{" "}
                {offlineCounts.expired} Expired · {offlineCounts.submitted} Submitted
              </p>
            </div>
          </div>

          {loading ? (
            <p className="hint">Loading offline sessions…</p>
          ) : offlineSessions.length === 0 ? (
            <div className="empty-state">
              <p>No offline exam sessions yet.</p>
              <p className="hint">
                Candidates start from the Offline version Electron app (pings this API).
              </p>
            </div>
          ) : (
            <ul className="entity-list">
              {offlineSessions.map((session) => {
                const endsAtMs = new Date(session.endsAt).getTime();
                const startedMs = new Date(session.startedAt).getTime();
                const remainingMs =
                  session.status === "Pending" || session.status === "Stop"
                    ? Math.max(0, endsAtMs - nowMs)
                    : null;
                const elapsedMs =
                  session.status === "Pending" ||
                  session.status === "Stop" ||
                  session.status === "Expired"
                    ? Math.max(0, Math.min(nowMs, endsAtMs) - startedMs)
                    : session.endedAt
                      ? Math.max(0, new Date(session.endedAt).getTime() - startedMs)
                      : null;

                return (
                  <li key={session.id} className="entity-row">
                    <div className="entity-main">
                      <div className="entity-title-row">
                        <strong className="entity-name">{session.candidateName}</strong>
                        <span className={`status-pill status-${session.status.toLowerCase()}`}>
                          {session.status}
                        </span>
                      </div>

                      <dl className="meta-grid">
                        <div>
                          <dt>Email</dt>
                          <dd>{session.candidateEmail}</dd>
                        </div>
                        <div>
                          <dt>Total time</dt>
                          <dd>{session.totalTimeboxMinutes} min</dd>
                        </div>
                        <div>
                          <dt>Camera</dt>
                          <dd>{session.cameraEnabled ? "On" : "Off"}</dd>
                        </div>
                        <div>
                          <dt>Started</dt>
                          <dd>{formatDateTime(session.startedAt)}</dd>
                        </div>
                        <div>
                          <dt>Ended / stopped</dt>
                          <dd>
                            {formatDateTime(
                              session.submittedAt ?? session.endedAt ?? session.closedAt,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Last ping</dt>
                          <dd>{formatDateTime(session.lastSeenAt)}</dd>
                        </div>
                      </dl>

                      {(session.status === "Pending" || session.status === "Stop") && (
                        <div className="timing-grid compact">
                          <div>
                            <span className="timing-label">Elapsed</span>
                            <span>{elapsedMs == null ? "—" : formatClock(elapsedMs)}</span>
                          </div>
                          <div>
                            <span className="timing-label">Remaining</span>
                            <span className="emphasis">
                              {remainingMs == null ? "—" : formatClock(remainingMs)}
                            </span>
                          </div>
                          <div>
                            <span className="timing-label">Presence</span>
                            <span>
                              {session.status === "Pending" ? "Online (pinging)" : "Offline"}
                            </span>
                          </div>
                        </div>
                      )}

                      {session.status === "Stop" && (
                        <div className="info-chip warn">
                          App closed or lost connection. Candidate can reopen the offline app to
                          continue (timer keeps running).
                        </div>
                      )}

                      {session.status === "Expired" && (
                        <div className="info-chip warn">
                          {session.closedWithoutSubmission
                            ? "Closed after time expired while offline — no answers saved"
                            : "Exam time ran out without a submission"}
                          {" · elapsed "}
                          {elapsedMs == null ? "—" : formatClock(elapsedMs)}
                        </div>
                      )}

                      {session.status === "Submitted" && (
                        <div className="info-chip ok">
                          Finished {formatDateTime(session.submittedAt)}
                          {session.autoSubmitted ? " · auto-submitted" : ""}
                        </div>
                      )}
                    </div>

                    <div className="entity-actions">
                      {session.hasSnapshot && (
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void openOfflineSnapshot(session)}
                        >
                          View snapshot
                        </button>
                      )}
                      {session.status === "Submitted" && (
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void openOfflineResults(session.id)}
                        >
                          View results
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-danger-ghost"
                        onClick={() =>
                          void onDeleteOfflineSession(session.id, session.candidateName)
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="admin-card">
          <div className="section-head">
            <div>
              <div className="card-kicker">Content</div>
              <h2 className="card-title">Problems</h2>
              <p className="hint">{problems.length} problem{problems.length === 1 ? "" : "s"}</p>
            </div>
            <button type="button" className="btn-primary" onClick={openAddProblem}>
              Add problem
            </button>
          </div>

          {problems.length === 0 ? (
            <div className="empty-state">
              <p>No problems uploaded.</p>
              <p className="hint">Add a prompt + starter before creating invites.</p>
            </div>
          ) : (
            <ul className="entity-list">
              {problems.map((problem) => (
                <li key={problem.id} className="entity-row">
                  <div className="entity-main">
                    <div className="entity-title-row">
                      <strong className="entity-name">{problem.title}</strong>
                      <span className="lang-pill">{problem.languages.join(", ")}</span>
                    </div>

                    <dl className="meta-grid">
                      <div>
                        <dt>ID</dt>
                        <dd className="mono">{problem.id}</dd>
                      </div>
                      <div>
                        <dt>Language</dt>
                        <dd>{problem.languages.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Suggested time</dt>
                        <dd>
                          {problem.timeboxMinutes != null
                            ? `${problem.timeboxMinutes} min`
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatDateTime(problem.updatedAt ?? problem.createdAt)}</dd>
                      </div>
                      {problem.summary ? (
                        <div className="meta-span">
                          <dt>Summary</dt>
                          <dd>{problem.summary}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                  <div className="entity-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => openEditProblem(problem)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-danger-ghost"
                      onClick={() => void onDeleteProblem(problem.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>


      <ModalShell
        open={passwordModalOpen}
        title="Change password"
        subtitle="Enter your previous password, then choose a new one."
        onClose={() => setPasswordModalOpen(false)}
      >
        <form className="modal-form" onSubmit={onChangePassword} noValidate>
          <label className={passwordErrors.previousPassword ? "has-error" : ""}>
            Previous password
            <input
              type="password"
              value={previousPassword}
              onChange={(e) => setPreviousPassword(e.target.value)}
              autoComplete="current-password"
            />
            {passwordErrors.previousPassword && (
              <span className="field-error">{passwordErrors.previousPassword}</span>
            )}
          </label>
          <label className={passwordErrors.newPassword ? "has-error" : ""}>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            {passwordErrors.newPassword && (
              <span className="field-error">{passwordErrors.newPassword}</span>
            )}
          </label>
          <label className={passwordErrors.confirmPassword ? "has-error" : ""}>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            {passwordErrors.confirmPassword && (
              <span className="field-error">{passwordErrors.confirmPassword}</span>
            )}
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={() => setPasswordModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={passwordSubmitting}>
              {passwordSubmitting ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </ModalShell>

      <ModalShell
        open={inviteModalOpen}
        title="Create invite"
        subtitle="Assign problems, set the timebox, and choose exam security options."
        wide
        onClose={() => setInviteModalOpen(false)}
      >
        <form className="modal-form invite-create-form" onSubmit={onCreateInvite} noValidate>
          <div className="invite-form-grid">
            <label className={inviteErrors.candidateName ? "has-error" : ""}>
              Candidate name
              <input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="Jane Doe"
              />
              {inviteErrors.candidateName && (
                <span className="field-error">{inviteErrors.candidateName}</span>
              )}
            </label>

            <label className={inviteErrors.candidateEmail ? "has-error" : ""}>
              Email (optional)
              <input
                value={candidateEmail}
                onChange={(e) => setCandidateEmail(e.target.value)}
                placeholder="jane@company.com"
              />
              {inviteErrors.candidateEmail && (
                <span className="field-error">{inviteErrors.candidateEmail}</span>
              )}
            </label>

            <label className={inviteErrors.totalTimeboxMinutes ? "has-error" : ""}>
              Total exam time (minutes)
              <input
                type="number"
                min={1}
                value={totalTimeboxMinutes}
                onChange={(e) => setTotalTimeboxMinutes(e.target.value)}
              />
              {inviteErrors.totalTimeboxMinutes && (
                <span className="field-error">{inviteErrors.totalTimeboxMinutes}</span>
              )}
            </label>
          </div>

          <div className={`problem-picker ${inviteErrors.problems ? "has-error" : ""}`}>
            <div className="problem-picker-head">
              <span>Problems</span>
              {problems.length > 0 && (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    if (selectedProblemIds.length === problems.length) {
                      setSelectedProblemIds([]);
                    } else {
                      setSelectedProblemIds(problems.map((p) => p.id));
                    }
                  }}
                >
                  {selectedProblemIds.length === problems.length ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            {problems.length === 0 ? (
              <p className="hint">No problems available. Add a problem first.</p>
            ) : (
              <ul className="problem-picker-list">
                {problems.map((problem) => {
                  const checked = selectedProblemIds.includes(problem.id);
                  return (
                    <li key={problem.id}>
                      <label className={`problem-option ${checked ? "selected" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProblem(problem.id)}
                        />
                        <span className="problem-option-body">
                          <span className="problem-option-title">{problem.title}</span>
                          <span className="problem-option-meta">
                            {problem.languages.join(", ")}
                            {problem.timeboxMinutes != null
                              ? ` · ${problem.timeboxMinutes} min`
                              : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {inviteErrors.problems && (
              <span className="field-error">{inviteErrors.problems}</span>
            )}
          </div>

          <fieldset className="security-options">
            <legend>Exam security options</legend>
            <p className="hint">
              Enabled options are shown to the candidate before they start, and enforced during the
              exam.
            </p>
            <div className="security-option-list">
              <label className="security-option">
                <input
                  type="checkbox"
                  checked={secBlockClipboard}
                  onChange={(e) => setSecBlockClipboard(e.target.checked)}
                />
                <span className="security-option-copy">
                  <strong>Block copy / paste</strong>
                  <span>Candidate cannot copy or paste code during the exam.</span>
                </span>
              </label>
              <label className="security-option">
                <input
                  type="checkbox"
                  checked={secBlockFocusSwitch}
                  onChange={(e) => setSecBlockFocusSwitch(e.target.checked)}
                />
                <span className="security-option-copy">
                  <strong>Block tab / screen switching</strong>
                  <span>Require fullscreen and lock the editor if they leave this window.</span>
                </span>
              </label>
              <label className="security-option">
                <input
                  type="checkbox"
                  checked={secBlockMultiMonitor}
                  onChange={(e) => setSecBlockMultiMonitor(e.target.checked)}
                />
                <span className="security-option-copy">
                  <strong>Block second monitor</strong>
                  <span>Candidate must use a single display to start the exam.</span>
                </span>
              </label>
              <label className="security-option">
                <input
                  type="checkbox"
                  checked={secShowCamera || secRequireCamera}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSecShowCamera(on);
                    if (!on) setSecRequireCamera(false);
                  }}
                />
                <span className="security-option-copy">
                  <strong>Camera</strong>
                  <span>Ask the candidate for a camera preview (optional by default).</span>
                </span>
              </label>
              <label
                className={`security-option nested ${!(secShowCamera || secRequireCamera) ? "dimmed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={secRequireCamera}
                  disabled={!secShowCamera && !secRequireCamera}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSecRequireCamera(on);
                    if (on) setSecShowCamera(true);
                  }}
                />
                <span className="security-option-copy">
                  <strong>Require camera</strong>
                  <span>Candidate must allow camera access before starting.</span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setInviteModalOpen(false)}
            >
              Close
            </button>
            <button type="submit" className="btn-primary" disabled={inviteSubmitting}>
              {inviteSubmitting ? "Creating…" : "Create invite"}
            </button>
          </div>
        </form>
      </ModalShell>

      <ModalShell
        open={problemModalOpen}
        title={editingId ? "Edit problem" : "Add problem"}
        subtitle={
          editingId
            ? `Updating ${editingId}. Re-upload .txt files or edit text directly.`
            : "Upload prompt.txt and starter.txt, or paste content below."
        }
        onClose={() => setProblemModalOpen(false)}
        wide
      >
        <form className="modal-form" onSubmit={onSaveProblem} noValidate>
          <label className={problemErrors.title ? "has-error" : ""}>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Build a crypto order book"
            />
            {problemErrors.title && <span className="field-error">{problemErrors.title}</span>}
          </label>

          <label>
            Summary (optional)
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short description for the problem list"
            />
          </label>

          <div className="two-col">
            <label className={problemErrors.timeboxMinutes ? "has-error" : ""}>
              Suggested timebox (optional)
              <input
                type="number"
                min={1}
                value={timeboxMinutes}
                onChange={(e) => setTimeboxMinutes(e.target.value)}
                placeholder="e.g. 45"
              />
              {problemErrors.timeboxMinutes && (
                <span className="field-error">{problemErrors.timeboxMinutes}</span>
              )}
            </label>
            <label className={problemErrors.language ? "has-error" : ""}>
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="py">Python</option>
                <option value="go">Go</option>
                <option value="java">Java</option>
                <option value="cpp">C++</option>
                <option value="rs">Rust</option>
                <option value="cs">C#</option>
              </select>
              {problemErrors.language && (
                <span className="field-error">{problemErrors.language}</span>
              )}
            </label>
          </div>

          <label>
            Prompt file (.txt)
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => void onPromptFileChange(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className={problemErrors.promptText ? "has-error" : ""}>
            Prompt text
            <textarea
              rows={8}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="Paste the full problem statement"
            />
            {problemErrors.promptText && (
              <span className="field-error">{problemErrors.promptText}</span>
            )}
          </label>

          <label>
            Starter file (.txt)
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => void onStarterFileChange(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className={problemErrors.starterText ? "has-error" : ""}>
            Starter text
            <textarea
              rows={8}
              value={starterText}
              onChange={(e) => setStarterText(e.target.value)}
              placeholder="Paste starter code"
            />
            {problemErrors.starterText && (
              <span className="field-error">{problemErrors.starterText}</span>
            )}
          </label>

          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setProblemModalOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={problemSubmitting}>
              {problemSubmitting
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "Add problem"}
            </button>
          </div>
        </form>
      </ModalShell>

      <ModalShell
        open={resultsModalOpen}
        title={selectedResult ? `Results · ${selectedResult.candidateName}` : "Results"}
        subtitle={
          selectedResult
            ? `Finished ${formatDateTime(selectedResult.submittedAt)}${
                selectedResult.autoSubmitted ? " · auto-submitted" : ""
              }`
            : undefined
        }
        onClose={() => {
          setResultsModalOpen(false);
          setSelectedResult(null);
        }}
        wide
      >
        {selectedResult && (
          <div className="results-body">
            <div className="modal-actions top-actions">
              <button type="button" className="btn-danger-ghost" onClick={() => void onDeleteResult()}>
                Delete result
              </button>
            </div>
            {selectedResult.answers.map((answer) => (
              <div key={`${answer.problemId}:${answer.language}`} className="answer-block">
                <h3>
                  {answer.problemId} · {answer.language}
                </h3>
                <pre>{answer.source}</pre>
              </div>
            ))}
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={Boolean(offlineDetail)}
        title={
          offlineDetail
            ? `Offline results · ${offlineDetail.session.candidateName}`
            : "Offline results"
        }
        subtitle={
          offlineDetail
            ? `${offlineDetail.session.candidateEmail} · finished ${formatDateTime(offlineDetail.session.submittedAt)}`
            : undefined
        }
        onClose={() => setOfflineDetail(null)}
        wide
      >
        {offlineDetail && (
          <div className="results-body">
            {offlineDetail.answers.length === 0 ? (
              <p className="hint">No answers stored.</p>
            ) : (
              offlineDetail.answers.map((answer) => (
                <div key={`${answer.problemId}:${answer.language}`} className="answer-block">
                  <h3>
                    {answer.problemId} · {answer.language}
                  </h3>
                  <pre>{answer.source}</pre>
                </div>
              ))
            )}
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={Boolean(offlineSnapshot)}
        title={offlineSnapshot ? `Snapshot · ${offlineSnapshot.name}` : "Snapshot"}
        subtitle={
          offlineSnapshot?.at ? `Captured ${formatDateTime(offlineSnapshot.at)}` : undefined
        }
        onClose={() => setOfflineSnapshot(null)}
      >
        {offlineSnapshot && (
          <div className="results-body">
            <img
              src={offlineSnapshot.src}
              alt={`Camera snapshot for ${offlineSnapshot.name}`}
              style={{ width: "100%", borderRadius: 12, border: "1px solid var(--line)" }}
            />
          </div>
        )}
      </ModalShell>
    </div>
  );
}
