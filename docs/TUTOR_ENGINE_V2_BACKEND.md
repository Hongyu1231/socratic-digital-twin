# Tutor engine v2: backend implementation and handoff

Implementation date: 2026-09-29. Branch: `feature/tutor-engine-v2`.

This is a backward-compatible implementation of the backend portion discussed in PR #2. It does not merge that draft specification, replace Arshin's frontend work or author the Case 1 clinical criteria. It carries forward pre-existing local changes without reverting them. The implementation is committed on the functional branch above, including the security updates already merged into `master`. Production promotion is gated on the release checks below; pushing this feature branch alone is not a production deployment.

## Engine contract

- `CasePhase.rubric` accepts legacy strings or `{ id, text, revealText? }`. New content should use stable clinician-authored IDs. Legacy strings get positional `r1`, `r2`, etc.; these are a compatibility bridge, not durable authoring IDs.
- Criterion IDs are unique within a phase, including collisions with generated legacy IDs. Scripted `targetCriterionId` must belong to that phase. Case phase IDs are unique when supplied; phases must appear in order, consecutive from 1, so saving cannot silently change unlock semantics.
- Provider output includes nullable `acknowledgement` and `targetCriterionId`, plus `criteriaMet: { id, evidence }[]`. Evidence is a short, bounded quote retained for professor review and is not verified against the answer. Semantic membership is checked after parsing: unknown tags are untagged/dropped without discarding the grade. Criterion evidence is independent from the classification quality label, so a wrong, vague or partial answer may still contribute a directly supported criterion. Historical persisted `string[]` rows remain readable without fabricated evidence.
- Acknowledgement is one grounded sentence, no question mark, at most 200 characters. It is persisted separately **and included in `message.content` for the current UI**. New UI must not prepend it again.
- Per-phase progress tracks criteria, best classification, no-progress count and support level. Defaults: `noProgressLimit = 2`, `phaseCeiling = 8`; allowed overrides are 1–4 and 2–12 respectively. A classification improvement or new criterion resets the no-progress counter; oscillating back to a previous best does not.
- Advancement requires all criteria accumulated across turns, without a `correct`-classification gate and without a blocking scripted move. Classification remains a per-answer quality label used by the no-progress counter, correction policy and scoring. Legacy adapters without tags retain their old correct-answer completion rule only for all-string rubrics.
- No progress escalates to a hypothetical, then an explicit review point/application question. The review point uses clinician-provided `revealText`, falling back to criterion text; it does not invent a patient finding. The ceiling also forces this review step. The learner must answer once more before supported advancement. Supported advancement never changes the answer's classification or clears unresolved phase evidence.
- Exact-repeat detection strips stored acknowledgement/correction prefixes and applies to both model and scripted proposals. The ladder/ceiling bounds semantically repeated questions that exact matching cannot detect.
- `correctionProbes?: 1 | 2` defaults to 1. A further consecutive wrong answer with confidence at least 0.85, after the configured number of high-confidence wrong turns in the same phase, receives an explicit correction. Partial, vague, low-confidence wrong and reflection turns never trigger it. It does not depend on an LLM reusing the same misconception key.
- Completing the last teaching phase always asks a separate final reflection. A valid reflection answer completes without a model/classification gate; it is marked `isReflection`, excluded from the reasoning score and persisted with a null database evaluation score. Reflection state is not inferred from wording in a starter question.
- Supported phase orders are retained in `summary.supportedPhases`; deterministic narrative distinguishes assistance from independent mastery. AI summary enhancement cannot remove that caveat.

## Student response and frontend handoff

The server-side `SessionBundle` remains the internal contract. Student API responses use a separate allowlisted `StudentSessionBundle`; consumers must not rely on learner state or grading internals. Display metadata:

| Field | Meaning |
| --- | --- |
| `message.acknowledgement` | Also already present in `content`; do not render twice |
| `message.moveType` | question, hypothetical, reveal, correction, transition or reflection |
| `case.phases[].phaseProgress.criteriaMet` | Count only, never private criterion IDs |
| `case.phases[].phaseProgress.criteriaTotal` | Total criterion count |
| `case.phases[].phaseProgress.completedWithSupport` | Pedagogical progression, not mastery |
| `case.findings[]` | Only findings unlocked at the current session phase |
| `case.attachments[].expiresAt` | ISO timestamp for signed URLs; absent for legacy URLs |

