# PR 7 wording and Case 1 acceptance

Date: 13 October 2026. Functional branch: `feature/tutor-followup-acceptance`.

## Baseline and release scope

At the start of this check PR 7 was open at `9ef89df`, while the production alias and remote `master` were still `91fe3ff`. The database had active Case 1 v1 (`6adeed78-e517-5f94-bc84-586ad15392fd`), draft versions 2/3, and one open v1 assignment. Alicia had a completed v1 session and Benjamin had an active v1 session. These were observations, not evidence that PR 7 was live. A fresh profile/version is required for a new content test; existing sessions are not reset.

This release includes PR 7 plus the acceptance fixes below. No schema migration or summary-worker source change is needed. Code deployment and clinical-content publication are separate operations; merging the engine does not publish a pending material pack.

## Acceptance fixes

- Extract actual question sentences from tutor messages rather than retaining the preceding acknowledgement/plan. Check the full history, current question and recent dialogue. Check transition starters as well as ordinary questions.
- Use exact and conservative close-wording matching. It is not a semantic-equivalence judge and does not guarantee that every possible paraphrase is eliminated. Questions about different tooth numbers are not automatically treated as duplicates.
- Keep model-written support bodies to 40 words at level 1 and 60 at level 2, ending in one question. Optional acknowledgement/correction prefixes are separate from those body limits.
- Use single-question, non-repeating fallback turns. Preserve the entire authored level-2 point: if it cannot fit safely, return a retryable error before committing rather than truncate clinical qualifiers or claim a reveal occurred.
- Keep supported-completion acknowledgements to 20 words, without mastery claims. Do not display a completion acknowledgement before a reveal/application has actually completed the phase.
- Persist the actual automatic-support provider/fallback independently of the answer grader, and reconstruct it after a repository reload.
- Show phase completion in the professor sidebar from actual completed phase state. A Help marker/reveal alone cannot produce a "Completed with tutor support" label. Help rows remain ungraded and have no grading controls.
- Carry the confirmed Phase 2 palatal #23/no #22/#24 resorption findings into Phase 4 faculty guidance. The first live run wrongly contrasted palatal and mid-alveolar descriptors; the corrected run accepted the numbered ordering and asked about missing skeletal evidence instead of asking the student to rank again.
- Production smoke testing exposed a role-switch timing bug: entering a professor review before the identity switch completed returned a student DTO and crashed the review component. The follow-up requests an explicit professor view, rejects student roles server-side before loading/signing the session, validates the staff DTO before mounting, and ignores aborted/stale fetches. An unavailable review now has no grading controls. Normal student responses and professor class authorization are unchanged.

## Verification

- Local TypeScript suite after the role-view follow-up: 533 passed, zero failed. 48 tests skipped in the local checkout: 35 opt-in/external tests plus the 13 ignored operator live-harness cases. Skipped tests are not counted as passed.
- TypeScript, ESLint, production build and diff whitespace check passed. Python Case 1/profile and review-preparation suites passed 15 + 6 tests.
- Explicit real OpenAI run: 12 support scenarios (six phases, both levels) and one numbered-list scenario passed. Provider fallbacks were not counted as live passes. The first failing clinical run is retained separately from the final result.
- Local full HTTP workflow used synthetic instructor-oracle answers, not real student performance. All six phase answers used OpenAI with no fallback, taking approximately 9.2–11.9 seconds per request. Phase 4 used a numbered list; Phase 5 used the conditional retention plan. This is not a production p95 measurement.
- Browser student workflow: first answer, two Help presses with the typed draft retained, disabled Help at level 2, closing reflection and immediate summary passed. Staff API snapshots showed messages 3 → 5 → 7, evaluations unchanged at 1, state version 2 → 3 → 4, and unchanged attempts, criteria, mastery, strengths/weaknesses and error history during Help.
- The browser summary recorded Phase 1 as completed with support and the other five as completed independently. Reflection was ungraded. The professor transcript contained two Help turns with no controls; supported-completion sidebar rendering additionally has positive/negative component regressions.
- Separate live automatic-support HTTP run: two weak answers produced level 1; continued weak answers produced level 2; an application answer advanced with support and without the old fixed completion boilerplate. Every observed visible response used OpenAI without fallback.
- Browser console reported zero errors/warnings in the local verification context.

The initial engine release `e8fa386` passed feature/master CI and reached production READY. Its first production smoke test caught the review crash above; that failed screenshot is retained, not counted as an acceptance pass. Final production acceptance must be repeated on the role-view follow-up commit. Case 1 v5 remains a private draft until approval evidence is matched to its revised content.

The ignored evidence is under `work/pr7-*-results.json`; screenshots are under `output/playwright/pr7-*.png`. Secrets, authentication state, source documents, media and private manifests are not committed.

## Material candidate

- Private directory: `work/case1-pr7-final-2026-10-13`
- Package ID: `07b59f80dda8e83278ec326503319a5ffd6ba9597392b44af53d66e3b294dd18`
- Case ID/version: `636de74f-a99e-5bb6-a37d-205e23ea884a`, v5, rooted at the existing v1 case
- Clinical content SHA-256: `cffc4e8b005a47bd03026ee022062b968d61baa703d76fa60f5b9b48e0158fe7`
- Seven media files and 21 references, staged privately as a draft. No assignment was created/moved during staging.

Clinical publication requires confirmation for the actual revised content. The operator must not self-mark it approved from a passing technical test. Keep prior sessions on their original case version, then verify the new open assignment/content version and private media after an authorized publication.
