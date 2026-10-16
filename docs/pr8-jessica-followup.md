# PR 8: Jessica feedback follow-up

Date: 16 October 2026. Base: PR 8 `bb889ed`; branch: `feature/case1-jessica-followup`.

This is a technical acceptance/handoff, not clinical sign-off. PR 8 remains unmerged and no teaching material is published by this change.

## Implemented decisions

| Point | Required reasoning | Optional bonus |
| --- | --- | --- |
| 5.3 | Name the other three acceptable premolar extractions in an otherwise justified plan for both arches. First or second premolars are accepted. | Explain why first rather than second premolars were selected, or vice versa. |
| 6.4 | None: absence of this point must not prevent completion. | The existing authored minimal-overbite risks/mechanics, retained in `acceptedExtras` rather than discarded. |
| Phase 6 | Practical execution challenge linked to the case; an appropriate reassessment checkpoint for the chosen branch; an execution uncertainty/trade-off. | Overbite discussion is acknowledged but not demanded or targeted as a missing requirement. |

The existing criterion IDs remain stable. `p6-overbite-control` is now an extra, not a required criterion. The legacy ID `p6-anticipated-outcome` is retained for compatibility, but its marking text concerns carrying out the plan, not final tooth positions. A direct remove-#23/retain-#24 plan does not require a test of retaining #23. The alternative retention branch keeps its existing movement-before-#24 checkpoint.

## Phase 1: evidence and unresolved wording

Read-only checks of the correct production project showed:

- Active Case 1 v1 (`6adeed78-e517-5f94-bc84-586ad15392fd`) has no released Phase 1 finding entries.
- Draft v5 (`636de74f-a99e-5bb6-a37d-205e23ea884a`) includes the Phase 1 finding: “A canine bulge is palpable on the palatal aspect of the #23 region.”
- The draft generator adds this explicitly at `unlockPhase: 1`. The student DTO includes released findings; the resource panel renders them under **Released clinical findings**. These are information supplied to the student, not a message to the patient and not faculty-only marking notes.
- Browser verification of the new private candidate confirmed the exact finding is visible at Phase 1, while the Phase 2 CBCT is hidden. OPG preview loaded successfully.

Do not tell Jessica that the current production v1 already shows the finding. Do not interpret her conditional question as approval of a confirmed palpation result. Keep the existing draft wording unchanged until she confirms whether palpability is intended to be supplied as a confirmed finding or left unconfirmed. If changed, update both the released finding and the matching Phase 1/2 teaching rules together, regenerate a new content hash, and retest.

Suggested clarification:

> By “available finding” we mean information shown to the student. We checked: the current live v1 has no Phase 1 palpation finding, but the proposed new draft explicitly supplies a palpable palatal bulge. Are you happy for that to be given as a confirmed examination finding, or should the new case leave palpation unconfirmed?

## Technical verification

- TypeScript suite: 540 passed, zero failed; 56 skipped locally (35 opt-in/external tests plus 13 PR7 and 8 PR8 ignored operator-harness tests). Skips are not passes.
- TypeScript, ESLint, production build and whitespace checks passed.
- Python: 19 Case 1 profile tests and six clinical-review preparation tests passed.
- New committed regressions cover student finding release/privacy, later-phase finding gating, required-only Phase 6 completion, filtering a formerly-required bonus ID, and bonus-only answers not postponing support.
- Explicit live acceptance: eight scenarios passed, including seven actual OpenAI calls with no fallback. Four complete required-answer scenarios cover retention/removal branches without the optional extras, one bonus-only answer remains incomplete, and both Phase 6 Help levels target required points and satisfy 40/60-word caps. The eighth scenario checks the student DTO boundary, not the model.
- Full local six-phase HTTP flow passed using synthetic instructor-oracle answers. All six evaluations used OpenAI with no fallback and took approximately 5.1–8.5 seconds each; this is not a production p95 or evidence of actual student performance.
- Browser: start case, Phase 1 findings/media, final reflection, immediate summary and professor completion display passed. Reflection remained ungraded; six required-answer evaluations and one ungraded reflection were stored. Phase 6 completed with three required criteria and no overbite criterion. The browser console contained no errors/warnings during this local workflow.

## Private review candidate / release hold

- Directory: `work/case1-pr8-jessica-2026-10-16`
- Case ID/version: `91d2c1cf-4ba8-5abb-b420-feb0e7dbc197`, v6
- Package ID: `cebcf373c268a8ad9bb27080589f36c51856d2f1a197f237d5cfb21310202384`
- Clinical content hash: `cbeb8cc4c4c92966cd6fdbf5dfbfe5a469edbff1e08d030bb0c569508aa638cb`
- Review status: pending. Seven media files and 21 references copied locally; nothing uploaded or assigned.
- Evidence: ignored `work/pr8-*-results.json`, `work/pr8-production-findings.json` and `output/playwright/pr8-*.png`.

The temporary memory repository exposes the selected private draft only for local testing. It does not approve or publish the production case. Production data was read-only in this task. No master push, production deployment, assignment migration or existing-session reset is authorized by a passing technical test. After the palpation clarification and final revised marking-point check, incorporate the follow-up into PR 8, rerun CI and publish only the specifically approved content version.
