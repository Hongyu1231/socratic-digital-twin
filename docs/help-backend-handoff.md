# Help backend and PR 6 acceptance handoff

Date: 10 October 2026. Branch: `feature/help-turns-wording`, based on PR 6 commit `9350a5c`.

## Release status

The Help implementation and PR 6 wording changes were released directly to `master` as code commit `de3bbb5` on 10 October. GitHub CI passed both verification and database jobs, and Vercel production deployment `dpl_CBqpVsNe6qPumjwVN37YvbnNbPst` reached READY with the production alias on that exact commit. PR 6 is merged; no additional PR was created. The backward-compatible Help migration was applied before the application deployment; all three RPC overload/helper grants were verified as service-role-only and SECURITY INVOKER. The summary worker was separately redeployed as active version 8 with its existing authentication retained; an unauthenticated POST returned 401. This is not clinical approval of the private Case 1 candidate.

Production smoke checks used the existing password gate and demo identities. Student case listing, an existing active session, an existing summary, the professor dashboard/review transcript, and admin overview/cases/activity rendered successfully. The browser console reported zero errors and warnings. One `/api/cases` request returned 200 in approximately 646 ms; this is not a p95 measurement. No review was claimed/saved and no learning/test rows or case publications were created: sessions remained at 18 (six completed), and Help message rows remained at zero. Existing historical transcripts and stored summaries were not rewritten or treated as clinical approval. The last three observed Cron dispatches succeeded, the summary queue had six completed jobs and no pending/failed jobs, and Vercel returned no error/fatal logs in the 15-minute window ending at 09:35 UTC. These are bounded smoke observations, not a guarantee of future model output or worker completion latency.

The student More help button and the professor's ungraded chronological Help timeline are now implemented on this branch. The student retains their answer draft, sees server-derived availability, and reuses the same request ID for an unresolved retry, including when clicking the main Help button again. A synchronous in-flight guard prevents double clicks. Staff Help rows have no grading or tutor-quality controls and do not imply that a reveal alone completed a phase. Legacy answers and final reflection remain visible. Stale reflection flags on non-final phases do not block Help. Actual support-generator/fallback provenance is persisted on the tutor message so reloads and retries cannot mislabel fallback prose as a live-model response.

Section 3.5's acknowledgement repair is also implemented for OpenAI and Claude. A missing or structurally invalid acknowledgement causes at most one repair call within the remaining provider budget. Only a valid acknowledgement is taken from the repair response; the first classification, evidence and question remain authoritative. A failed, invalid or budget-exhausted repair sends the question alone. The wording checks are not a semantic clinical-grounding guarantee.

## Frontend contract

The existing `POST /api/session/message` endpoint accepts either an answer or Help, never both:

```json
{
  "sessionId": "<session UUID>",
  "helpRequested": true,
  "clientRequestId": "<stable request ID, 8–100 characters>"
}
```

Do not send `message` with Help, including an empty string. Keep the same request ID when retrying the same press; generate a new ID only for a new press. Answer requests retain their existing shape.

`session.canRequestHelp` is computed by the server. It is false before the first evaluated answer in the current phase, at support level 2, while paused/completed, and on final reflection. The server independently enforces the same rule; the flag is not client authorization.

An eligible press raises support by one and resets `noProgressCount` to zero:

- Level 1: an ungraded, model-written hypothetical to critique. If unavailable or rejected by output checks, return `503` with `HELP_GENERATION_RETRYABLE`, save nothing, and allow the same ID to be retried.
- Level 2: an authorized plain reveal plus application question. A safe criterion-based fallback is available if generation fails. Set `awaitingApplication` and the support provenance; do not advance the phase until an application answer arrives.

Disallowed new presses return the current session unchanged, with no model call or new rows. Committed retries are checked before status/eligibility, so retrying after advancement or completion cannot raise support twice. Reusing an ID for a different operation/content is a conflict.

## Persistence and scoring

Help is one atomic transaction containing a student marker, paired tutor reply, and one state-version increment. It creates **no evaluation row**. It does not change answer attempts, criteria evidence, best classification, mastery, score inputs, learner strengths/weaknesses, or correction history.

Messages carry `turnKind`, `helpRequested`, `phaseOrder`, `supportLevel`, and `completedWithSupport`. Metadata, not the literal marker text, identifies Help. An ordinary answer containing `Requested more help` remains a graded answer.

The student DTO exposes only the permitted message fields and availability flag; grading/retrieval internals remain staff-only. Staff API readers receive chronological messages with phase/support snapshots. Frontend Help rows must not require an evaluation or offer an answer-grade control.

Help markers are excluded from answer-based retrieval text, experiment answer projections, and evaluation datasets. The transcript and support provenance remain available for review. Summary completion counts only phases whose application/completion actually occurred; showing a reveal and stopping early is not completed learning.

Apply `supabase/migrations/20261009144828_help_turn_persistence.sql` before deploying its repository caller. Both the previous 21-argument answer RPC and its 18-argument compatibility wrapper remain usable. Help uses nullable evaluation arguments. RPC execution remains restricted to `service_role`; the function is `SECURITY INVOKER`.

