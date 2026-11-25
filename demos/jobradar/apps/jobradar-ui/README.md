# JobRadar

A job-search dashboard for internships and new-grad roles. It merges duplicate
postings, explains matches, flags stale roles, tracks applications, reads recruiting
email, and tailors a resume for a selected job.

The app is `aidenbuck.jobradar`. Its current pipelines use RocketRide catalog nodes
and run locally or on RocketRide Cloud **without a Redis node**.

## Interface

The interface follows Simplify's product layout: white top navigation, a cyan
welcome area, pastel summary cards, and a job list beside its selected role.

![JobRadar dashboard using the fictional sample profile](assets/jobradar-desktop.jpg)

| Screen | Purpose |
|---|---|
| Home | New matches, follow-ups, application progress, best picks |
| Job Matches | Search, filters, freshness, sources, and job details |
| Job details / Resume | Create an editable resume version for this role, review changes and gaps, save edits, download TXT, or Print / Save PDF |
| Job Tracker | Saved through Closed, follow-up reminders, application notes |
| Assistant | Discuss the current search snapshot or read a public job URL |
| Email | Connect Gmail, search application messages, read plain text, and review a proposed tracker update |
| Profile | Import the original resume, edit preferences, watch companies, and manage demo data |

`src/design.css` owns scoped styling and responsive layouts. `src/ui.tsx` and
`src/icons.tsx` contain shared interface components. Detail tabs support arrow
keys, Home, and End. The bundled sample resume is fictional.

## RocketRide nodes

| Pipeline | Nodes | Purpose |
|---|---|---|
| `profile.pipe` | `webhook`, `parse`, `response_text`, `question`, `prompt`, `llm_gemini`, `response_answers` | Extract resume text and profile facts |
| `writer.pipe` | `chat`, `prompt`, `llm_gemini`, `response_answers` | Explain fit, tailor resumes, draft cover/follow-up text, classify an email update |
| `jobradar-tools.pipe` | `tools`, `tool_firecrawl` | Read public job pages |
| `assistant.pipe` | `chat`, `agent_rocketride`, `llm_gemini`, `memory_internal`, `tool_firecrawl`, `response_answers` | Answer from an app-supplied snapshot; read a job link on request |
| `email.pipe` | `tools`, `tool_gmail` | Read-only Gmail search, message metadata, plain-text bodies, and connection checks |

Gemini uses `${ROCKETRIDE_GEMINI_KEY}` and Firecrawl uses
`${ROCKETRIDE_FIRECRAWL_KEY}` from the connected user's server environment.
Credentials never belong in tracked source or pipeline JSON. Edited pipelines receive new
`project_id` values to avoid reattaching to old tasks.

## Email connection

1. On Cloud, open **Email > Connect Gmail**. Google sign-in uses RocketRide's hosted OAuth
   broker, following the platform's Google node configuration flow.
2. Review Google's consent screen. The requested scope is `gmail.readonly`.
3. Search with Gmail syntax. The default finds recruiting messages from the last
   180 days and loads at most 25 results. Selecting a message reads its plain text.
4. Select the related tracked application, then **Review application update**.
   This explicitly sends that message's subject, sender, and up to 16,000 characters
   of text plus the selected application details to Gemini. Review its evidence
   before pressing **Confirm tracker update**.

Company-name matches are suggestions only. No tracker status changes automatically.
Mail is never sent, deleted, relabeled, or marked as read. HTML bodies are not
rendered. Retrieved content is treated as untrusted data in the writer prompt.

OAuth callback tokens are removed from the URL immediately, checked against a
pending per-tab nonce, and passed only to a dedicated running Gmail task. OAuth
credentials are not written to the file store or browser storage. The task handle
is kept in session storage and the task expires after one hour. Reconnect when the
session expires or the tab is closed. **Disconnect Gmail** terminates the task;
revoking Google consent is a separate action in the Google account permissions.
A denied sign-in or a broker/Google configuration error appears in the Email page.