Student responses omit grading evaluations, private rubrics, scripted moves and their IDs, learner state, internal phase evidence/progress, retrieval traces, and raw storage-key fields. Catalogue responses contain no attachment/finding references. Explicit allowlists and sentinel tests prevent new internal fields from leaking through object spreads.

The 2026-09-30 integration adds progress/support UI, signed-URL refresh/retry, object-rubric editor preservation and ungraded reflection in professor views. Clinical relevance of actual criteria/reveal text still needs faculty review. The model receives attachment descriptions/released findings and references, not image pixels. See `CASE_INTEGRITY_VERIFICATION_2026-09-30.md` for current evidence; older results below are historical.

## Durable turn idempotency

`POST /api/session/message` continues to accept optional `clientRequestId`. Clients should supply one stable key per submitted answer and reuse it on retry; an edited answer needs a new key.

Migration: `supabase/migrations/20260929184945_tutor_turn_idempotency.sql`.

- Adds `messages.client_request_id` and a partial unique index per session.
- New 21-argument `commit_tutor_turn` has **no default arguments**. Existing 18-argument callers retain the original signature/defaults through a wrapper, avoiding ambiguous overload resolution.
- Both signatures are service-role-only. Under a session row lock, the RPC checks ownership and a prior committed key before active/paused/version checks. Turn messages, evaluation, learner state and session update remain one transaction.
- Application lookup runs after ownership validation and before model/retrieval work, including for a completed or paused session. A repeated key with changed content returns 409.
- Replay returns the latest authorized session bundle containing the originally committed pair, not a byte-identical historical snapshot. This prevents a late retry from rolling the client's state backward.
- The memory adapter has the same contract. Simultaneous requests may still duplicate model work before either commits; the database arbitrates persistence. This is not an exactly-once external LLM invocation guarantee.

Apply the backward-compatible migration before deploying the new repository, which sends all 21 arguments. No automatic fallback should write through the old RPC if the new migration is missing.

## Findings, private media and publication

Case inputs accept `findings: { id, title, text, unlockPhase, unlockOnRequest?: false }[]`; attachments accept `storagePath`, `unlockPhase` and `unlockOnRequest?: false`. Both are validated and persisted; unlock phases must exist. On-request unlocking is intentionally not implemented.

Private media uses only the fixed `teaching-case-media-private` bucket. Object keys must be safe slash-separated segments, never arbitrary URLs. Server-only service-role signing produces one-hour URLs after session ownership, attachment membership and phase-unlock checks. The refresh endpoint is:

```text
GET /api/session/{sessionId}/attachments/{attachmentId}/url
200 { attachmentId, url, expiresAt }
```

Wrong owner/role is denied; locked/missing attachments return 404; unavailable signing returns a safe 503. Responses are `private, no-store`. Student session responses sign unlocked attachments in parallel, bounded to 12 attachments. Each Storage network request has a five-second abort deadline. A signing failure retains safe attachment metadata without URL so the UI can offer a retry. Transcript-only audio remains supported.

The refresh route accepts the owning student, a professor who is a member of the session's class, or an admin. It verifies that the requested attachment belongs to the session's exact `caseId` and returns the same 404 for locked and missing attachments. Student, professor and admin session reads all sign only attachments unlocked at that session's current phase. Neither path serializes a separate raw `storagePath`. The authorization matrix is covered by tests; live unsigned denial, signed read, expiry at origin and refreshed read were verified on 2026-09-30.

`scripts/publish-teaching-materials.mjs` now defaults to private-bucket publication; `--private-media` remains compatible. Existing external teaching URLs remain supported. The reviewed copy helper and migration `20260930140812_private_case_media_cutover.sql` moved all 19 managed media references to private storage on 2026-09-30. The old bucket is also private, with original files retained. Signed URLs are bearer links usable until expiry, and a path is visible inside a signed URL. Bucket privacy cannot revoke previously downloaded or cached copies.

Private storage alone does not make this demo suitable for patient records. The POC still permits public role selection and serves only synthetic/resettable or appropriately authorized teaching material. Real IRB images require real authentication, access controls and an approved handling workflow before upload.

## Retrieval audit

