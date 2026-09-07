# Local teaching materials

The importer prepares DOCX case descriptions, case images and PDF literature for
local tutor testing. This is retrieval at question time, not model fine-tuning.
The original archives and their extracted content stay in an ignored local
directory. The public demo and Supabase teaching data do not load this pack.

## Import and run

Python dependencies: `python-docx`, `pdfplumber`, `Pillow`.

```powershell
python -m pip install -r scripts/requirements-materials.txt
python scripts/import-teaching-materials.py --cases "PATH/Impacted canine cases.zip" --articles "PATH/Impacted canine articles.zip" --output work/teaching-materials
npm run dev:materials
```

Open `http://127.0.0.1:3100`. A different pack directory or port can be passed:

```powershell
npm run dev:materials -- "D:/private/teaching-materials" 3101
```

If a configured proxy is unavailable and direct OpenAI access works, use
`npm run dev:materials -- --direct`. This explicitly bypasses proxy settings
for the local child process only; it does not edit `.env.local`.

The launcher reads `.env.local`, forces the in-memory repository and binds only
to loopback. It respects `TUTOR_PROVIDER`; if unset it uses OpenAI when its
key/model pair exists, otherwise the deterministic provider. With a live
provider, selected case background, literature excerpts and learner answers are
sent to that configured provider. The original images and full PDFs are not
sent to the model. The OpenAI tutor requests `store: false`.

Private-pack turns bypass persisted experiment/shadow logging and candidate
models. Interactive provider requests use a 25-second timeout with no automatic
SDK retries; provider failures use the existing, clearly labelled deterministic
fallback. The chat request also has a 45-second network deadline and retains
failed messages for retry with the same idempotency key.

Sessions in this local mode reset when the server process restarts. The material
pack is reproducible and survives restarts. Restart after replacing a pack,
because the validated manifest is cached for the process lifetime.

## What the tutor receives

- The DOCX student introduction becomes the case description.
- The DOCX expert summary stays in a server-only field, outside `ClinicalCase`
  and student API responses. It is supplied only to the tutor reference context.
- Student APIs also omit internal tutor guidance and scripted answer matchers;
  grading rubrics and future starter/example questions are returned empty.
- Each PDF retains its filename, content hash, title and PDF page number. The
  retriever selects up to four relevant passages, at most two per source and
  6,000 text characters in total. Titles are taken from the supplied filenames;
  page numbers are PDF page indices, not journal pagination.
- References are quoted data. Neither a student answer nor a document can
  supply system instructions. Literature case reports must not be treated as
  facts about the active patient or universal treatment recommendations.
- Each imported case gets an application-authored six-phase reasoning scaffold.
  The supplied DOCX files do not contain complete phase-by-phase marking rubrics;
  faculty should review the scaffold before using it for assessment.

Images are displayed to the learner through a local allowlisted route. They keep
their original dimensions and use lossless WebP compression. No crop, annotation,
or diagnostic image change is applied. Embedded file metadata is stripped; this
does **not** remove patient details burned into the pixels. Image titles describe
the supplied modality and do not invent findings. The text tutor uses expert
notes and learner observations; it must not claim to have inspected image pixels.

## Verification

See [the recorded local validation](TEACHING_MATERIALS_VALIDATION.md) for the
import counts, real-model checks, browser flows and measured timings.

```powershell
python scripts/test_import_teaching_materials.py
npm test
npm run typecheck
npm run lint
npm run build
```

The opt-in live tests are separate from the offline suite. Configure the existing
model key in `.env.local`, then run:

```powershell
$env:TUTOR_MATERIALS_DIR = (Resolve-Path 'work/teaching-materials').Path
$env:FORCE_MEMORY_REPOSITORY = 'true'
$env:TUTOR_PROVIDER = 'openai'
$env:RUN_MATERIALS_LIVE_TESTS = 'true'
node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/materials/live.test.ts
```

If direct access is needed for this test, set `$env:OPENAI_PROXY_URL = ''`
in PowerShell 7.5+ before launching Node, or clear the unavailable proxy for the
test process only. Never commit credentials or include them in test reports.

Live tests require a real model response; a deterministic fallback is not counted
as a grounding pass. They are a small regression sample, not clinical validation.
The normal offline suite skips live tests and does not use model credentials.

Browser checks: open each case, open its OPG, zoom and reset, close with Escape,
submit an answer, pause/resume and finish to summary. On a narrow mobile viewport,
open the Case drawer and confirm the composer remains visible. Confirm the
catalogue/session JSON contains no `expertNotes`, `sourceDocument` or literature
excerpts, and that `/api/materials/<id>` serves only registered media.

## Publication boundary

The existing public POC exposes seeded demo roles. Therefore the private pack is
disabled on Vercel and whenever the repository is not forced to memory. Keep
`TUTOR_MATERIALS_DIR` unset on the public site. Do not copy these records, PDFs or
the manifest into `public/`, migrations, seed data or Git. Publishing the supplied
records requires a separate decision about permitted access and source rights.
