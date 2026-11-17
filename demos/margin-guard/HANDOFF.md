# Handoff: AI Margin Guard (for an agent working in VS Code)

Written 2026-11-16. Set-up and run steps are in `README.md` in this folder;
read that first. Open `demos/margin-guard/` as the VS Code workspace root.
All paths below are relative to it; the repository root is `../..`.

## What this is

A RocketRide app, `apps/margin-guard` (id `local.margin-guard`), that demos the
`tool_redis` node. It shows each customer's plan revenue against their AI
cost, and lets a person propose and approve budgets, per-feature off
switches and a cheaper-model fallback. Live state is in Redis; the audit log
is in Postgres. It is for the SCU build week: demo to the RocketRide team
Tue Nov 17, final Thu Nov 19, Demo Day Wed Nov 25.

Read first, in this order:
1. `.claude/rules/rocketride.md` (project rules: read the docs in `.rocketride/docs/` before writing RocketRide code, never invent node names or client methods, never hand-create an app)
2. `apps/margin-guard/README.md` (screens, pipelines, key layout, run steps, limits)
3. `MARGIN_GUARD_PLAN.md` (design and decisions)

## State of the work

Built, type-checks, production build passes, `rocketride app verify` passes.
Nothing is committed, deployed or published.

Verified by running it in the live preview:
- Load demo data, dashboard refresh, budget alerts at 50/80/100% firing once each
- Propose switch off → approve → key written with expiry → simulator gets `blocked`
- Audit log rows in Postgres and on the Audit screen
- Explain button (LLM explanation and draft email)
- Advisor agent answers from Redis in about 3 s; a write on its read-only Redis node returns `permission_denied`

Covered headlessly on 2026-11-16 by `scripts/check-guard-flows.mjs` (the real
`guard.ts` functions against the engine, Redis and Postgres, on a throwaway
`selftest` customer): cheaper model and back, budget change, reject, extend a
proposal and an active switch, dry run, send test traffic, a proposal expiring
on its own, and two approvals racing (one applies, one "already applied", one
`applied` audit row).

Fixed on 2026-11-16 while doing that:
- The list could stay stale for up to 3 s after Approve/Reject (`refresh()` skipped when a poll was in flight). It now queues one more read.
- Approving an already-applied change said "expired" and wrote an `expired` audit row. It now says "already applied" (the lock key is checked).
- Rejecting a proposal that had already gone logged `rejected`. It now says it was already gone and logs nothing.
- "Extend to 1 h" on the Customer screen had no error handling.

Still only checked headlessly, not by clicking in the preview: the buttons
themselves. The three `.pipe` files' canvas positions were checked for overlap
(none) but nobody has looked at them in the editor.

## Suggested next tasks

1. Click through the paths above once in the preview before the demo.
2. Open `apps/margin-guard/margin-guard.rrapp` to use the App Builder preview (in VS Code this replaces the terminal dev server below).
3. Optional, from the plan's "not in this demo" list: Slack alerts from a separately deployed scheduled pipeline, Stripe test-mode revenue through `tool_http_request`, pricing plans in `appManifest.billing.plans`.

## Layout

```
apps/margin-guard/
  src/pipelines/guard-tools.pipe   tools source + tool_redis (writes on) + db_postgres
  src/pipelines/explain.pipe       chat -> prompt -> llm_gemini -> response_answers
  src/pipelines/advisor.pipe       chat -> agent_rocketride (+ llm_gemini, memory_internal, read-only tool_redis)
  src/lib/keys.ts                  Redis key names, TTLs, unit costs
  src/lib/session.ts               pipeline tokens, the seven redis tool calls, sql()
  src/lib/guard.ts                 snapshot, alerts, propose/approve/apply, audit, demo seed, test traffic
  src/state.tsx                    module-level store + 3 s poll (useGuard, GuardPoller)
  src/ui.tsx                       shared styles and small components
  src/screens/                     Overview, Customer, Approvals, Audit, Advisor, Setup
  src/App.tsx                      AppLayout, sidebar menu, view switch
simulator/simulate_usage.py        stand-in for a customer's backend (writes Redis directly)
scripts/check-*.mjs                headless smoke tests for each pipeline
scripts/create-margin-guard.mjs    how the app was scaffolded (do not re-run)
margin-guard.compose.yaml          local Redis (127.0.0.1:6379) and Postgres for the audit log (127.0.0.1:5433)
```

