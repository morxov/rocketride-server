# AI Margin Guard: demo plan

A RocketRide app that shows, per customer, what they pay against what their AI
usage costs, and lets a person set budgets, off switches and a cheaper-model
fallback. All live state sits in Redis and is read and written through the
`tool_redis` node. Idea R1 in the SCU doc.

Status: built and run end to end on the local engine (2026-11-16). App: `apps/margin-guard`. How to run it: `apps/margin-guard/README.md`. Changes from this plan: the agent reads a fixed `rollup:current` key, and both LLM pipelines use Gemini 3.5 Flash Lite (larger Flash models took 60 to 120 seconds per agent answer on this key).

## What the demo has to prove

1. Every one of the Redis node's seven tools does real work in a believable product.
2. The node plugs into the rest of RocketRide: a Tools source, an LLM, an agent, a database node and the app shell.
3. The safety design of the node is visible: key prefix, read-only by default, expiry, and set-if-absent used as a lock.

## The story in the demo (about 4 minutes)

1. Open the app. Six sample customers, each with revenue, AI cost, margin and a budget bar.
2. Run the traffic simulator. One customer's cost climbs live past 50%, 80%, then 100% of budget. Each alert appears once.
3. Open that customer. Ask for an explanation: the LLM writes two plain sentences and drafts an email.
4. Propose "switch feature `summarize` off for 1 hour". It lands in Approvals with a countdown.
5. Approve it. The switch key appears in Redis with an expiry; the simulator starts getting "feature off" and stops spending. The audit log shows who approved what.
6. Ask the advisor agent "which customers are losing us money this month?". It answers from Redis and cannot write.

## How Redis is used

Key prefix: `rr:margin-guard:`. Month is `YYYY-MM`. Money is stored as whole
micro-dollars because `redis_incr` only takes integers.

| Key | Value | Written by | Tool |
|---|---|---|---|
| `usage:{customer}:{feature}:{month}` | cost counter | customer backend | `redis_incr` |
| `calls:{customer}:{feature}:{month}` | call counter | customer backend | `redis_incr` |
| `budget:{customer}` | JSON: monthly budget, plan, revenue | app, after approval | `redis_set` (no expiry) |
| `switch:{customer}:{feature}` | `off`, expires on its own | app, after approval | `redis_set` with `ttl_seconds` |
| `fallback:{customer}` | cheaper model name, expires at month end | app, after approval | `redis_set` + `redis_expire` |
| `alert:{customer}:{month}:{50\|80\|100}` | marker so each alert fires once | app | `redis_set` with `condition: NX` |
| `pending:{id}` | JSON proposed change, expires in 24 h | app | `redis_set` NX + `redis_ttl` for the countdown |
| `lock:apply:{id}` | one-time lock so an approval applies once | app | `redis_set` NX |

Reads: `redis_scan` pages build the customer list and the approvals inbox;
`redis_get` reads values; `redis_delete` clears a switch early or resets the
demo. That covers all seven tools.

Two node behaviours the app handles on purpose:
- `redis_incr` never sets an expiry, so the app calls `redis_expire` on new month counters (about 100 days).
- `redis_scan` pages can be empty or repeat keys, so the app loops until `done` and de-duplicates.

## Pipelines (all bundled in the app)

**1. `guard-tools.pipe`**: the workhorse. The app calls it with `client.tool()`.
- `tools` (source)
- `tool_redis`, writes on, prefix `rr:margin-guard:`
- a database node for the audit log (see Decisions)

**2. `explain.pipe`**: the LLM explains, it does not decide.
- `chat` → `prompt` → `llm_gemini` → `response_answers`
- Input is the numbers the app already gathered; output is a short explanation and a draft email to the customer.

**3. `advisor.pipe`**: a read-only agent.
- `chat` → `agent_rocketride` + `llm_gemini` → `response_answers`
- Tool: a second `tool_redis` with writes off (the node's default), same prefix.
- Shows the read-only guard: the agent can look at usage and budgets but any write is refused by the node itself.

Nodes used: `tools`, `tool_redis` (x2), `chat`, `prompt`, `llm_gemini`,
`agent_rocketride`, `response_answers`, plus the audit database node. Every
config field gets checked against `.rocketride/schema/` and the node READMEs
before it is written, and each pipe is run through `rocketride validate`.

## The "customer backend"

The doc's pattern is that the customer's own code writes the counters. For the
demo that is a small script in the workspace, `simulator/simulate_usage.py`,
talking to Redis directly with redis-py:

- increments `usage:` and `calls:` for six sample customers at different rates
- before each call reads `switch:` and `fallback:` and obeys them
- has a `--burst <customer>` flag to push one customer over budget on cue

The app's Setup screen shows the same five-line snippet a real customer would paste in.

## Screens

| Screen | What is on it |
|---|---|
| Overview | Customer table: plan revenue, AI cost this month, margin %, budget bar, status. Refresh button and "last refreshed" time. |
| Customer | Usage per feature, active switches and fallback with time left, "Explain" and "Draft email", buttons that propose changes. |
| Approvals | Pending changes with expiry countdown, approve / reject. |
| Audit | Every proposal, approval, rejection and applied change. |
| Advisor | Chat with the read-only agent. |
| Setup | The backend snippet, the key layout, connection status, "reset demo data". |

## Build order

1. **Scaffold** `margin-guard` with `client.deploy.createApp` (Dashboard template) and get the empty app showing in the preview.
2. **Tools pipeline + Redis layer**: `guard-tools.pipe`, a typed wrapper around the seven tool calls, validate, and a script that exercises each call against the local Redis.
3. **Simulator + seed data**: six customers, budgets and revenue.
4. **Overview and Customer screens**, reading live counters.
5. **Proposals, Approvals, locks, alerts**: the full propose → approve → apply-once flow, plus the audit log.
6. **Explain pipeline** and its buttons.
7. **Advisor agent**.
8. **Demo pass**: run the story above end to end in the preview, fix what breaks, write the README and a run sheet.

Steps 1 to 5 are the must-haves. 6 and 7 each add about an hour and are what make it more than a dashboard.

## Decisions needed

| Decision | Recommendation | Why |
|---|---|---|
| Where the audit log lives | A local Postgres container with the `db_postgres` node | `rocketride_sql` resolves its database from a signed-in cloud tenant, which a local engine does not have. `db_postgres` has the same tool surface, so moving to `rocketride_sql` on RocketRide Cloud later is a one-node swap. Fallback: keep the log in Redis. |
| Where plan revenue comes from | Seeded sample values stored with each budget | `tool_http_request` blocks localhost, so a fake local Stripe is not possible, and real Stripe needs your test key. Stripe test mode can be added later as a stretch. |
| LLM | Gemini | `ROCKETRIDE_GEMINI_KEY` is already in the local engine's `.env`. Not yet re-tested today. |

## Known limits to say out loud in the demo

- The node cannot isolate data per user; the key prefix is a namespace, not access control.
- The heaviest-customer view is built from SCAN pages, fine for thousands of keys, not millions.
- Budget enforcement happens in the customer's backend when it reads the switch; the node cannot block anyone's calls.
- The app only runs on a local engine with the node loaded until `tool_redis` is merged and released, so it cannot be published to the store yet.
- The local Redis has no password and loses its data when the container is removed.

## Not in this demo

Scheduled checks and Slack alerts (need a separately deployed pipeline and a Slack token), real Stripe, pricing plans in the manifest, store publishing.
