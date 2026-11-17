# AI Margin Guard: demo app for the `tool_redis` node

**Start here.** If you are an AI agent asked to run this demo, follow this
file top to bottom, then read `HANDOFF.md` for the details.

## What it is

A RocketRide app for a company that sells a product with AI features. For
each customer it shows what they pay against what their AI use costs, and
lets a person act when a customer gets expensive: switch a feature off for a
while, move them to a cheaper model, or change their AI budget. Every change
is proposed, approved by a person, applied once, and written to an audit log.

Every live number and switch is a Redis key, read and written through the
`tool_redis` node that this branch adds. The audit log is in Postgres. Two
small LLM pipelines (Gemini) explain the numbers and answer questions; they
cannot change anything.

What each screen does, and the Redis key layout: `apps/margin-guard/README.md`.

## Where this lives, and why

This folder is on the `demo/margin-guard` branch, which is built on the
`feat/RR-3048-tool-redis` branch (PR #3049). The `tool_redis` node is not in
any released RocketRide yet, so the app only runs on an engine built from
this branch. Do not merge this folder into the PR.

## Setup (once)

You need: Docker Desktop, Node.js 22.15 or newer (tested on 25), pnpm 10 or newer, Python 3,
and a free Gemini API key from Google AI Studio.

All paths below are relative to this folder (`demos/margin-guard/`). The
repository root is `../..`.

1. **Build the engine** from the repository root. This takes a while the
   first time. The builder checks prerequisites and tells you what is missing
   (on macOS it may ask for the Python `build` and `wheel` packages).

   ```bash
   cd ../.. && ./builder server:build
   ```

2. **Engine secrets.** Add these two lines to `../../dist/server/.env`
   (create the file if it does not exist). Pick any password; it is only for
   the local audit-log database.

   ```bash
   ROCKETRIDE_GEMINI_KEY=<your Gemini key>
   ROCKETRIDE_MG_PG_PASSWORD=<a password you choose>
   ```

3. **Workspace secrets.** Copy `.env.example` to `.env` in this folder and
   fill it in. `MYAPIKEY` is the local engine's default key.

   ```bash
   ROCKETRIDE_URI=http://127.0.0.1:5565
   ROCKETRIDE_APIKEY=MYAPIKEY
   ROCKETRIDE_GEMINI_KEY=<your Gemini key>
   ROCKETRIDE_MG_PG_PASSWORD=<the same password as step 2>
   ```

   Leave the two `DEPLOY` lines empty. This demo is never deployed.

4. **Start the engine** and leave it running in its own terminal:

   ```bash
   cd ../../dist/server && ./engine ./ai/eaas.py --host=127.0.0.1
   ```

   If it says the address is already in use, an engine is already running.
   That is fine.

5. **Initialize this folder** against the running engine. This downloads the
   component catalog, the client and shell packages, and the RocketRide docs
   into `.rocketride/` (not committed), then installs dependencies.

   ```bash
   npx -y --package="$(ls -t ../../dist/clients/typescript/rocketride-*.tgz | head -1)" \
     rocketride init --uri http://127.0.0.1:5565 --apikey MYAPIKEY --no-deploy
   ```

6. **Start Redis and Postgres** (Docker Desktop must be running). Ports 6379
   and 5433 must be free:

   ```bash
   docker compose --env-file .env -f margin-guard.compose.yaml up -d --wait
   ```

## Check it works

```bash
./node_modules/.bin/rocketride validate apps/margin-guard/src/pipelines/*.pipe
node --env-file=.env scripts/check-guard-tools.mjs
node --env-file=.env --import ./scripts/ts-hooks.mjs --experimental-transform-types scripts/check-guard-flows.mjs
```

The last command runs 23 checks of the approval flows against the real
engine, Redis and Postgres, on a throwaway customer it deletes afterwards. It
should end with `All checks passed`.

## Run the app

```bash
./node_modules/.bin/rocketride app dev margin-guard --open
```

This opens the app in your browser, signed in. Or open
`apps/margin-guard/margin-guard.rrapp` in VS Code with the RocketRide
extension.

First click **Setup → Load demo data** to load six sample customers.

## The demo (about 4 minutes, all clicks)

1. **Overview**: six customers, with revenue, AI cost, margin and budget use.
2. **Setup → Send test traffic**: Hooli, summarize, 500 calls, **Send**; then
   2,000 calls, **Send**. Hooli goes over budget; alerts fire at 50, 80 and
   100 percent, once each.
3. Open **Hooli**, click **Explain and draft email**. The model explains in
   plain words and drafts an email. It cannot change anything.
4. On the summarize row, **Propose switch off**, choose **2 minutes (demo)**,
   add a reason, **Send for approval**.
5. **Approvals → Approve → Approve and apply.** The switch is written to Redis
   with a 2-minute expiry; when it expires the feature is back on by itself.
6. **Setup → Send test traffic** for Hooli summarize again: **Blocked**.
7. **Audit log**: every step, who did it and when.
8. **Advisor**: ask "Which customer has the worst margin?". It reads Redis
   through a read-only connection and cannot write.

To show the key in Redis right after step 5:

```bash
docker exec margin-guard-redis-1 redis-cli --scan --pattern 'rr:margin-guard:switch:*'
```

## Optional: continuous traffic

```bash
python3 -m venv .venv && .venv/bin/pip install redis
.venv/bin/python simulator/simulate_usage.py --burst hooli --burst-calls 150 --seconds 25
```
