# Agent Action Gate

Agent Action Gate gives teams an approval inbox for actions proposed by their agents. A person reviews a dry run, approves or rejects it, and explicitly runs an approved action when the matching policy is enabled. The meeting demo records a simulated receipt in Redis. The R3 brief cites our Redis node test where a small model made four increment calls after it was asked to increment once. [Redis node PR #3049](https://github.com/rocketride-org/rocketride-server/pull/3049)

## Meeting spec

| Area               | What the demo shows                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval inbox     | Propose a sample action with a request ID, target, summary, and expiry. See what is pending, approved, rejected, expired, or executed. Select an action to review its details and take the next step.                                                                 |
| Policy             | The simulated `send-summary` action starts disabled. Approval records a decision. Execution requires approval, an enabled policy, and an explicit operator action.                                                                                                    |
| Audit              | Show the workspace's proposal and decision history, execution receipts, and approval counts. The local preview stores audit records in Redis. An optional sync copies them to a configured SQL database.                                                              |
| Pipeline           | The inbox calls a Tools source wired to Alex's `tool_redis` using `client.tool()`. A separate `chat` → `llm_gemini` → `response_answers` pipeline can explain a selected proposal on demand. It receives the proposal facts and has no write tools.                   |
| Settings           | The local workspace is `demo`, with Valkey or Redis on `127.0.0.1:6381`. Choose 10 seconds, 2 minutes (default), or 10 minutes for a proposal. Gemini uses the engine's optional `ROCKETRIDE_GEMINI_KEY`. Managed SQL is opt-in.                                      |
| Pricing hypothesis | Starter at $29/month for 1 connected agent, Team at $99/month for up to 5, and Scale at $249/month for up to 20. These are illustrative per-agent plans. The manifest records these proposals under `appManifest.billing.plans` and the local preview uses free mode. |

A proposal's stable request ID and `SET NX` make retries reuse the original proposal while its record is retained. A proposal TTL limits the approval and execution window. An atomic `SET NX` protects the one-time simulated receipt, so two clicks cannot create two receipts. The customer agent or action runner must explicitly integrate with this gate. `tool_redis` cannot intercept other tool calls, and a future external write would need the destination's own idempotency support and a way to reconcile ambiguous failures. The policy and expiry checks precede the Redis receipt write. The node exposes these as separate calls, so a policy change racing that write is outside the demo’s guarantees. The demo uses one local workspace. A hosted version needs workspace authorization and a released engine with `tool_redis`. Slack notifications are a follow-up.

## Open in RocketRide App Builder

1. On macOS, install the RocketRide VS Code extension and open it once in Local mode to download its engine. Have Node, pnpm, and Valkey or Redis available. From the repository root, run:

   ```sh
   ./apps/agent-action-gate-ui/scripts/prepare-preview.sh .
   ```

   The script copies the installed engine into a temporary directory, adds the pinned Redis node from PR #3049, and starts or reuses loopback Valkey or Redis on port 6381. The preview engine listens at `http://127.0.0.1:5565`. Keep that terminal open. The argument uses the pinned PR commit from this checkout. Omit it to download the pinned commit.

2. Open the repository root in VS Code. In RocketRide, choose **Service** for the development connection. Open [agent-action-gate.rrapp](agent-action-gate.rrapp), then choose **Design → Preview**. If the editor was already open, reconnect or reload it after the engine starts. If the helper reports that the port is in use, use the running engine only if it has the PR node. Otherwise use `ROCKETRIDE_DEMO_PORT` to pick a free port and point **Direct Connect** at that loopback URL using the public local placeholder `MYAPIKEY`.
3. App Builder downloads the matching platform packages. In a fresh monorepo checkout, if the preview cannot resolve the linked `rocketride` SDK, run the following from the root, then reopen the preview. The last command also verifies the app's production build.

   ```sh
   pnpm install --frozen-lockfile
   ./builder client-typescript:build
   pnpm --filter local-agent-action-gate build
   ```

To enable the optional explanation, set `ROCKETRIDE_GEMINI_KEY` in the engine's environment before launching the helper, or point `ROCKETRIDE_DEMO_ENV_FILE` at a trusted, ignored shell environment file. The Redis workflow works without Gemini or SQL. [RocketRide App Builder guide](https://github.com/rocketride-org/rocketride-server/blob/2c59071407225121f053e30d2c61b84761d2a7aa/docs/public/product/guides/apps/app-builder.md)

## Walk through it in the meeting

1. Propose a dry run with a new request ID and the default 2-minute lifetime. Submit the same request again and confirm only one proposal appears.
2. Approve it with the execution policy disabled. Show that approval alone does not create a receipt. Enable the policy and execute the approved proposal once. Confirm the audit shows a single simulated receipt. Refresh the inbox or try the same action from a second preview to show it was already executed.
3. Reject a new proposal and let another proposal with a short lifetime expire. Confirm neither can be executed and check their audit history.

## Optional SQL audit

Apply [the audit schema](src/audit-schema.sql) once to the destination database. For **RocketRide SQL**, use a signed-in RocketRide environment with a managed database broker and access to the organization database. The stock local preview engine has no managed database broker. For **PostgreSQL**, provide `ROCKETRIDE_GATE_POSTGRES_HOST` (`host:port`), `ROCKETRIDE_GATE_POSTGRES_USER`, `ROCKETRIDE_GATE_POSTGRES_PASSWORD`, and `ROCKETRIDE_GATE_POSTGRES_DATABASE` in the engine's environment. Choose **RocketRide SQL** or **Local PostgreSQL** in the app and use **Sync audit to SQL** to copy the workspace's Redis audit events. Sync can be retried because the audit table deduplicates by workspace and event ID. [Managed SQL node](https://github.com/rocketride-org/rocketride-server/blob/2c59071407225121f053e30d2c61b84761d2a7aa/nodes/src/nodes/rocketride_sql/README.md)
