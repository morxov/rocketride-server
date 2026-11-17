# AI Margin Guard

See what each customer pays against what their AI usage costs, and control it:
budgets, off switches per feature, and a cheaper-model fallback. Live state
lives in your own Redis and is read and written through RocketRide's
`tool_redis` node. Every change is proposed, approved by a person, applied
once, and logged.

## What it does

| Screen | What you do there |
|---|---|
| Overview | Revenue, AI cost, margin and budget use per customer, refreshed from Redis every 3 seconds. Budget alerts at 50%, 80% and 100% fire once each. |
| Customer | Usage per feature, propose a budget change / off switch / cheaper model, and ask the LLM for an explanation and a draft email. |
| Approvals | Proposed changes with their expiry countdown. Approve, reject or extend. |
| Audit log | Who proposed, approved or rejected what, and what was written. |
| Advisor | Chat with a read-only agent that answers from live Redis keys. |
| Setup | The backend snippet, key layout, demo data, test traffic, and the apply on/off switch. |

## Pipelines

All three are in `src/pipelines/` and open in the RocketRide pipeline editor.

| File | Nodes | Used for |
|---|---|---|
| `guard-tools.pipe` | `tools` → `tool_redis` (writes on) + `db_postgres` | Every read and write the app makes, through `client.tool()` and `client.database.query()`. No LLM. |
| `explain.pipe` | `chat` → `prompt` → `llm_gemini` → `response_answers` | Turns numbers the app already read into an explanation and a draft email. |
| `advisor.pipe` | `chat` → `agent_rocketride` (+ `llm_gemini`, `memory_internal`, `tool_redis` read-only) → `response_answers` | The advisor chat. The node refuses writes on this connection. |

## How Redis is used

Namespace `rr:margin-guard:`. All seven `tool_redis` tools are used.

| Key | Meaning | Tools |
|---|---|---|
| `usage:{customer}:{feature}:{month}` | AI cost counter, micro-dollars | `redis_incr`, `redis_expire`, `redis_get` |
| `calls:{customer}:{feature}:{month}` | AI call counter | `redis_incr`, `redis_expire`, `redis_get` |
| `budget:{customer}` | JSON: name, plan, revenue, budget. No expiry | `redis_set` (`XX` on update), `redis_get` |
| `switch:{customer}:{feature}` | `off`; expires on its own | `redis_set` with expiry, `redis_ttl`, `redis_expire`, `redis_delete` |
| `fallback:{customer}` | Cheaper model; expires at month end | `redis_set` with expiry, `redis_ttl`, `redis_delete` |
| `alert:{customer}:{month}:{threshold}` | Each alert fires once | `redis_set` `NX` |
| `pending:{id}` | Proposed change; expires after 1 hour | `redis_set` `NX`, `redis_expire`, `redis_delete` |
| `lock:apply:{id}` | An approval applies exactly once | `redis_set` `NX` |
| `rollup:current` | 5-minute cached summary for the agent | `redis_set` with expiry |
| everything | Customer list, approvals inbox, demo reset | `redis_scan`, `redis_delete` |

## Running the demo locally

Setup, checks and the demo script are in `../../README.md` (the
`demos/margin-guard/README.md` file at the top of this demo).

## Requirements and limits

- The engine needs `ROCKETRIDE_GEMINI_KEY` (LLM) and `ROCKETRIDE_MG_PG_PASSWORD`
  (audit database) in its environment. No secret is stored in the app.
- `tool_redis` is not yet in a released engine, so this app runs only on an
  engine with that node loaded and cannot be published to the store yet.
- The audit log uses `db_postgres` against a local container. On RocketRide
  Cloud, swap that node for `rocketride_sql`; it exposes the same tools.
- Plan revenue is sample data stored with each budget, not read from a billing system.
- The key prefix is a namespace, not per-user access control.
- Enforcement happens in the customer's backend when it reads the switch.
  Margin Guard is never in the request path.
- Customer lists are built from SCAN pages: fine for thousands of keys, not millions.
- Pipeline edits take effect when the running task restarts (it idles out
  after 15 minutes, or run the matching `scripts/check-*.mjs`, which restarts it).

## Development

Open `margin-guard.rrapp` to launch the App Builder. Platform guide:
`.rocketride/docs/ROCKETRIDE_APPS.md` in this workspace. Smoke tests, run from
the workspace root:

```bash
node --env-file=.env scripts/check-guard-tools.mjs
```

```bash
node --env-file=.env scripts/check-explain.mjs
```

```bash
node --env-file=.env scripts/check-advisor.mjs "Which customer has the worst margin?"
```
