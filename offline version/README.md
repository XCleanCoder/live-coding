# Live Coding Offline Exam

Electron desktop exam app. Candidates only enter **name + email** — no OS-specific setup.

Problems, timer, and security rules are built into the app. Internet is required only to talk to your exam API (heartbeat / submit / optional camera snapshot).

## Candidate experience (production)

1. Receive ZIP / DMG / AppImage for their OS  
2. Open the app  
3. Type name + email → agree to rules → take the exam  

They do **not** configure API URLs, ports, or environment variables.

---

## How production “just works”

You (admin) set the API address **once when packaging**, then ship the same binary to everyone.

| Layer | Purpose |
|--------|---------|
| `VITE_API_BASE` at build time | Baked into the UI (primary) |
| `resources/config.json` | Shipped inside the app; override without code changes |
| Optional `config.json` next to `.exe` | Ops override for portable Windows |

Priority at runtime: **file next to exe → packaged resources config → baked `VITE_API_BASE`**.

### Release checklist (do this before sending to candidates)

```bash
cd "Offline version"

# 1) Point to your public HTTPS API (candidates must reach this)
export VITE_API_BASE=https://api.your-company.com

# 2) Same URL in packaged config (optional but recommended)
# edit resources/config.json → { "apiBaseUrl": "https://api.your-company.com" }

# 3) Build per OS
npm run dist:win    # portable .exe + installer
npm run dist:mac    # .dmg
npm run dist:linux  # .AppImage
```

Ship the files from `release/`. Candidates only need a normal internet connection.

### Local development

```bash
cp .env.example .env   # VITE_API_BASE=http://localhost:8787
npm run start          # needs API on :8787
```

---

## Robustness built in

- Connection check on the registration screen (blocks start if API unreachable)
- Automatic retries + timeouts on network calls
- Friendly offline / timeout errors
- Heartbeat presence for admin **Offline app manager**
- Same security rules on every OS (clipboard, focus, multi-monitor; camera optional)

---

## Package commands

```bash
npm install
npm run dist:mac
npm run dist:win
npm run dist:linux
npm run dist:all   # when your CI/machine supports all targets
```

| OS | Artifact |
|----|----------|
| Windows | `*-portable.exe` (recommended) or NSIS installer |
| macOS | `.dmg` |
| Linux | `.AppImage` |

### Notes

- Prefer building each OS on that OS (or GitHub Actions matrix).
- macOS Gatekeeper: unsigned builds need Right-click → Open once.
- Windows SmartScreen may warn on unsigned `.exe` — “More info → Run anyway” until you code-sign.

---

## API endpoints used

- `GET  /api/health`
- `POST /api/offline/sessions`
- `POST /api/offline/sessions/:id/heartbeat`
- `POST /api/offline/sessions/:id/snapshot`
- `POST /api/offline/sessions/:id/submit`
