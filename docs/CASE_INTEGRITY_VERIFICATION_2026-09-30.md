# Case integrity and tutor workflow verification

Date: 2026-09-30. Scope: Issue #4 and Bruce's engineering work in PR #2 (spec head `3d476af`). This is software acceptance evidence, not clinical sign-off or a claim that the whole application is defect-free.

## Implemented contracts

- Shared attachment limits (title 160, description 2,000, URL 2,048), write-time stable IDs, bounded admin diagnostics, and fail-closed save/clone/publish for malformed stored data.
- Persisted difficulty with source-backed backfill; atomic service-role draft saving; publication/phase immutability with parent locks and trusted maintenance bypass.
- Superseding publication keeps historical sessions on their original case. Open assignments can move in place, or remain on the previous version by explicit choice. New assignments require active cases. Concurrent publication preserves assignment timestamp ordering.
- Criterion evidence uses `{ id, evidence }`, accumulates across answers, and is not inferred from keywords by the deterministic explicit-rubric fallback.
- Bounded probe/hypothetical/reveal/application progression, confidence-gated wrong-answer correction, supported completion distinct from mastery, and a separate ungraded reflection.
- Minimal allowlisted learner DTOs; private criteria, evaluation internals, retrieval traces and separate storage keys are not serialized to students.
- Signed-media authorization binds the exact session/case/attachment and phase. Ownership/class checks, identical missing/locked errors, no-store responses, bounded signing, refresh/retry and stale-response cancellation are tested.
- Student progress/support/findings UI; professor reflection remains ungraded while tutor-quality review remains available.
- Admin round-trip preserves criteria, reveal text, scripted targets, limits, findings and private media. Superseded versions expose cloning only.
- New material publication defaults to the private bucket, with cache lifetime zero. Existing-media migration is a separate staged rollout.

## Automated evidence

| Check | Observed result |
| --- | --- |
| Consolidated local Vitest | 340 passed, 14 opt-in tests skipped; 64 passing files, 4 skipped |
| TypeScript / ESLint | Passed |
| Application CI / production build | Passed at `71e0931` |
| Isolated migrations + compatibility seed + pgTAP | 119 assertions across 7 files passed at `71e0931` |
| Real REST/RPC concurrency | Release gate pending final assertion compatibility fix; the new test exposed and fixed a real timestamp race |
| Dependency audit | Zero reported vulnerabilities |
| Synthetic document / interview importers | 5 + 5 passed |
| Real OpenAI structured-output smoke | Passed, about 7.2 seconds, without fallback; synthetic input only |
| Private-media copy helper | Dry-run, idempotency, divergent-object and post-upload verification tests passed |

Skipped live tests are not counted as passes. Local Docker was unavailable, so database execution uses isolated GitHub Actions containers. Database/E2E fixtures were not run against production.

## Browser evidence

A local production build at `127.0.0.1:3213` used memory storage, deterministic tutoring and synthetic fixtures, with no production credentials in the server process.

- Student: real composer submission, bounded support/application, final reflection, automatic summary navigation, image viewing/zoom, findings and supported-completion caveat passed.
- Professor: queue, three graded answer labels for four turns, ungraded reflection, draft save and review completion passed.
- Admin: clone/edit/save/reopen retained v2 fields; publishing v2 moved assignments. A superseded-action UI regression was found, fixed and regression-tested.
- Version continuity: the original learner retained v1 and its summary; a new learner saw and began v2.
- No new browser exceptions were captured during the final production-build flow. An earlier development-server restart caused a chunk-load error; the final run used a stable production build.

Screenshots in the original checkout's untracked `output/`: `todos-final-build-summary.jpg`, `todos-final-build-versions.jpg`, `todos-final-build-new-version.jpg`, `todos-professor-review.jpg` and `todos-admin-v2-editor.jpg`.

Production browser acceptance remains pending: the automation browser blocked opening the site, and the user was asked to open it manually and pass the existing password gate. Local browser acceptance is not presented as production-browser acceptance.

## Live read-only and Storage checks

- Correct project: `zulvdacbqvmqmtotyeuc`; no unrelated Supabase project was used.
- Preflight: 13 cases, 19 attachments; no missing IDs, invalid attachment diagnostics or multiple-active lineages. All 19 existing managed public media URLs match the exact migration shape.
- Student-offering repository: five warm read-only samples ranged from 674.85 to 731.21 ms, averaging 704.02 ms. This is not an HTTP production p95 measurement.
- Unauthenticated production identity API returned 401 with the expected Basic challenge and no-store cache policy.
- A disposable synthetic private Storage fixture verified anonymous/public denial, signed read, token expiry at origin and renewed signed read. The fixture was removed.
- Copy preflight: 13 cases scanned, 19 unique objects to copy, zero copied in dry-run. Original objects are retained throughout the rollout.

## Release status and limits

Application promotion and the forward production migrations remain pending final CI. Existing media is not yet cut over. The intended order is: verified schema migrations → application deployment → verified object copies → transactional metadata cutover → close the old public bucket → production smoke checks.

The original checkout's tracked files and unrelated untracked `lib/repository/_debug.test.ts` were preserved. No production reset, seed, learning-session deletion, clinical reimport or patient-media upload was performed.

The site remains a password-gated demonstration with seeded role switching, not real patient-record authentication. Faculty approval of actual clinical criteria/reveal text remains external. The tutor receives attachment descriptions/released findings, not image pixels. Real authentication, IRB patient-image handling, and the spec's explicitly long-term expert-note database migration are not silently marked complete. Previously downloaded/cached media cannot be revoked by changing bucket privacy.
