# Feedback follow-up verification

This follow-up supplements `CASE_INTEGRITY_VERIFICATION_2026-09-30.md`. Engineering checks are not clinical approval.

## Changes

- Professor assignment creation retains an idempotency key across retries with unchanged details; success or a new intent gets a new key. Conflicting payloads return 409. Assignment ownership/status are not overwritten by a retry.
- Session creation writes the session, learner state and opening message in one service-role transaction. Concurrent retries return the same complete session.
- Professor/admin queues use a lightweight, class-scoped keyset page (25 rows by default, maximum 50), with server-side review filters and full-scope SQL aggregates. Review saves return the updated session instead of rehydrating every session.
- Date ordering compares timestamps, including different timezone offsets.
- New clinical imports carry pending review metadata. Publishing a pending or content-modified approval is rejected. Legacy packs remain readable; missing metadata does not demonstrate faculty approval.
- A private revision helper produces new case/phase IDs and version lineage while preserving each case's matched images. It does not overwrite source material or publish automatically.
- Case 1 regression covers the reported repetitive crowding question; draft phases ask relevant initial assessment/history/examination questions and use bounded support/application progression.

## Source audit

The private library contains Case 1–3 descriptions, 19 matched images, 20 published references and one expert-panel interview. The previous six-stage imported content was generated scaffolding, not an explicitly faculty-approved structured grading script. Two older DOCX scripts have five/six stages but no embedded images. Images from a different patient were not attached to these cases.

A private review package contains three version-2 draft cases and 18 structured phases, plus a faculty review checklist. All 19 image hashes match the source package. Its review status remains pending, and no draft clinical content is published by this engineering release.

## Verification

- Local final suite: 373 Vitest assertions passed, 14 opt-in assertions skipped; TypeScript, ESLint and production build passed.
- Six explicitly enabled real-OpenAI smoke tests passed: high-confidence wrong-answer correction, no correction for vague/partial answers, one grounded question for each of Cases 1–3, and prompt-injection non-disclosure. These are bounded smoke tests, not full clinical conversation validation.
- Synthetic importer/revision tests passed (7 + 5 + 2 at source-audit completion). Pending publication was rejected before any network request.
- Browser: local memory-only server at `127.0.0.1:3214`, no production database credentials. A successful assignment response was deliberately dropped after the server saved it. The form displayed an actionable retry message, retained its values, and retry produced one new assignment, not two. Network interception was then removed.
- Browser, stable production build: the admin overview counted 27 sessions, nine complete, and seven unclaimed. Activity loaded 25 then 27 unique sessions; full-scope counts did not shrink with pagination or review filters. The claimed filter selected one record; reassigning it from one professor to another succeeded and persisted after refiltering. No browser console errors were captured in this stable-build flow.
- Professor browser: the first page contained 25 sessions; loading more added the two remaining records. Filtering to colleague-claimed sessions returned the reassigned record, and opening it explicitly prohibited editing. No browser console errors were captured.

## Release preflight

Runtime commit `d2d1f5dcdc0c2bf2d48ba2b545457572839f26b6` passed [CI run 36738495228](https://github.com/Hongyu1231/socratic-digital-twin/actions/runs/36738495228): application verification, all migrations, 139 pgTAP assertions across eight files, private-media regression and isolated multi-connection checks. The concurrency script in this exact commit includes two simultaneous session-start RPC calls and checks one session, state and opening message.

Migration `20260930145643_session_start_idempotency.sql` was then applied to the verified tutor project. The dry run and apply contained no seed, role reset or other pending migration. Read-only production verification returned 13 cases, 18 sessions and 15 assignments, unchanged from preflight; the new page RPC and rollup both counted 18 sessions. Anonymous session-RPC execution and authenticated staff-RPC execution were denied. The security advisor reported no warning/error issues before application rollout.

No production E2E fixtures were seeded and no learning data was deleted. The clinical draft remains private and pending faculty approval; this deployment does not publish it.
