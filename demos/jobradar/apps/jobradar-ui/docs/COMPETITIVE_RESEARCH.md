# Competitive review and implemented gaps

Reviewed November 25, 2026 against official product and help pages. This is a
feature comparison, not a pricing recommendation or a claim of feature parity.

## Competitors and evidence

| Product | Verified capability | Official source |
|---|---|---|
| Simplify | Application-question writing, networking/referral tools, and search analytics complement its tracker and resume tools. | [Feature comparison](https://feedback.simplify.jobs/en/help/articles/5623502-whats-included-in-simplify-features-and-pricing) |
| Teal | Its extension captures roles from multiple boards; free accounts include networking records in Companies and Contacts trackers. | [Extension](https://www.tealhq.com/tool/job-search-chrome-extension), [current account feature guide](https://help.tealhq.com/en/articles/9535168-is-there-a-teal-free-trial) |
| Huntr | Manual job entry, preserved descriptions, application deadlines, dated activities, contacts, interview tracking, keyword matching, and application-funnel metrics. | [Manual jobs](https://help.huntr.co/en/articles/13413245-the-job-board), [job-card details](https://help.huntr.co/en/articles/12640406-understanding-the-job-card), [activities](https://help.huntr.co/en/articles/10042702-activities), [contacts](https://api.huntr.co/product/contact-tracker), [interviews](https://huntr.co/product/interview-tracker), [keywords](https://help.huntr.co/en/articles/11030569-keyword-extraction-matching), [metrics](https://api.huntr.co/product/job-search-metrics) |

Teal's [current FAQ](https://help.tealhq.com/en/articles/9592114-frequently-asked-questions-faq)
says Interview Practice is unavailable to new users and unsupported, despite an
older detailed practice guide still being online. We do not count that older guide
as a currently available feature. JobRadar's practice flow is our own extension of
interview preparation and resume-grounded writing.

## What JobRadar lacked and now provides

| Gap | Implementation | Where to use it |
|---|---|---|
| A role outside the live feeds could not be added directly. | Manual title/company/public URL capture, optional Firecrawl text extraction, duplicate-URL checks, and retained description text. | Job Tracker > Add any job |
| A tracker card had status and notes, but no preparation plan. | Deadline, low/normal/high priority, editable checklist, card badges, and priority/deadline ordering. | A saved role > Track |
| No networking record. | Searchable contacts, linked applications, connection notes, dates, and follow-up flags. | Career tools > Networking |
| No contact-specific writing flow. | Editable, source-grounded outreach drafts with copy. Drafting never logs a contact or sends a message. | Contact > Draft outreach |
| No interview calendar. | Interview type, local date/time, duration, location, notes, edits, and personal `.ics` export. | Career tools > Interviews |
| No structured interview practice. | Role-specific questions, verifiable resume quotes for story ideas, employer questions, answer feedback, and optional answer-library saves. | Interviews > Build practice plan |
| No reusable application-answer library. | Manual or AI-assisted answers, optional role context, user facts, a word target/count, search, edits, copy, and TXT export. | Career tools > Answer bank |
| No visible resume keyword coverage. | A fixed skill dictionary identifies present/missing terms against the current resume editor text. | A role > Resume > Check keywords |
| No application-funnel or cadence view. | Recorded stages, response/interview rates, six weeks of application counts, weekly goal progress, upcoming deadlines, and networking follow-ups. | Career tools > Search insights |
| No portable application data export. | UTF-8 CSV with quoting and formula neutralization. Calendar and answer exports are separate user actions. | Tracker > Export CSV, or Search insights |

We reuse the existing RocketRide `chat`, `prompt`, `llm_gemini`, and
`response_answers` writer pipeline, plus `tool_firecrawl` for public postings.
The writer has a new project ID. No new service credentials, database nodes,
external contact lookup, mail permissions, or packages are required.

## Deliberate limits

- Capture is manual and URL-based, not a browser extension or application autofill.
- Keyword coverage is text matching across a bounded dictionary, not Huntr's
  broader semantic analysis, an ATS score, or a prediction of hiring success.
  Negated mentions may count; skills outside the dictionary may be missed.
- Interview questions and feedback are practice aids. Resume story quotes are
  retained only when the quote occurs in the imported source resume.
- Rates use explicit application dates and stage history. Posting closure alone
  never counts as rejection, and absent replies do not prove an outcome.
- Scheduling saves an interview record. The calendar file is a download, not an
  invitation or a write into Google Calendar. Existing calendar imports do not
  change when the JobRadar record changes.
- Outreach and application answers remain drafts for human review. Gmail stays
  disconnected by the user's choice, and automatic applications remain excluded.
- The file store still supports one active editing page per account. Atomic
  updates compose changes within a page; they do not provide distributed locking.
