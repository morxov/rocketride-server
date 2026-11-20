# JobRadar roadmap

Updated 2026-11-19. The same roadmap appears on the page in `index.html`.

## Already shipped

- Dashboard showing what is new, today's picks, follow-ups due and the pipeline
- Jobs inbox with New, All matches and Hidden tabs
- Duplicate merging across sources, plus repost and stale detection
- Transparent scoring with reasons; sponsorship is a hard filter
- Resume import, Explain fit, cover note and follow-up drafts (Gemini 3.5 Flash Lite)
- Tracker board with automatic follow-up reminders
- Assistant with Redis memory that saves reminders and notes
- Watched Greenhouse, Lever and Ashby boards
- New-match notifications every 10 minutes while the app is open

## Now: done 2026-11-19, before the demo

| Type | Item | What changed |
|---|---|---|
| Fixed | Closed alerts only when a posting really closed | `detectClosed` (`src/lib/store.ts`) now needs positive evidence: a list that answered shows the posting as closed (`closedFps`), or a watched board that answered no longer has that posting's ID (`boardsChecked`, matched with `postingKey`). Failed fetches, levels turned off and unwatched companies no longer close anything. Postings that reappear are reopened. |
| Fixed | New survives a page reload | `startSession` keeps the same baseline (`since`) within a visit; a new visit starts after 2 hours away. `touchSession` keeps the visit alive on every refresh. Old state keys (`lastVisit`, `previousVisit`) are still read. |
| Fixed | Fewer false repost and merge flags | `normalizeTitle` keeps non-season brackets, so "(Backend)" and "(Frontend)" stay separate. `recentPostings` only counts postings within 150 days of the latest one, and counts rows posted within 3 days of each other as one wave. Repost flags dropped from 470 to 308 of 2,301 cards. |
| Fixed | Source fallback | `SIMPLIFY_SOURCES` lists candidate URLs per level (Summer2027, then Summer2026, then Summer2028) and reports a clear error if none load. |
| Fixed | Stale reminder after Offer or Closed; closed banners | The reminder now leaves the screen at once. Closed-posting banners hide once the job is removed, and each banner dismisses only itself. |
| Tested | Remaining paths | Lever source (Palantir), cover note, Mark all seen (survives reload), remove from tracker, Offer and Closed columns, closed alert banners. |

## Next (2 to 4 weeks): better answers, less waiting

- **Real skill matching:** fetch descriptions for the top matches in the background, so skill scores use the full posting rather than only the title.
- **More job sites:** support Workday and other company sites through Firecrawl, tested end to end.
- **Faster, live assistant:** read live tracker data through tools instead of the daily digest, and stream replies.
- **Keep your data:** turn on Redis persistence so the tracker survives a container restart; add a CSV export.
- **Weekly review:** a short weekly summary of applications, responses, roles going stale, and follow-ups.

## Later: from one laptop to anyone

- **Sign-in and multiple users:** use the Auth0 node for sign-in, with a Redis namespace per user, replacing the hard-coded `alex`.
- **Scan while the app is closed:** a scheduled pipeline that checks sources and stores new matches. Pipelines bundled in an app cannot be scheduled, so this has to be a standalone deployed pipeline.
- **Email sync:** read recruiter emails to move tracker cards automatically. This needs a Gmail token.
- **Deploy and publish:** ship JobRadar to a hosted RocketRide server once `tool_redis` is in a released engine. A deploy target (`ROCKETRIDE_DEPLOY_URI`) has to be configured first.
