# Case integrity and tutor workflow verification

## Latest acceptance update (2026-09-30)

This section supersedes the historical local-only results below. Clinical approval is not implied by software acceptance. The application remains a password-gated demo with publicly selectable seeded roles, not real patient-record authentication.

Implemented since the earlier report:

- Atomic service-role draft-save RPC, parent locks, immutable publication and real isolated concurrency checks.
- Minimal allowlisted student DTOs, excluding learner state, evaluations, private criteria, retrieval traces, raw storage keys and internal class/student identifiers.
- Progress/support UI, phase outcomes, released findings, signed-URL refresh/retry and stale-request cancellation. Legacy outcomes are not mislabeled as independent mastery.
- Professor reflection is ungraded in the UI, API and both repository adapters. Tutor-quality review remains available.
- Admin editor preserves structured criteria/reveal text, scripted targets, limits, findings and private-media settings. Malformed stored records remain locked pending reviewed repair. Superseded versions offer cloning only, not editing or re-publication.
- Superseding publication retains historical session case IDs and optionally moves existing open assignment rows in place. The publisher uses the same atomic RPC and supports `--keep-open-assignments`.
- Private uploads request cache lifetime zero. Existing public literature media is unchanged.

Executed checks before the final superseded UI regression test: 325 application tests passed, 14 opt-in tests skipped (63 passing files, 4 skipped); TypeScript, ESLint and dependency audit passed with zero reported vulnerabilities. The additional superseded UI regression passed separately. A final consolidated run/build and final migration CI remain release gates.

Isolated CI at `b917d49` passed both jobs: migrations, compatibility seed, 100 pgTAP assertions across 6 files, loopback target guards, and real REST/RPC concurrent save/publish and duplicate-turn tests. This run does not validate the subsequently added superseded migrations; they require a new CI run.

Live checks: synthetic real-OpenAI structured output passed in about 7.2 seconds without fallback. Readonly tutor Supabase preflight passed: 13 cases, no attachment diagnostics, no multiple-active lineages. A disposable private Storage fixture verified anonymous/public denial, signed read, origin expiry and refreshed read; the fixture was removed and the private bucket retained. Signed URLs cannot revoke previously downloaded/cached copies.

Browser acceptance at local `127.0.0.1:3213` used memory storage, deterministic tutoring and synthetic fixtures, with no production credentials in the server process:

- Student: composer submission, bounded review/application support, final reflection and automatic summary navigation passed. Images opened and zoomed; findings/progress and supported-completion caveat rendered.
- Professor: queue, three answer labels for four turns, explicitly ungraded reflection, draft save and review completion passed.
- Admin: clone/edit/save/reopen preserved all v2 fields; v2 published with assignment movement. Browser exposed the superseded-action UI regression, which was fixed and covered by a regression test.
- Version continuity: original learner retains v1 and can read its summary; a new learner sees v2.

Evidence screenshots are in the original checkout's untracked `output/`: `todos-supported-summary.jpg`, `todos-professor-review.jpg`, `todos-admin-v2-editor.jpg`, `todos-historical-summary.jpg`.

No production reset, seed, learning-session deletion, clinical reimport or patient-media upload was performed. Only the disposable Storage verification object was removed. The original dirty checkout and unrelated untracked `_debug.test.ts` are preserved. Faculty approval of clinical criteria/reveal text, real authentication and IRB patient-image handling remain external decisions, not silently completed engineering tasks.

## Historical checkpoint — superseded by the update above

Date: 2026-09-30. Branch: `feature/case-integrity-contract`.
Base: `cd46b17cd7010587fde2ad7f0f2d23ee79229df6` (`origin/master`).

Scope: Bruce's backend work from issue #4 and the updated PR #2 criteria/evidence contract. No collaborator UI/editor/content was overwritten. This is a local release candidate, not a production deployment or an all-requirements sign-off.

## Implemented