The production OAuth broker accepts only HTTPS RocketRide domains, so it rejects
localhost callbacks. The local page links to **Connect Gmail on Cloud** rather
than initiating a broken redirect. A local engine can alternatively be configured
out of band with `ROCKETRIDE_GMAIL_TOKEN` containing the user-OAuth JSON from the
platform's Google node flow; restart the engine, then choose **Use configured local
Gmail**. Keep this credential in the ignored engine `.env` only.

## Resume customization

Open a role's **Resume** tab and press **Tailor my resume**. The writer receives
the complete imported resume and up to 16,000 characters of the posting. It is
instructed to preserve facts, contact details, dates, employers, education, links,
and numeric claims. It returns the resume, a change list, and unsupported job
requirements separately. Model output still needs human review.

Edit and save the version for that role. TXT export and browser Print / Save PDF
use the current editor contents, including unsaved edits. The original remains
in Profile. A source fingerprint prevents restoring a saved version against a
different uploaded resume. Versions persist until removed with the app's data.

## Persistence and migration

`src/lib/storage.ts` replaces the former Redis wrapper with the RocketRide SDK's
account-scoped file store:

- `.jobradar/v1/user.json`: profile, source resume, preferences, tracker, reminders,
  notes, digest, fit cache, `tailored:<job fingerprint>` versions.
- `.jobradar/v1/jobs.json`: first-seen index, description cache, counters.
- `.jobradar/v1/seen.json`: seen and hidden marks.

Values retain expiry timestamps. Writes are serialized within the page and roll
back in memory on failure. The current cloud server lacks `fs_put_json`, so the
adapter uses the supported `fsReadString` / `fsWriteString` SDK methods.

**Use one active JobRadar page per account while editing.** This adapter caches
namespace snapshots and has no distributed transactions or cross-device lock.
Concurrent pages can overwrite each other's changes. Local and cloud servers have
separate user file stores. The assistant receives a fresh digest from the app; it
can suggest reminders and notes but cannot save them automatically in this version.

To copy an existing Redis demo's records, preserving destination values and TTLs:

```sh
node --env-file=.env scripts/migrate-jobradar-storage.mjs --cloud
```

Run from `demos/jobradar`. This is a one-time, non-destructive migration using the
original local Redis pipeline in `scripts/fixtures/original-redis.pipe`. The live
app and cloud deployment do not load that pipeline. Redis is needed only to read
old data during this optional migration.

## Running, verification, and cloud

See `../../README.md` for setup. Unit tests cover storage serialization, write
rollback, read failures, expiry/conditions, resume parsing/source changes, and the
absence of Redis from runtime pipelines. `scripts/check-jobradar-cloud.mjs` checks
all pipeline schemas, actual cloud resume generation, email classification with a
fictional message, and migrated file-store data. Actual Gmail reads require the
user to complete Google consent. Live browser verification reached Google's
"unverified app" warning for RocketRide's OAuth service; the user must review
that warning and finish sign-in before inbox access can be verified. The user
chose to skip Gmail connection for now; no mailbox access was granted.

Cloud namespace `aidenbuck` was registered on November 24, 2026. The earlier Redis
catalog and developer-registration blockers have been removed from this app's
path. App 0.2.0 built successfully and is serving privately to `@me`, never publicly. Cloud provider secrets belong
in the signed-in user's environment. Cloud deployment credentials stay in the
ignored workspace `.env`.

## Limits

- Job sources are checked only while the app is open, normally every 10 minutes.
- File-store persistence currently supports one active editing page per account.
- Gmail is the first email provider; Outlook is not wired into this UI.
- No automatic applications, outgoing email, or automatic calendar scheduling.
- Auto-apply would need an ATS-specific browser or extension layer for form
  filling, resume uploads, and screening answers. RocketRide can orchestrate the
  existing resume/writer and job tools, with `mcp_client` connected to a browser automation MCP server preparing forms
  for human review. Final submission should remain a separate explicit action.
