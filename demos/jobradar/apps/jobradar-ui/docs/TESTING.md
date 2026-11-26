# JobRadar regression testing

Run on November 25, 2026 against the private Cloud app `aidenbuck.jobradar`,
including fixes published as registry version 10 (app version 0.3.0).

## Automated and live service checks

- `node --test scripts/tests/features.test.mjs`: 16 passing tests.
- App TypeScript check: passed. Cloud compilation and private publication: passed.
- Changed check scripts: ESLint passed.
- `scripts/check-jobradar-career.mjs`: Cloud writer validation returned zero
  errors and warnings. Fictional-source live tests passed for six candidate
  practice questions, exact source-supported stories, practice feedback,
  networking outreach and an application answer within its requested target.
- Storage tests cover failed reads, rollback after failed writes, recovery,
  serialized updates, expiration and conditional writes. The new regression
  exercises actual tracker functions with a stale view, plan updates, failed
  note saves, status changes, posting closure/reopening and disk reopening.

## Real screen-control coverage on Cloud

All mutations used records explicitly prefixed `JobRadar Regression`. Original
resume/profile and existing applications were preserved. Post-cleanup SDK reads
confirmed the original profile, resume, preferences and three application records
were byte-for-byte unchanged, with zero remaining career fixtures. Cleanup removes only
known fixture records and their related cache/reminder/stat entries.

| Flow                 | Checks                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Manual capture       | Required title, private URL rejection, normalized duplicate rejection, long saved description, successful Cloud save and reload            |
| Application plan     | Priority, checklist completion, add/remove custom step, notes, status transition, reload and independent backing-file verification         |
| Contacts             | Invalid email rejection, create, edit, mark contacted, search, reload, remove confirmation and cancellation                                |
| Answer bank          | Manual create, edit without duplication, invalid drafting limit, search, clipboard contents, reload, remove confirmation and cancellation  |
| Interviews           | Required time and minimum duration validation, seeded-event edit, saved duration/title, persistence, remove confirmation and cancellation  |
| Interview generation | Real Cloud practice plan, candidate-facing questions, separate employer questions, supported evidence, cache refresh after writer revision |
| Posting retrieval    | Successful Firecrawl read, DNS failure on reserved `.invalid` host, visible error and re-enabled form controls                             |
| Responsive layout    | Desktop, 768 px tablet and 390 px phone; header containment, drawer bounds, long posting and career forms                                  |
| Keyboard             | Career tabs support Home, End and arrow navigation with selected-tab updates                                                               |

## Bugs found and corrected

1. Whole-record note, status and posting-closure saves could replace newer plan
   fields. They now compose field updates against the latest in-page record.
   Note-save failures also produce a visible error instead of an unhandled rejection.
2. The wrapped phone navigation retained a percentage height and overlapped the
   page. Its phone height is now automatic.
3. The job drawer remained 620 px wide on phones. It is capped to its containing
   viewport, with scrolling tabs and wrapping posting text.
4. Empty searches described an empty account. Existing libraries now show
   specific no-match messages.
5. The model put employer questions in candidate practice. The prompt now
   explicitly separates these, uses a new pipeline project ID and binds saved
   plans to the writer revision as well as the source resume.

## Limits of this pass

- This is a targeted regression, not exhaustive browser/device certification.
  Native Safari/Firefox, physical touch devices and screen readers were not tested.
- Chrome's native empty date-time picker could not be reliably driven by the
  automation tool. Required-field validation was verified. Cloud interview editing
  used a seeded fictional event with a valid time; initial creation through the
  native picker was covered locally in the preceding acceptance pass.
- Destructive UI confirmations were cancelled. Fixture cleanup used the SDK;
  successful permanent deletion was not clicked in the production UI.
- There was no full browser-offline or server-restart test. Backend fault injection
  covers storage failures; the browser pass covers a real posting DNS failure.
- Concurrent editing across tabs/devices remains unsupported by file snapshots.
  Use one active editing page per account. This was not stress-tested against real
  account data, because a stale page can overwrite another page's snapshot.
- Unsaved form edits and generated drafts are temporary and can be lost when
  switching workspace tabs. Save library records before navigating away.
- Gmail remains disconnected at the user's request. OAuth consent, real inbox
  access, external calendar writes, mail delivery and automatic applications were
  outside this pass. Drafting does not send anything.
