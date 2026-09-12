# Expert interview import validation

Validation date: 2026-09-12

The private importer processed the following source document:

- `Impacted maxillary canines - interviews with the expert panel.docx`
- SHA-256: `ce6b21e79916d9f1caec0f3d64d0ba1194c9f338a7f905729e615001e4069ee7`

The generated private revision is identified by:

- Package ID: `642461d26512e216edc0050c0630bc0298a827891d4549f88b5fea2a24bb24b7`
- Source ID: `e7ad0dbd-b22b-5016-a62d-fc022f7185ef`

The import produced five sections and 15 expert blocks. These blocks represent
three unique expert labels (`Expert 1`, `Expert 2`, and `Expert 3`) repeated
across the sections; they are not 15 distinct people. The source contains 158
nonblank paragraphs, including section and expert headings, and all 158 are
represented in chunk provenance. The resulting expert-interview article has 54
bounded chunks.

Chunk counts by scope are:

- Case 1: 12 chunks
- Case 2: 14 chunks
- Case 3: 10 chunks
- General material: 18 chunks

The three case-scoped sections map to the existing Case 1, Case 2 and Case 3
records. General sections omit case identifiers. Each chunk retains its DOCX
paragraph range, section heading and expert label in provenance metadata.

Repeated execution with the same source and output directory returned a no-op
and did not create a duplicate source article. The importer’s five synthetic
Python tests passed, covering section/expert parsing, case scoping, source
deduplication, large-text chunking and coverage, unsafe paths and overwrite
protection, and ignored external DOCX relationships.

The original DOCX and extracted source text remain in private local directories
and are not included in Git. The imported material is retrieval context, not
model training. Interview statements remain attributed viewpoints and must not
be treated as consensus. Document text is data for retrieval, not system
instructions.

## Hosted knowledge-base verification

The authorized upload staged three draft cases, 19 registered WebP images and
21 reference sources (20 published articles plus this interview). Reference
text lives in the private `teaching-material-references` bucket; only the
registered case images live in the public `teaching-case-media` bucket.
Original DOCX/PDF/ZIP files and the generated manifest are not committed.

The six opt-in hosted tests passed on 2026-09-12. They read the cloud cases and
private manifest, but keep all test sessions, answers and summaries in memory:

- Three real OpenAI tutor turns completed in 5,596, 4,808 and 4,571 ms. Each
  received four reference passages; a deterministic fallback was not accepted.
- Local completion of those sessions returned nonempty deterministic summaries
  in under one second, without waiting for another model call.
- All 19 public image downloads matched their registered SHA-256 digests.
- An unauthenticated public URL could not fetch the private reference manifest.
- The Case 3 interview query returned Expert 3 and Expert 2 with paragraph
  locators 137-138 and 117-118 respectively. A real tutor turn also received
  attributed interview passages and returned an OpenAI evaluation.
- Student payloads omitted private material fields and a genuinely private
  faculty-note excerpt, excluding text already present in the public introduction.

The first cloud run caught a retrieval issue: longer general literature pages
could occupy all four reference slots. The retriever now reserves up to two
slots for query-matching, current-case interview passages from distinct experts.
It still enforces case isolation and the four-passage/6,000-character budget;
unmatched passages are not forced into the result. Synthetic regressions cover
crowded results and queries without an interview match.

A first image-validation run encountered a network timeout. Subsequent
individual reads returned HTTP 200 for all 19 images, and the unchanged bounded
hash-check test passed on rerun. Browser verification also displayed the uploaded
Case 3 OPG at its original 2262 x 1040 pixel dimensions. These are functional
checks, not clinical validation of the supplied material or a production p95 SLO.

The offline TypeScript suite passed 166 tests; both Python importer suites passed
five tests each. Type checking, lint and the production build are release gates.
The live suites remain explicit opt-in tests and are skipped by ordinary CI.
