# Live Coding Offline Exam

Electron desktop app for offline coding exams. Candidates register, accept exam rules, then complete Python problems in a secured Monaco editor while the app heartbeats to the API.

## Prerequisites

- Node.js 20+
- macOS (primary target)
- API server at `http://localhost:8787` (or set `VITE_API_BASE`)

## Run (development)

```bash
cd "Offline version"
npm install
npm run start
```

This starts Vite on port **5174** and launches Electron once the dev server is ready.

Alternative:

```bash
npm run dev      # Vite only
npm run electron # Electron only (after dev server is up)
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `http://localhost:8787` | API base URL for session, heartbeat, snapshot, submit |

Create a `.env` file to override:

```
VITE_API_BASE=http://localhost:8787
```

## Exam flow

1. **Registration** — name + email (required), optional camera (off by default)
2. **Rules** — mandatory security rules; agree to start
3. **Exam** — 90-minute timer, two Python problems (`order-book`, `risk-engine`)
4. **Closing** — 3-second countdown, then quit button (Electron)

## Security

Always enabled (camera is optional):

- Clipboard / context menu blocked
- Fullscreen + focus guard (tab/window switch blocked)
- Multi-monitor detection
- **Dev bypass:** press `Insert` to toggle focus guard

## API endpoints

- `POST /api/offline/sessions`
- `POST /api/offline/sessions/:id/heartbeat`
- `POST /api/offline/sessions/:id/snapshot`
- `POST /api/offline/sessions/:id/submit`

## Build

```bash
npm run build
```

Type-checks with `tsc -b` and bundles the renderer to `dist/`.

## Project layout

```
Offline version/
  electron/main.cjs      # Electron main process (single-instance lock)
  electron/preload.cjs   # Preload bridge (quit)
  src/App.tsx            # Candidate flow + exam UI
  src/api.ts             # Offline API client
  src/security.ts        # Fullscreen, clipboard, display checks
  src/examPack.ts        # Embedded problems from samples/*.txt
  src/styles.css
```
