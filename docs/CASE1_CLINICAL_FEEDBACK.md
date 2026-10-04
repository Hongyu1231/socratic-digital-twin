# Case 1 clinical feedback implementation

Source: Jessica's case-specific answers in [the Case 1 review document](https://docs.google.com/document/d/14EGCadZQaW2hoZEW4u3D_Vz1QTWyhAv5Xc7cXuZmvLA/edit), plus her subsequent clarification of localisation, required versus bonus points, movement sequencing and crown orientation. These are teaching-case rules, not general patient-treatment recommendations.

The new profile is an application-authored revision for clinician review. It does not confer clinical approval on the whole case pack or automatically change production cases.

## Implemented rules

- Phase 1 uses OPG, anterior occlusal records and clinical palpation for provisional buccal/palatal localisation. All non-CBCT records and palpation are released in Phase 1; CBCT is released in Phase 2 for confirmation.
- One justified extraction plan must address both arches. The permitted #23/#24 and first/second-premolar variations are retained. A second alternative plan is optional.
- Parallax, third-molar discussion and not bonding #22 while #23 remains impacted are `acceptedExtras`, never required rubric items.
- When retaining #23, assess movement before committing to or extracting #24. Creating space by extracting #24 is not required before that test. No movement can support the remove-#23/retain-#24 fallback.
- Palatal location and crown rotation are separate findings; a palatal canine can still have its buccal surface facing buccally and be unrotated.

`scripts/case1_clinical_feedback.py` supplies six case-specific phases with a no-progress limit of 2 and an answer ceiling of 5, followed by the existing supported-application exit. The generic Case 2/3 templates are unchanged.

## Engine and persistence contract

`acceptedExtras` is optional, defaulting to an empty list. Extra IDs must be unique and disjoint from required criterion IDs. Model prompts can acknowledge extras but cannot target or award them as required criteria. Extra metadata survives local/hosted pack parsing, admin clone/save and Supabase JSONB phase metadata. It is excluded from the student DTO.

`answerCriterionId` tags the required reasoning addressed by the current answer; `targetCriterionId` still tags the next question. Unknown or bonus IDs are sanitized to null without changing the answer's classification. In a phase with extras, quality-label improvement resets no-progress only with a valid required answer tag. New required criterion evidence remains progress independently of this annotation. Missing extras never block completion, and extra-only answers cannot postpone support indefinitely.

No migration is required: existing phase metadata and evaluation criteria JSONB store the new fields. No Help-turn, authentication or scoring redesign is included in this change.

## Prepare and check privately

Select the Case 1 ID from the source manifest by its `sourceDocument`, not by a hard-coded runtime UUID:

```text
python scripts/prepare-clinical-review.py --source <private-pack> --output <new-private-directory> --case-id <source-case-1-id> --case1-feedback
node scripts/publish-teaching-materials.mjs --materials-dir <new-private-directory>
```

Preparation emits only Case 1 and its registered media, filters case-scoped references, copies media with hash verification and leaves the source pack unchanged. The publication command above is a dry run: no upload or database write. The new clinical-review record remains pending and receives a fresh content hash; publishing requires explicit, non-stale approval. Do not reuse an old approval hash.

Regression checks:

```text
npm test
npm run typecheck
npm run lint
npm run build
python scripts/test_prepare_clinical_review.py
python scripts/test_case1_clinical_feedback.py
```

For browser review, use the existing `dev-materials` helper with the new private pack and `TUTOR_PROVIDER=deterministic`. This forces the memory repository and cannot write production learning records. It verifies rendering, media unlocks and bounded support, not live LLM clinical judgement. Live-provider acceptance must be checked separately before claiming that model grading passes.

## Local verification on 2026-10-04

- Vitest: 69 files / 388 tests passed. Four opt-in integration suites / 14 tests were skipped; no new live database integration claim is made.
- Python synthetic importer, interview, review-selection and Case 1 profile suites: 23 tests passed with the bundled Python runtime.
- TypeScript, ESLint and production build passed.
- A Case 1-only revision was prepared from the existing private expert-panel pack: one case, seven teaching images, 21 reference sources; source files were not changed. Publisher dry run reported no writes and pending clinical review.
- Chrome at the isolated memory-backed local server: began Case 1, observed six non-CBCT records and palatal palpation in Phase 1, opened an OPG successfully, submitted five answers through bounded support, entered Phase 2 with a support-completion notice, then opened the newly released CBCT successfully. Both images had nonzero natural widths; captured browser warning/error logs were empty. This was an offline tutor check, not live-provider grading acceptance.

The release-candidate pack remains private under `work/case1-clinical-feedback-2026-10-04-release-candidate`; neither it nor patient images are committed to Git. Production teaching content has not been replaced.
