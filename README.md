# Live Coding Interview (Online)

Write-only interview platform for **Senior Crypto Trading Systems Engineer** candidates.

Candidates type solutions in the browser and submit to the API. There is **no Run / Test** button.

## Stack

- Frontend: React + TypeScript + Vite + Monaco Editor
- Backend: Node.js + Fastify + TypeScript
- Database: SQLite via Node built-in `node:sqlite`
- Problems: stored in SQLite (uploaded from Admin)

## Quick start

```bash
cd "/Users/cloud/Documents/Live Coding"
npm install
npm run seed -w api
npm run dev -w api
# in another terminal:
npm run dev -w web
```

Open:

- Home: http://localhost:5173/
- HR Admin: http://localhost:5173/admin (password required every visit; not linked from Home)
- Interview: use an invite link created in Admin

API listens on http://localhost:8787. The Vite dev server proxies `/api` to it.

## Admin workflow

1. Open http://localhost:5173/admin and sign in with the admin password.
2. Add problems (`.txt` prompt + starter) via modal.
3. Create invites with total exam timebox.
4. Candidate opens the invite URL, types answers, Submit (or auto-submit on timeout).
5. Admin reviews results from Submitted invites.

Password is never stored in the browser. Refreshing `/admin` requires signing in again.
Change password from Admin → Change password (previous password required).

## Offline Windows app

Deferred until you finish testing and freezing this online UI. The offline app will wrap the same React UI in Tauri and call the same Submit API.