Evaluations retain the retrieval query and the selected passages' source ID, page, optional paragraph locator and actual ranking score. No retrieved passage text or expert note is added to the trace or student response. The query contains learner text and should be treated as learner data. No additional trace/index tables or production data backfill are needed for this JSON metadata.

## Historical verification checkpoints

The following 2026-09-29 numbers are historical. Current release evidence, 344 application tests, 119 database assertions, production migration results and remaining browser/clinical limits are in `CASE_INTEGRITY_VERIFICATION_2026-09-30.md`.

Release-candidate local checks: **247 tests passed, 13 opt-in live tests skipped** (45 passing files, 3 skipped); TypeScript, ESLint, production build and `git diff --check` passed. Dependency installation/audit reports zero vulnerabilities. The opt-in synthetic OpenAI smoke test was separately enabled and passed; default skipped tests are not counted as passed.

Tests cover explicit/legacy rubric contracts, real OpenAI JSON-schema serialization, criteria accumulation and wrong-answer correction, repeated questions, support/ceiling exits, reflection, correction confidence gating, replay/changed payload/ownership, repository metadata mapping, media phase/ownership checks, signing failure and deadlines, retrieval traces, and summary support preservation.

Browser verification uses local `127.0.0.1:3210`, memory storage and the deterministic tutor, not production. The verified story is: student case → message API → memory repository → support escalation → supported transition → final reflection → deterministic summary UI.

| Boundary | Evidence from 2026-09-29 local run |
| --- | --- |
| UI entry | Home and case session render; no framework error overlay/browser exceptions |
| UI → API | Answers sent with the actual composer; message requests returned 200 |
| API → memory → response | Phase 1 escalated to hypothetical then reveal; subsequent application advanced to phase 2 with support flag and zero criterion credit |
| Reflection → completion | Uncertain reflection answer completed all five phases; summary page opened automatically |
| Response → UI | Summary showed supported phase 1, unresolved gap and a score of 50, not automatic full credit |
| Completed-request retry | Same key/content returned 200 with identical last-message ID/count; changed content returned 409 |
| Performance observation | Local deterministic message requests were 8–21 ms; this is **not** a production/LLM latency claim |

Local screenshots are under `output/backend-v2-*.png` (not for production publication). The first screenshot run predates only the final punctuation/singular-plural cleanup and media-signing timeout hardening; core flow behavior is unchanged.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. Opt-in live model/hosted-material tests are skipped by default; do not count them as passed. The new pgTAP test lives in `supabase/tests/database/tutor_turn_idempotency.test.sql`.

Additional release smoke: the production build ran locally with memory storage and the real OpenAI provider. A synthetic student answer returned a grounded acknowledgement and follow-up in approximately 7 seconds, without fallback; ending the session opened a deterministic summary with the incomplete-session caveat. There were no browser exceptions. The first attempt exposed a stale local proxy (`127.0.0.1:7890`); the successful test disabled that proxy only in its process environment, without changing application proxy behavior or `.env.local`.

Local PostgreSQL verification is blocked by Docker Desktop's locked runtime socket, so the feature branch also runs the existing GitHub Actions application and isolated-database jobs. [Release CI run 36622560445](https://github.com/Hongyu1231/socratic-digital-twin/actions/runs/36622560445), at commit `7e02c02`, passed both jobs: all migrations applied, all **55 pgTAP assertions across three files passed**, and application/worker/importer checks passed. The first run exposed an incomplete test fixture (missing required assignment), not a migration failure; the corrected fixture preserves all 15 idempotency assertions. Do not run database fixture tests or E2E writes against production.

**2026-09-30 update:** isolated CI passed all publication, concurrent assignment, turn-idempotency and media-cutover regressions. The integrity/publication migrations and application were deployed, followed by verified private-media copying, transactional metadata cutover and removal of anonymous access to the old bucket. All 19 signed images read successfully; all 57 final unsigned checks were denied. The offline retrieval comparison harness preserves the online baseline pending faculty-labelled evidence. Faculty rubric/reveal-text approval and production browser acceptance remain external/pending; no patient media was uploaded.

The existing summary-worker deployment from 2026-09-29 remains unchanged. The 2026-09-30 release added six forward migrations to the same `zulvdacbqvmqmtotyeuc` project without resetting, seeding, reimporting clinical content or deleting sessions. Original media and session history were retained. Future clinical content still needs faculty approval, and real patient media still requires real authentication and an approved handling workflow.