- Shared case/media title (160), description (2000), and URL (2048) limits across API validation and the teaching-material publisher.
- Attachment IDs assigned at write time; reads never generate replacement IDs. Invalid persisted attachments are hidden from learners, reported through bounded admin diagnostics, and block save/clone/publication instead of being silently lost.
- Difficulty persisted by the repository/importer. Forward migration adds its enum-like check and source-backed imported-case backfill.
- Draft-only conditional publication, explicit status transitions, missing-case handling, phase-delete error propagation, and empty-phase publication checks.
- Forward migration enforces immutable published/archived case content and phases, with parent-row locking and a privileged transaction-local seed bypass. CI now resets the isolated database with the compatibility seed.
- New model criterion output is `{ id, evidence }[]`; historical string arrays remain readable. Valid criteria accumulate independently of the classification label. The deterministic fallback does not guess explicit clinician rubric credit from keywords.
- Session/media access supports the owning student, a professor in the assigned class, and admins; verifies exact session/case binding; signs only phase-unlocked private media; never returns separate raw storage keys. Missing/locked attachment responses are identical.
- Completed summaries no longer falsely list five fixed phases; one-phase completion wording is singular.
- Two transitive development dependency security updates; no unrelated lockfile version churn.

## Executed checks

| Check | Result |
| --- | --- |
| Full Vitest suite | 292 passed, 13 opt-in tests skipped; 54 passing files, 3 skipped |
| TypeScript / ESLint / production build | Passed |
| Full dependency audit and production-only audit | Zero reported vulnerabilities |
| Teaching-material importer synthetic tests | 5 passed using the bundled Python runtime |
| Expert-interview importer synthetic tests | 5 passed |
| Real OpenAI structured-output smoke | 1 passed, approximately 8.7 seconds, no fallback; synthetic input only |
| Whitespace check | `git diff --check` passed |
| New database tests | 32 pgTAP assertions authored, **not executed** |

The default Python environment lacked `pdfplumber`; the existing bundled runtime ran the material-import tests without installing or changing global packages.

Read-only production metadata preflight inspected 13 cases and 19 attachments: zero missing attachment IDs, longest title 35 characters, longest description 91 characters. No content was truncated, migrated, deleted or reimported. This was an ID/length audit, not a full clinical-content or database-integrity certification.

## Browser and local API evidence

The production build ran at `http://127.0.0.1:3213`, with forced memory storage and the deterministic tutor. All test content was synthetic and local; production credentials were absent from this server process.

- Student: created an assigned one-phase object-rubric case, submitted answers with the actual composer, received an explicit review point/application question at the phase ceiling, answered once to advance with support, then completed a separate reflection and opened the summary automatically. Final-build retest confirmed the corrected summary wording and supported-completion caveat. Remaining gaps were retained and the score was 23, not automatic mastery.
- Professor: the completed session appeared in the review queue and the transcript/evaluations loaded.
- Admin: overview and case list loaded, including the published test case and archived cloned version.
- Browser console: no captured warnings/errors for these flows.
- API checks: 744-character attachment description accepted; persisted attachment ID stable across reads; simultaneous memory-adapter publish requests returned 200/409; unknown publish returned 404; archived publish returned 409. This does not establish real PostgreSQL concurrency safety.
- Student session projection hid evaluations and private rubric data; professor projection retained four evaluations including the ungraded reflection flag.

Screenshots are local artifacts in the main checkout's ignored/untracked `output/` directory: `case-integrity-student-summary.png` and `case-integrity-admin-check.png`. Temporary browser tabs and the test server were closed after verification.

## Release blockers and remaining integration

1. Docker Desktop's Linux engine is unavailable (`dockerDesktopLinuxEngine` pipe connection failure); no local PostgreSQL/psql is installed. The Docker status command also did not return and was stopped. Run all migrations, the compatibility seed and pgTAP tests in an isolated database/CI before applying these new migrations. Prior CI results do not validate these new files.
2. Draft save still updates the case row and replaces phases in separate requests. Delete errors are surfaced and empty cases cannot be published, but a partial-save/concurrent-edit window remains. An atomic draft-save RPC and multi-connection regression test are still needed; this branch does not claim full edit/publish atomicity.
3. Arshin's frontend still displays ungraded reflection as a normal `partial`/0%-confidence answer in the professor review UI. Object-rubric editor preservation, admin diagnostic display, signed-URL refresh, progress/support presentation and reviewed Case 1 content remain integration work.
4. Real private Storage RLS/URL expiry, superseded-version assignment policy, the complete minimal student DTO, real authentication, and faculty clinical approval are not completed by this change. Existing public media was not migrated.

Safe next order: finish atomic draft saving → run isolated migration/seed/pgTAP and real concurrency checks → integrate collaborator UI/content → apply verified forward migrations → deploy the application → production smoke. Never run reset/seed/test fixtures against production.

No commit, push, merge, production migration or deployment was performed in this pass. The original checkout's tracked files were left unchanged. An unrelated untracked `lib/repository/_debug.test.ts` found there was preserved because its ownership could not be established.
