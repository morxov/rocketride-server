# JobRadar: demo app for the `tool_redis` node

**Start here.** If you are an AI agent asked to run this demo, follow this
file from top to bottom.

## What it is

A job-search dashboard for internships and new-grad roles that shows only
what is **new** and worth your time. It reads about 8,000 open roles from the
SimplifyJobs lists and any company's Greenhouse, Lever or Ashby board, merges
duplicates, flags ghost and reposted listings, scores each role against your
resume with readable reasons, and keeps a tracker with follow-up reminders.
A Gemini agent answers questions about your search and saves reminders and
notes.

Redis is its memory, through three `tool_redis` nodes, each locked to its own
key prefix: a sharded first-seen index (what is new, what closed), seen and
hidden marks with expiry, tracker records, reminders, a SET NX refresh lock,
INCR counters, a description and fit cache, and a digest the agent reads. The
agent gets a read-only Redis node plus a separate one that can write only
notes.

| Read next | For |
|---|---|
| `apps/jobradar-ui/README.md` | Screens, pipelines, every Redis key, the demo script, limits |
| `jobradar-site/index.html` | Landing page with the roadmap (open it in a browser) |
| `jobradar-site/ROADMAP.md` | Roadmap with file-level detail, including the Nov 19 fixes |
| `JOBRADAR_PLAN.md` | Research on popular job tools and the gaps JobRadar targets |

## Where this lives, and why

This folder is on the `demo/jobradar` branch, which is built on the
`feat/RR-3048-tool-redis` branch (PR #3049). The `tool_redis` node is not in
any released RocketRide yet, so the app only runs on an engine built from
this branch. Do not merge this folder into the upstream PR.

## Setup (once)

You need: Docker Desktop, Node.js 22.15 or newer (tested on 25), pnpm 10 or
newer, Python 3, a free Gemini API key from Google AI Studio, and a Firecrawl
API key (free tier is enough).

All paths below are relative to this folder (`demos/jobradar/`). The
repository root is `../..`.

1. **Build the engine** from the repository root (skip if you already built
   it for another demo):

   ```bash
   cd ../.. && ./builder server:build
   ```

2. **Engine secrets.** Add these lines to `../../dist/server/.env` (create
   it if needed). Keys live only on the engine; the pipelines reference them
   as `${ROCKETRIDE_...}` and never contain them.

   ```bash
   ROCKETRIDE_GEMINI_KEY=<your Gemini key>
   ROCKETRIDE_FIRECRAWL_KEY=<your Firecrawl key>
   ```

3. **Workspace connection.** Copy `.env.example` to `.env` here and set:

   ```bash
   ROCKETRIDE_URI=http://127.0.0.1:5565
   ROCKETRIDE_APIKEY=MYAPIKEY
   ```

   Leave the two `DEPLOY` lines empty. This demo is never deployed.

4. **Start the engine** in its own terminal (restart it after editing its `.env`):

   ```bash
   cd ../../dist/server && ./engine ./ai/eaas.py --host=127.0.0.1
   ```

5. **Initialize this folder** against the running engine. This fetches the
   catalog, client, shell and docs into `.rocketride/` (not committed) and
   installs dependencies:

   ```bash
   npx -y --package="$(ls -t ../../dist/clients/typescript/rocketride-*.tgz | head -1)" \
     rocketride init --uri http://127.0.0.1:5565 --apikey MYAPIKEY --no-deploy
   ```

6. **Start Redis** (port 6379 must be free; stop Margin Guard's Redis first
   if it is running):

   ```bash
   docker compose -f redis.compose.yaml up -d --wait
   ```

## Check it works

```bash
./node_modules/.bin/rocketride validate apps/jobradar-ui/src/pipelines/*.pipe
node --env-file=.env scripts/check-jobradar-tools.mjs
node --env-file=.env scripts/check-jobradar-v2.mjs profile
node --env-file=.env scripts/check-jobradar-v2.mjs assistant "What are my best new matches today?"
```

## Run the app

```bash
./node_modules/.bin/rocketride app dev jobradar-ui --open
```

This opens the app signed in. Or open `apps/jobradar-ui/jobradar.rrapp` in
VS Code with the RocketRide extension.

## The demo (about 4 minutes)

1. **Profile and sources:** press **Try it with a sample resume** (a made-up
   student). The profile appears in a few seconds and the first check runs.
2. **Watch company:** add `ramp` or `palantir`. Their own postings pop up as new matches.
3. **Dashboard:** what is new since your last check, today's picks, the stale count.
4. Open a job, then **Explain fit**: requirements paired with resume evidence, and honest gaps.
5. **Save**, then **Mark applied**. The Tracker shows the follow-up reminder; **Drafts** writes a cover note or follow-up email.
6. **Assistant:** "Which applications should I follow up on?", then "Remind me to prep for Ramp on Friday". The reminder lands in the Tracker.
7. To show the "new posting" moment again: **Profile and sources > Replay the last 24 hours as new**.

To show the Redis keys behind it:

```bash
docker exec jobradar-redis-1 redis-cli --scan --pattern 'jobradar:*' | head -30
```

**Profile and sources > Delete all JobRadar data** resets everything for the next run.

## Limits

- Single user (`alex`, set in the pipelines and `src/lib/redis.ts`).
- Checks sources only while the app is open (every 10 minutes); app pipelines cannot be scheduled.
- Redis here has no persistence: removing the container loses the tracker.
