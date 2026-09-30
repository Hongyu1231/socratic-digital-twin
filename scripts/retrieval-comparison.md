# Offline retrieval comparison

This harness implements the bounded comparison requested by PR #2 §3.9. For
each fixed answer it runs both queries through the current deterministic local
retriever:

- baseline: `studentAnswer + currentQuestion + phase.goal` (the query used by
  `lib/tutor/state-machine.ts`);
- criterion-focused: `studentAnswer + targetCriterion.text`.

The synthetic set is deliberately invented for engineering regression tests.
The output contains only source/page/locator/score metadata and rank metrics; it
does not print passage text, expert notes, source documents, model calls, or
private media.

Run it locally with Node's built-in TypeScript stripping and the small resolver
for the repository's `@/` aliases:

```text
node --experimental-strip-types \
  --experimental-loader ./scripts/retrieval-comparison-loader.mjs \
  ./scripts/retrieval-comparison.ts
```

Run the regression tests with:

```text
npm test -- scripts/retrieval-comparison.test.ts
```

`clinicalConclusion` is always `not-assessed`. A synthetic hit-rate or rank
difference is only an engineering candidate signal. The production query is
not changed by this harness. The report therefore emits
`retain-baseline-pending-labelled-evidence`; a switch would require a fixed
set of real, faculty-labelled answers and the manual comparison owned by Stage
C.