## Running it

See `README.md` in this folder: setup, checks, running the app and the demo
script. Two more checks that call the LLM pipelines:

```bash
node --env-file=.env scripts/check-explain.mjs
node --env-file=.env scripts/check-advisor.mjs "Which customer has the worst margin?"
```

## Things that will trip you up

- **Use pnpm, not npm.** Never run `npm install` in an app folder. Do not set `CI=true` for installs: it forces a frozen lockfile and fails.
- **Python with redis-py** is `.venv/bin/python` once you create it (see README). System `python3` usually does not have it.
- **The engine is a local build** from this repository (`../..`), whose `feat/RR-3048-tool-redis` branch adds the node. `tool_redis` exists only there, so the app cannot be published to the store until the node is merged and released.
- **Secrets are placeholders.** Pipelines reference `${ROCKETRIDE_GEMINI_KEY}` and `${ROCKETRIDE_MG_PG_PASSWORD}`. Values live in `../../dist/server/.env` (engine) and `.env` (this workspace, gitignored). Never put a value in a `.pipe` or in app code. If you add a variable, add its name to `.env.example` too and restart the engine.
- **Both connection pairs in `.env` point at the same local engine.** Do not run deploy, publish or schedule verbs without asking the user.
- **Pipeline edits do not apply to a running task.** The app calls `use({ useExisting: true })`, which attaches to the old run. Restart it: `scripts/check-explain.mjs` and `scripts/check-advisor.mjs` terminate and restart their pipeline; otherwise wait 15 minutes idle or restart the engine.
- **Model: keep Gemini 3.5 Flash Lite** (`models/gemini-3.5-flash-lite`) in both LLM pipelines. The user asked for this free model and no heavier one. 3.5 Flash and 3.6 Flash took 60 to 120 s per agent answer on this key.
- **`rocketride_sql` does not work on the local engine** (it needs a cloud tenant database). That is why the audit log uses `db_postgres`. On RocketRide Cloud, swap the node; the tool surface is the same.
- **`tool_http_request` blocks localhost**, so no local fake billing API.
- **The shell renders the `sidebar` node outside the app's React tree.** A React context provider around `AppLayout` does not reach it. Shared state is a module-level store in `src/state.tsx`; keep it that way.
- **Redis node limits the code already handles:** the connection pool fails instead of waiting when exhausted (calls are capped at 6 in parallel in `session.ts`); `redis_incr` takes integers only (money is micro-dollars) and never sets an expiry (the app calls `redis_expire`); `redis_scan` pages can be empty or repeat keys; `redis_delete` takes at most 100 keys; writes are never auto-retried because an `unknown` outcome may have been applied.
- **UI rules from the platform docs:** style objects with `--rr-*` tokens, stock components from `'shell'` first, no emojis, no CSS files. See `.rocketride/docs/ROCKETRIDE_APPS.md` (Styles Doctrine) and `ROCKETRIDE_UI_COMPONENTS.md`.

## Design rules to keep

- The app writes a control only after a person approves it. A proposal is a `pending:{id}` key with a 1-hour expiry.
- Approving claims `lock:apply:{id}` with SET NX before writing, so a change is applied once.
- The LLM explains and drafts; it never decides or writes. The agent's Redis node has `allow_writes: false`.
- Every proposal, approval, rejection, applied change and alert goes to the `mg_audit` table.
- "Load demo data" deletes every key under `rr:margin-guard:`. It is behind a confirm dialog; do not call `resetDemo` anywhere else.
