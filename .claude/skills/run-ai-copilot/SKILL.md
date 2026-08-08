---
name: run-ai-copilot
description: Build, start, and drive Career Copilot (Next.js web app + FastAPI API). Use when asked to run the project, start the dev servers, take a screenshot of the web app, or verify the API/web are up.
---

Career Copilot is two services: a FastAPI backend (`apps/api`) and a
Next.js frontend (`apps/web`), started separately (there is no Docker
Compose / single launch command). Drive it via
`.claude/skills/run-ai-copilot/driver.mjs` — a Playwright script (no
`chromium-cli` on this host; see Gotchas).

All paths below are relative to the repo root (`D:\AI-Copilot`).

## Prerequisites

Already provisioned in this repo — nothing extra to install system-wide:
- Node deps: root `npm install` (installs `apps/web` too, via npm workspaces).
- Python venv: `apps/api/.venv` (Python 3.11).
- The driver's own Playwright + Chromium live in
  `.claude/skills/run-ai-copilot/node_modules` — isolated from the
  app's `package.json`/lockfile.

If any of those are missing:

```bash
npm install                                            # repo root, installs apps/web
cd apps/api && python -m venv .venv                     # if .venv doesn't exist
source .venv/Scripts/activate                            # Windows Git Bash; `.venv/bin/activate` on Linux/macOS
pip install -r requirements.txt
cd ../../.claude/skills/run-ai-copilot && npm install    # driver's Playwright
```

## Run (agent path)

Start both services in the background, then run the driver.

```bash
# 1. API — from apps/api, with the venv active
cd apps/api
source .venv/Scripts/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000   # run with run_in_background: true

# 2. Web — from apps/web
cd apps/web
npm run dev                                        # run with run_in_background: true, defaults to :3000

# 3. Wait for both, then poll instead of sleeping blindly
timeout 30 bash -c 'until curl -sf http://localhost:8000/health >/dev/null; do sleep 1; done'
timeout 30 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'

# 4. Drive it
node .claude/skills/run-ai-copilot/driver.mjs
```

The driver: hits `GET /health` and `GET /docs` on the API, then loads
the web landing page, clicks **Sign In**, waits for the login form, and
screenshots both pages. It exits non-zero and prints `DRIVER FAILED` on
any failure, and warns if the browser console logged errors.

Screenshots land in `.claude/skills/run-ai-copilot/screenshots/`
(`01-landing.png`, `02-login.png`).

To stop: kill both background tasks (or, from a plain shell,
`lsof -ti:8000,3000 -sTCP:LISTEN | xargs -r kill` on Linux/macOS — on
Windows Git Bash, find the PIDs with `netstat -ano | grep :8000` /
`:3000` and `taskkill //F //PID <pid>`).

## Run (human path)

Same two commands (`uvicorn ...` and `npm run dev`), each in its own
terminal, no `run_in_background`. Open `http://localhost:3000` in a
real browser. `Ctrl-C` each terminal to stop.

## Test

```bash
cd apps/web && npm test        # vitest — 24 tests pass as of this writing
cd apps/api && source .venv/Scripts/activate && pytest
```

## Gotchas

- **`.venv` goes stale silently.** The `apps/api/.venv` in this repo
  predates the `slowapi`/`PyJWT` rate-limiting work — launching
  `uvicorn` raised `ModuleNotFoundError: No module named 'slowapi'`
  until `pip install -r requirements.txt` was re-run. Any time
  `requirements.txt` changes, re-run that install before trusting the
  venv.
- **`uvicorn ... &` inside a single backgrounded Bash call dies
  immediately.** Nesting `&` inside a command that's *also* launched
  with `run_in_background: true` orphans the child when the wrapper
  shell exits — the task reports "completed" but nothing is listening.
  Pass the bare `uvicorn ...` command straight to `run_in_background`
  instead of appending `&` yourself.
- **No `chromium-cli` on this host** — it's a Windows/Git Bash
  environment, not the usual Linux container. `driver.mjs` uses
  `playwright`'s `chromium.launch()` directly instead. Its Playwright
  install is scoped to `.claude/skills/run-ai-copilot/` (own
  `package.json` + `node_modules`) specifically so it doesn't touch
  `apps/web/package.json` or the repo lockfile.
- **Most of the app is behind auth and unreachable without live
  Supabase credentials.** `apps/web/lib/supabase.ts` falls back to
  empty-string env vars when `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` aren't set, so the app boots, but
  `middleware.ts` still redirects every route under `app/(app)/*`
  (dashboard, profile, JD analyzer, networking, etc.) to `/login` for
  an unauthenticated session. The driver's flow (landing → Sign In →
  login form) is the deepest path reachable without real credentials.
  To go further, supply real Supabase env vars in `apps/web/.env.local`
  and extend `driver.mjs` with a `fill`/`click` login sequence.

## Troubleshooting

- **`ModuleNotFoundError: No module named 'slowapi'`** (or any other
  API import error): the venv is behind `requirements.txt`. Fix:
  `cd apps/api && source .venv/Scripts/activate && pip install -r requirements.txt`.
- **`curl` to `:8000` or `:3000` returns nothing / connection refused
  right after launch**: the service hasn't finished booting, or (see
  Gotchas) the backgrounded process died on a startup exception — check
  the task's log file instead of assuming it's still starting.
- **`driver.mjs` fails at `page.click("text=Sign In")` with a timeout**:
  the landing page copy changed. Re-check `apps/web/app/page.tsx` for
  the current CTA text and update the selector.
