import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

export function HomePage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    navigate(`/interview/${encodeURIComponent(value)}`);
  }

  return (
    <div className="shell home">
      <header className="topbar">
        <div className="brand">Live Coding Interview</div>
      </header>
      <main className="home-main">
        <h1>Senior Crypto Trading Systems</h1>
        <p className="lede">
          Write-only technical interview. Type your solutions, then submit when ready.
          There is no Run or Test button — answers are reviewed by the engineering team.
        </p>
        <form className="token-form" onSubmit={onSubmit}>
          <label htmlFor="token">Invite token</label>
          <div className="token-row">
            <input
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your invite token"
              autoComplete="off"
            />
            <button type="submit">Start interview</button>
          </div>
        </form>
      </main>
    </div>
  );
}
