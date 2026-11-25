# JobRadar: local and RocketRide Cloud

JobRadar finds internship and new-grad matches, tracks applications, reads Gmail
recruiting messages, and tailors a resume for a selected role. The current app id
is **aidenbuck.jobradar**. It uses RocketRide catalog nodes and the account file
store, with **no Redis node or Redis server required** for normal operation.

See `apps/jobradar-ui/README.md` for architecture, email permissions, persistence,
resume exports, migration details, and current limits. The original Redis demo is
preserved as a migration fixture. Keep this demo out of upstream PR #3049.

## Career tools

This version adds manual job capture and archived descriptions, application plans,
networking contacts and outreach drafts, interview scheduling/calendar export,
resume-grounded practice, a reusable answer bank, keyword coverage, funnel
analytics, weekly goals, and tracker CSV export. See the
[competitive review](apps/jobradar-ui/docs/COMPETITIVE_RESEARCH.md) for official
sources, the feature map, and the limits of each implementation.

## Local setup

You need Node.js 22.15 or newer, pnpm, a running RocketRide engine, and Gemini and
Firecrawl API keys. All paths below are relative to `demos/jobradar`.

1. To build the local engine from this checkout, run `./builder server:build` at
   the repository root.
2. Put your own keys in the ignored `../../dist/server/.env`:

   ```sh
   ROCKETRIDE_GEMINI_KEY=<your key>
   ROCKETRIDE_FIRECRAWL_KEY=<your key>
   ```

3. Start or restart the engine from `../../dist/server`:

   ```sh
   ./engine ./ai/eaas.py --host=127.0.0.1
   ```

4. Copy `.env.example` to `.env` and set the local connection:

   ```sh
   ROCKETRIDE_URI=http://127.0.0.1:5565
   ROCKETRIDE_APIKEY=MYAPIKEY
   ```

5. Initialize against that engine if `.rocketride` and dependencies are absent:

   ```sh
   npx -y --package="$(ls -t ../../dist/clients/typescript/rocketride-*.tgz | head -1)" \
     rocketride init --uri http://127.0.0.1:5565 --apikey MYAPIKEY --no-deploy
   ```

6. Start the app:

   ```sh
   ./node_modules/.bin/rocketride app dev jobradar-ui --open --no-install
   ```

If the preview reloads repeatedly, stop stale parent `rocketride.js app dev`
processes, not just their rsbuild children. Use new pipeline `project_id` values
when changing nodes. Never commit `.env`, OAuth tokens, API keys, dependencies, or
build output.

## Cloud setup

The organization owns the `aidenbuck` developer namespace. Set
`ROCKETRIDE_DEPLOY_URI=https://api.rocketride.ai` and your private
`ROCKETRIDE_DEPLOY_APIKEY` in the workspace `.env`. Configure the Gemini and
Firecrawl keys in the cloud account's user environment, not the app source.

```sh
ROCKETRIDE_APIKEY='' ./node_modules/.bin/rocketride app deploy jobradar-ui --publish @me
```

Clearing `ROCKETRIDE_APIKEY` for this command avoids the SDK's local-key override
of the deployment credential. `@me` makes the app available only to your account.
The cloud app uses cloud account files; the local preview uses local account files.
Close other editing pages before switching between machines.

Optional migration from the original local Redis demo:

```sh
node --env-file=.env scripts/migrate-jobradar-storage.mjs --cloud
```

This merges missing records into local and cloud file stores, preserves existing
destination values, verifies the saved snapshots, and leaves Redis untouched.

## Checks

```sh
node --test scripts/tests/features.test.mjs
cd apps/jobradar-ui && pnpm run build
```

From this demo's root, the live cloud check uses the deployment connection:

```sh
node --env-file=.env scripts/check-jobradar-cloud.mjs
node --env-file=.env scripts/check-jobradar-career.mjs
```

It performs paid-provider requests with your configured Gemini key using fictional
resume/email fixtures. Actual email access requires completing Google sign-in in
the app. No message is sent and no job application is submitted by these checks.
