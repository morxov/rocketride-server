# JobRadar v2: plan

Status 2026-11-18: built and run end to end in the live preview. See `apps/jobradar-ui/README.md` for screens, keys, run steps and the demo script.

A personal job-search dashboard for internships and new-grad roles that only
surfaces what is new and worth your time. It runs on the local RocketRide
engine with Redis as its memory and Gemini 3.5 Flash Lite for the AI.

## What popular tools do, and where they fall short (research 2026-11-18)

Every serious tool covers the same core: multi-source search with filters,
alerts, a status board (Saved / Applied / Interview / Offer / Rejected), a
resume-to-job match score, AI tailoring, one-click save, and a usable free tier.
The tools reviewed were LinkedIn, Indeed/Glassdoor, Handshake, Simplify, Teal,
Huntr, Jobright, Jobscan, Careerflow, Wellfound, Welcome to the Jungle and the
auto-apply bots.

Repeated complaints those tools do not address well, and what JobRadar does about each:

| Gap | JobRadar feature |
|---|---|
| Ghost, stale and reposted listings (about 1 in 5 postings is a ghost per Greenhouse) | Freshness check on every card: when it first appeared, how many times the same role was reposted, whether it closed. "Likely stale" flag with the reason. |
| Hearing about a posting late (applications per job went from about 28 to 95, 2021 to 2025) | Polls sources while open; a job first seen since your last check pops up as a notification and lands in **New**. Old items stay out of the way unless you open **All**. |
| Duplicates across boards and lists | One fingerprint per company + role merges duplicates into one card, preferring the company's own ATS link. |
| Manual tracking, no follow-up reminders (Simplify, Teal and Huntr have none) | Tracker board; marking Applied schedules a follow-up reminder; the AI drafts the follow-up email (never sends it). |
| Opaque, keyword-only match scores; AI that invents skills | Transparent score with the reasons listed; "Explain fit" pairs each requirement with your own resume evidence and lists honest gaps. |
| Paywalls and billing traps | Free and local; your resume stays on your machine and Redis. |
| Auto-apply spam | Deliberately no auto-apply: a short "worth applying today" list instead. |

## Features

1. **Dashboard.** New since your last check, today's top picks, follow-ups due, alerts on tracked jobs whose posting closed, and pipeline and source counters.
2. **Jobs inbox.** Tabs: New (default), All matches, Hidden. Each card shows score and reasons, freshness, repost and ghost flags, merged sources and sponsorship notes. Actions: Save, Applied, Hide, Details.
3. **Job details.** The full description (from the ATS API, or Firecrawl for other sites, cached in Redis for 7 days), Explain fit, cover note, and tracker actions.
4. **Tracker.** Columns Saved, Applied, Online assessment, Interview, Offer, Closed. Notes, dates, follow-up reminders, and a follow-up email draft.
5. **Assistant.** Chat with an agent that reads your live JobRadar data from Redis, can save notes and reminders in its own Redis namespace, and can read any job URL you paste through Firecrawl.
6. **Profile and sources.** Drop a resume, then edit target roles, skills, locations, sponsorship need and score threshold. Toggle the internship list, the new-grad list, and watched companies on Greenhouse, Lever or Ashby.

## RocketRide pieces

| Pipeline | Nodes | Used for |
|---|---|---|
| `jobradar-tools.pipe` | `tools` + three `tool_redis` nodes (jobs `jobradar:jobs:`, user `jobradar:u:alex:`, seen marks `jobradar:seen:alex:`) + `tool_firecrawl` | All deterministic reads and writes, through `client.tool()` |
| `profile.pipe` | `webhook` → `parse` → `response_text` (resume text) and `question` → `prompt` → `llm_gemini` → `response_answers` (profile JSON) | Resume import |
| `writer.pipe` | `chat` → `prompt` → `llm_gemini` → `response_answers` | Explain fit, cover note, follow-up email |
| `assistant.pipe` | `chat` → `agent_rocketride` (+ `llm_gemini`, `memory_internal`, read-only `tool_redis`, notes `tool_redis` with writes, `tool_firecrawl`) → `response_answers` | Assistant chat |

Redis is used for: a sharded first-seen index (newness, closed detection);
per-job seen and hidden marks with expiry, listed with SCAN; tracker records;
reminders with expiry; a 7-day description and fit-explanation cache in front
of Firecrawl and the LLM; daily counters (INCR); a refresh lock (SET NX) so two
tabs never scan at once; and a digest key the assistant reads.

## Limits

- No scheduled background scan: pipelines bundled in an app cannot be scheduled. The app polls every 10 minutes while open.
- Gmail sync is not included, because no Gmail token is configured.
- Single user (`alex`).
- `tool_redis` is not yet in a released engine.
