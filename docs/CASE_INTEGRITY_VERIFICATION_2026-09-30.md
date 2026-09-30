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
| Consolidated local Vitest and final CI | 344 passed, 14 opt-in tests skipped; 65 passing files, 4 skipped |
| TypeScript / ESLint | Passed |
| Application CI / production build | Passed at `b013ccc` |
| Isolated migrations + compatibility seed + pgTAP | 119 assertions across 7 files passed at `b013ccc` |
| Real REST/RPC concurrency | Passed: atomic save/publish, two-argument wrapper, three-argument publish/assignment locking, future timestamp preservation and duplicate-turn persistence |
| Dependency audit | Zero reported vulnerabilities |
| Synthetic document / interview importers | 5 + 5 passed |
| Real OpenAI structured-output smoke | Passed, about 7.2 seconds, without fallback; synthetic input only |
| Private-media copy helper | Dry-run, idempotency, divergent-object and post-upload verification tests passed |
| Real private-media SQL regression | Success, no-reference fresh database, idempotent second run, public-bucket rejection and missing-object rollback passed |
| Offline retrieval comparison | Three synthetic samples and four tests passed; retain baseline, clinical outcome not assessed |

Full release CI: [36726958942](https://github.com/Hongyu1231/socratic-digital-twin/actions/runs/36726958942), commit `b013ccc7ecc6fc8cca69d9df790ce45bcc42ddd6`. It includes the numbered media migration and its byte-identical canonical SQL regression. A later documentation-only commit does not change this tested runtime.

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
- Media rollout completed: all 19 objects were copied and downloaded again for SHA256 equality. A second comparison of all original/private bytes passed, and the deployed media module generated 19 signed URLs whose contents were fetched successfully. Learner media DTOs contained zero separate raw storage keys.
- The transactional metadata migration removed old managed public references from both attachment arrays and the legacy context mirror. Full metadata inspection, including poster/citation fields, found no old public-bucket URL references.
- Non-media case-content and attachment-ID fingerprints matched before/after. Counts remained 13 cases, 18 sessions and 15 assignments.
- Both buckets are now private. Each still contains 19 WebP objects; original objects were retained. New private copies have `max-age=0` (the old objects retain their original metadata).
- After the old bucket privacy change, the final 57 unauthenticated checks all returned 400: 19 original public URLs, 19 nonce-qualified public URLs and 19 unsigned private-object URLs. The first immediate check denied 56/57; the follow-up was 57/57, so the report does not rely on the initial incomplete result.

## Release status and limits

Production rollout completed in the required order: the five integrity/publication migrations → application `d9092a0` (Vercel Production success, GitHub deployment `6761502175`) → verified copies → migration `20260930140812_private_case_media_cutover.sql` → old bucket made private → signed/unsigned Storage smoke. The tested second-stage code and evidence are promoted through `master`; no PR is required for this user-authorized direct merge.

The engineering portion of PR #2 §3.9 now has a reproducible, metadata-only comparison harness. Synthetic baseline MRR was 0.7778 versus criterion-focused 0.8333, but one sample favored baseline. No online retrieval strategy was changed. Faculty-labelled fixed-answer evaluation is still needed before a clinical strategy decision; synthetic results do not complete that external review.

The original checkout's tracked files and unrelated untracked `lib/repository/_debug.test.ts` were preserved. No production reset, seed, learning-session deletion, clinical reimport or patient-media upload was performed.

The site remains a password-gated demonstration with seeded role switching, not real patient-record authentication. Faculty approval of actual clinical criteria/reveal text remains external. The tutor receives attachment descriptions/released findings, not image pixels. Real authentication, IRB patient-image handling, and the spec's explicitly long-term expert-note database migration are not silently marked complete. Previously downloaded/cached media cannot be revoked by changing bucket privacy.
