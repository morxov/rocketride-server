# Answer Cache

A RocketRide App Builder demo for the Redis tool node in [PR #3049](https://github.com/rocketride-org/rocketride-server/pull/3049). It checks Redis before making an answer and stores new answers with an expiration. The preview shows the answer source, remaining lifetime, and session hit rate.

## Open in VS Code

1. Check out the demo branch on Alex's fork. On macOS, open RocketRide in VS Code once in Local mode to download the engine. Have Node, pnpm, and Valkey or Redis available. This setup was verified with RocketRide extension 1.6.0 and engine 3.6.0.

   ```sh
   git clone --branch codex/redis-answer-cache https://github.com/morxov/rocketride-server.git
   cd rocketride-server
   ```

2. From the repository root, start the local engine:

   ```sh
   ./apps/answer-cache-ui/scripts/prepare-preview.sh .
   ```

   Leave the terminal open. The script copies the installed engine, loads the Redis node from the PR commit in this checkout, and starts the preview engine on `127.0.0.1:5565`. It uses Valkey or Redis on `127.0.0.1:6381` and starts it if needed.

3. Open the repository root in VS Code. In **Preferences: Open Workspace Settings (JSON)**, set the RocketRide development connection to the local service. Keep the existing settings in that file.

   ```jsonc
   "rocketride.development.connectionMode": "service",
   "rocketride.development.hostUrl": "http://127.0.0.1:5565"
   ```

4. Reload the VS Code window and open [answer-cache.rrapp](answer-cache.rrapp). Select **Design → Preview**. The first preview may take a moment while App Builder installs the workspace dependencies.

To check a production build from the repository root, run `corepack pnpm install --frozen-lockfile`, `./builder client-typescript:build`, and `corepack pnpm --filter local-answer-cache build`.

## Demo in three requests

1. Leave **Sample answers** selected, pick a sample question, set **Lifetime for new entries** to **10 seconds**, and click **Ask question**. An uncached question shows **Cache miss** and **Loaded from samples**.
2. Click **Ask question** again before the countdown reaches zero. Look for **Cache hit** and **Served from Redis**. The hit reuses the answer without resetting its lifetime.
3. When the countdown shows **Expired**, click **Ask question** once more. Look for a new **Cache miss** and a fresh countdown. If a question was still warm from rehearsal, choose another one or wait for it to expire.

Sample answers use real Redis but do not call a model. For live Q&A, provide `ROCKETRIDE_GEMINI_KEY` in the engine's environment before launching the script, or point `ROCKETRIDE_DEMO_ENV_FILE` to a trusted, ignored shell environment file that sets it. Select **Gemini** in the preview, then enter your own question. A cache miss calls [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash); a hit returns the stored answer. The Redis sample flow was verified live. Gemini pipeline validation and the missing-key error were checked; a real model response requires a key.

## How it works

The app calls `redis_get` and `redis_set` on the PR node through the RocketRide client. The GET result includes remaining TTL. On a miss, the app selects a sample or runs a separate Gemini pipeline, then writes with a positive TTL and `NX` so another request cannot overwrite an entry it just filled. A concurrent miss can still generate twice. Failed model responses are never stored.

Cache keys are SHA-256 hashes of the question, separated by answer mode under `rr:answer-cache:demo:v1:`. Gemini questions are matched after trimming outer whitespace. Paraphrase matching, user isolation, rate limiting, and topic purge are outside this local demo. Do not enter sensitive questions in a shared preview.