## Latency and generation boundaries

The normal-answer and explicit-Help paths share a 35-second provider budget, with each provider call capped at 25 seconds and no SDK retries. Remaining time is recomputed before support/candidate generation; less than one second skips that call. This leaves headroom below the browser's 45-second deadline. It is a provider-call budget, not an absolute bound on database/retrieval latency.

Support has a separate strict output schema with no classification, score, or memory patch. Validation checks the requested target/level, bounded length, one question, obvious internal-label leakage, repeated questions, and a critique-oriented level-1 question. These checks do **not** establish clinical truth, semantic non-leadingness, or universal absence of answer leakage. Faculty must review the actual texts before publication.

## Case 1 correction and private candidate

The real model initially marked a justified direct remove-#23/retain-#24 two-arch plan as partial because it demanded comparison with another plan. Faculty-only guidance now makes that second option explicitly optional. The movement-before-#24 criterion applies only when retaining #23; it is N/A/satisfied in the direct-removal branch. Student-facing PR 6 titles, goals, openings, palatal guidance, and reveal wording were preserved.

Regenerated private candidate:

- Directory: `work/case1-clinical-feedback-2026-10-09-pr6-applicability-v3`
- Package ID: `46ffce78914e5e6f8354029ecf0047042826e9e6929a69bb6b7b3ee24b894c31`
- Clinical content hash: `5277d98ca6731373fa604acade187d06b6bd807edebee08b001383a44b4417d0`
- Clinical review: `pending`, same lineage/version 4, seven byte-identical media files.

This candidate needs fresh clinical approval. It was tested only in local memory and was not uploaded or published. It must not replace the existing approved production pack yet.

## Verification evidence

- Automated TypeScript suite: 480 passed, 35 skipped; opt-in/external suites are reported separately, not counted as passed when skipped. The live checks below were run explicitly.
- TypeScript, ESLint, production build, and diff whitespace checks: passed.
- Python Case 1 and preparation suites: 19 passed.
- Supabase Postgres: all migrations applied to a disposable local container; official CLI pgTAP runner passed 9 files / 163 assertions. An intentionally failing temporary probe correctly returned failure. Advisors reported no issues at warning/error level. Concurrent duplicate Help commits produced exactly two messages, zero evaluations, and one version increment.
- Real OpenAI model: seven clinical scenarios, twelve phase/level support scenarios, one automatic step-up scenario, and one summary-worker prose scenario passed. No deterministic fallback was counted as a live-model pass.
- Full six-phase local HTTP workflow used synthetic instructor-oracle answers, not real student performance; every graded phase used the real model. The last reflection was submitted in the browser and completed without a grading gate.
- Fresh production-build browser pass: student start and a real OpenAI answer, both Help levels with the typed draft preserved, disabled Help after level 2, final reflection, immediate summary, chronological professor Help rows without grading controls, and admin overview passed. Separate staff API snapshots verified each Help operation added exactly two messages and one version, while evaluation count, phase, answer attempts, criteria, mastery and error history stayed unchanged. All six synthetic instructor-oracle phase answers used OpenAI without fallback, taking 5.8–9.8 seconds each; these are local observations, not a production p95 claim. Browser console reported no errors.
- Rendered React regressions now cover draft preservation, a text-free Help payload, double-click suppression, same-ID retry through both controls, replay after eligibility changes, initial/level-2 disabled states, timeout ambiguity, chronological Help rendering, and the absence of Help grading controls.
- Completed-session replay/no-op: unchanged state/evaluations/score; warm completion replay returned in approximately 170 ms. The first development request included compilation and took about 5.2 seconds. Neither is a production p95 claim.

Ignored local evidence/harnesses are under `work/`: `pr6-final-live-results.json`, `pr6-final-support-summary-results.json`, `pr6-support-visible-results-critique-final.json`, `live-automatic-support-result.json`, `pr6-summary-visible-result.json`, `local-help-http-results.json`, `local-case1-flow-results.json`, and `local-completed-replay-results.json`.

## Remaining content approval (code release complete)

1. Have Jessica review and approve the regenerated candidate's exact content hash, including the direct-removal applicability clarification and actual generated wording. Help code is already released with existing approved content unchanged.
2. Publish the candidate only after that approval, then smoke-test the newly approved content. Local tests do not replace clinical approval.

Suggested collaborator update:

> Help is implemented end to end: a tagged, ungraded message pair is saved atomically with the state update; retries use the same request ID and never create an evaluation or consume an answer attempt. The student button preserves their draft, and the professor transcript includes the ungraded Help turns. Missing/invalid acknowledgement gets one bounded repair attempt without accepting a regrade. I tested PR 6 with the real model and the private Case 1 draft, including automatic step-ups, all six phases, closure, and summary wording. I also fixed one applicability issue: a justified direct #23-removal plan no longer has to compare a second plan or perform a retention movement test. CI, the production migration, worker redeployment, application deployment and student/professor/admin read-only smoke checks are complete. The new pack remains pending fresh clinical approval and existing approved production cases are unchanged.
