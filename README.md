# Socratic Digital Twin AI Tutor

Teaching proof of concept for the NUS Faculty of Dentistry. The tutor uses progressive Socratic questions to help learners practise clinical reasoning instead of revealing an answer immediately.

The project runs without external services: it uses an in-process repository and a deterministic tutor when credentials are absent. Supabase, OpenAI, and Claude can be enabled independently through environment variables.

> **Teaching simulation only.** This POC does not contain real patient data, clinical images, or diagnostic functionality. It has no production sign-up, OAuth, or Supabase Auth flow.

## Features

- Students choose a class assignment, work through a five-phase case, and receive a formative summary.
- Case cards load with explicit skeletons, use equal-width responsive columns, and expose synthetic image/audio teaching attachments inside a session.
- Students can pause safely, return to the case list, and resume the same phase and transcript. Browser-native dictation and tutor read-aloud remain optional enhancements to text input.
- Each answer is classified as `correct`, `partial`, `vague`, or `wrong`.
- The system records reasoning gaps, strengths, weaknesses, phase mastery, and previous errors.
- Admins manage seeded users, classes, case versions, publication, and review ownership.
- Professors assign published cases, inspect complete transcripts, claim reviews, re-label answers, and rate tutor-intervention quality.
- Students see only assignments in their classes. Demo identity switching uses a signed HttpOnly cookie for a specific seeded user.
- Supabase persistence, OpenAI, and Claude each have independently testable local fallbacks.

## Documentation and links

- [Bilingual User Guide](docs/USER_GUIDE.md)
- [Bilingual Developer Guide](docs/DEVELOPER_GUIDE.md)
- [Tutor Humanization & Professor Feedback Loop](docs/HUMANIZATION_PLAN.md)

## Quick start

Requirements: Node.js 22 or newer (the supported baseline for the current OpenAI and Supabase SDKs).

```bash
npm install
```

Create a local environment file before adding credentials:

```powershell
Copy-Item .env.example .env.local
```

On macOS/Linux, use `cp .env.example .env.local` instead. Then open [http://localhost:3000](http://localhost:3000). The complete demo works with an empty `.env.local` by using memory storage and the deterministic tutor.

Start the development server:

```bash
npm run dev
```

Run the standard verification gates:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Architecture and adapter selection

The browser calls Next.js server routes; it never receives database or AI credentials. Route handlers apply the signed demo identity, role and resource authorization, shared Zod validation, the tutor state machine, and repository operations.

Database and tutor providers are selected independently:

1. `FORCE_MEMORY_REPOSITORY=true` always selects the in-memory repository.
2. Otherwise, both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` select the Supabase repository; if either is missing, memory storage is used.
3. Both `OPENAI_API_KEY` and `OPENAI_MODEL` select the OpenAI Responses API first.
4. If OpenAI is not configured, both `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` select the Claude Messages API.
5. With no complete AI pair, or when one AI request times out, is rejected, or returns invalid structured output, that request falls back to the deterministic tutor.

Session summaries use the same OpenAI-then-Claude preference and fall back to a local template. Student answers are treated as untrusted quoted data; model output is validated and only the state machine may merge its allow-listed memory patch.

### Repository layout

| Path | Responsibility |
| --- | --- |
| `app/` | App Router pages and server APIs |
| `components/site-header.tsx` | Seeded identity selector |
| `lib/domain.ts` | Domain types and scoring constants |
| `lib/schemas.ts` | Shared Zod input/output schemas |
| `lib/auth.ts` | Cookie signing, verification, and role guards |
| `lib/repository/` | Repository interface, memory adapter, and Supabase adapter |
| `lib/tutor/` | OpenAI/Claude adapters, deterministic fallback, summaries, humanization prompt, metrics, and state machine |
| `lib/**/*.test.ts` | Vitest unit and integration tests |
| `supabase/migrations/` | Versioned database schema |
| `supabase/seed.sql` | Idempotent demo fixtures |
| `Dockerfile`, `docker-compose.yml` | Production image and local Compose runtime |

## Environment variables

Start from `.env.example`. Keep secrets in `.env.local`, Vercel Environment Variables, or a secret manager; never commit them or import them into a client component.

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `DEMO_SESSION_SECRET` | Required in production; development has a safe fallback | HMAC secret for the demo identity cookie |
| `SUPABASE_URL` | Optional | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional; server-only | Supabase database key; never use a `NEXT_PUBLIC_` prefix |
| `FORCE_MEMORY_REPOSITORY` | Optional | Set to `true` to force memory mode, useful for local acceptance checks |
| `EXPERIMENT_PSEUDONYM_SECRET` | Required for production feedback datasets | Server-only HMAC secret for stable one-way evaluation pseudonyms; local demos may fall back to `DEMO_SESSION_SECRET` |
| `OPENAI_API_KEY` | Optional pair | OpenAI API key, read only on the server |
| `OPENAI_MODEL` | Optional pair | Account-available model ID that supports Structured Outputs |
| `OPENAI_PROXY_URL` | Optional | HTTP(S) proxy for the Node.js OpenAI client; standard proxy variables are also honored |
| `OPENAI_TTS_MODEL` | Optional | Tutor voice model; defaults to `gpt-4o-mini-tts` |
| `OPENAI_TTS_VOICE` | Optional | Built-in Tutor voice; defaults to `marin` |
| `ANTHROPIC_API_KEY` | Optional pair | Anthropic API key, read only on the server |
| `CLAUDE_MODEL` | Optional pair | Account-available Claude model ID that supports structured output |

## Supabase setup

Database assets are in `supabase/`:

- `migrations/20260809000000_create_socratic_digital_twin_schema.sql` creates the original nine teaching tables: `users`, `cases`, `case_phases`, `sessions`, `messages`, `evaluations`, `session_state`, `answer_reviews`, and `session_reviews`.
- `migrations/20260812000000_add_class_collaboration.sql` adds active-user flags, case lineage/versioning, `classes`, `class_memberships`, `class_case_assignments`, assignment links and uniqueness for sessions, and single-owner review constraints.
- `migrations/20260813042137_add_tutor_turn_reviews.sql` adds faculty ratings for tutor interventions (naturalness, specificity, non-leadingness, challenge fit, helpfulness, failure tags, and preferred rewrites).
- `migrations/20260813043101_restrict_rls_auto_enable.sql` removes browser-role access to the schema-maintenance helper after the Supabase security advisor identified it.
- `migrations/20260813064021_humanization_feedback_loop.sql` adds immutable de-identified datasets, prompt/model candidates, offline runs, shadow and limited A/B evidence, append-only faculty decisions, controlled releases, and rollback audit events.
- `migrations/20260813131710_add_demo_clinical_cases.sql` adds three text-only, five-phase clinical reasoning simulations and opens them for the default demo class.
- `seed.sql` contains deterministic, idempotent fixtures.
- `config.toml` enables the seed file for Supabase CLI workflows.

All exposed public tables, including `tutor_turn_reviews`, enable RLS. Direct table privileges are revoked from `public`, `anon`, and `authenticated`; only the server-side `service_role` receives the explicit grants used by this POC. The `commit_tutor_turn` function atomically writes a student message, evaluation, tutor follow-up, and learner state with optimistic version checks.

### Remote development project

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push
```

After pushing migrations, run `supabase/seed.sql` in the Supabase SQL Editor, or use the following only for a disposable development project:

```bash
npx supabase@latest db push --include-seed
```

Do not run `--include-seed` or a remote reset against a production project with data that must be preserved.

### Local Supabase

Local Supabase requires a Docker-compatible runtime:

```bash
npx supabase@latest start
npx supabase@latest db reset
```

Generate TypeScript database types when needed:

```bash
npx supabase@latest gen types typescript --local > lib/database.types.ts
```

The fixtures create six demo users (Alicia Tan, Benjamin Lee, Chloe Wong, Prof. Marcus Lim, Prof. Sarah Ng, and Dr. Elaine Koh), a default class, and four published five-phase assignments: Impacted Maxillary Canine, Acute Posterior Tooth Pain, Periodontal Risk and Bone Loss, and Fractured Immature Maxillary Incisor. They are text-only teaching simulations and contain no real patient records. The seed intentionally does not create `auth.users` rows; real authentication can be linked later.

## OpenAI and Claude setup

OpenAI is the preferred provider:

1. Set `OPENAI_API_KEY` in `.env.local`.
2. Set `OPENAI_MODEL` to a model available to the account and compatible with Structured Outputs.
3. Optionally set `OPENAI_TTS_MODEL` and `OPENAI_TTS_VOICE`; the defaults provide warm English Tutor audio.
4. Restart the development server.

Claude is the optional second provider:

1. Set `ANTHROPIC_API_KEY` in `.env.local`.
2. Set `CLAUDE_MODEL` to an account-available structured-output model.
3. Restart the development server.

Answer evaluation uses one non-streaming OpenAI Responses API or Claude Messages API request with the shared Zod schema. The result contains a label, confidence, observable reasoning gap, teaching strategy, exactly one follow-up question, and a conservative memory patch. The state machine—not the model—is the authority for phase progression and database state. Session summaries are generated separately; invalid or failed provider output uses the local summary template. When `OPENAI_API_KEY` is configured, `/api/session/speech` generates MP3 audio only for a Tutor message in the signed-in student's own session. The client automatically plays it, clearly identifies it as AI-generated, and falls back to browser-native English speech if the provider is unavailable.

## Identity, authorization, and state machine

`GET /api/demo/identity` lists active seeded users. `POST /api/demo/identity` accepts only a seeded `userId`; the server derives that user's role and stores a signed HttpOnly cookie, so a client cannot submit `role=admin` to elevate itself. Route handlers use `requireStudent`, `requireProfessor`, or `requireAdmin`, then perform resource checks:

- Students may access their own sessions and assignments in their classes.
- Professors may access assignments and sessions for classes they teach.
- Admins manage users, classes, case versions, and review ownership.
- Inactive users cannot switch identity or call protected APIs.

For each student answer, `lib/tutor/state-machine.ts` loads and authorizes the session, resolves the phase and attempt, invokes the selected tutor, creates the student message/evaluation/follow-up, merges only allow-listed memory fields, and commits the turn atomically with an expected state version. A `correct` answer advances the phase; after the third unsuccessful attempt the phase also advances to prevent a dead end. Phase five completes automatically, while early exit generates a summary with `completedAllPhases=false`.

AI scores map to `correct=100`, `partial=70`, `vague=40`, and `wrong=0`; the rounded average is the formative score. Professor labels and final scores are stored independently and never overwrite the original AI evaluation.

## Core business rules

- A case draft must contain exactly five complete phases.
- Published cases are immutable; clone a new draft version to edit.
- Professors may assign only published cases to their own classes.
- Closed or expired assignments cannot create new sessions; an existing session may continue.
- Each student has one resumable session per assignment.
- Pausing preserves the active session, learner-state version, phase, and transcript; submitting another answer is blocked until the student resumes.
- Only completed sessions may be claimed and reviewed; in-progress sessions are read-only to professors.
- The first professor to save a draft atomically claims the review; colleagues become read-only.
- Admins may release or reassign unfinished reviews; completed reviews are locked.

## Recommended three-role demo

1. Switch to **Admin — Dr. Elaine Koh** and inspect the six users, default class, and case versions.
2. As Admin, adjust class membership, publish the five-phase case, or clone a new draft version.
3. Switch to **Professor — Prof. Marcus Lim** and assign the published case to his class.
4. Switch to **Student — Alicia Tan**, open the class assignment, and submit answers. The submitted student message appears immediately before the tutor follow-up.
5. Complete or end the session, then return to Marcus's **Review queue**. The first **Save draft** atomically claims the review.
6. Switch to **Professor — Prof. Sarah Ng** to verify the same review is read-only and competing writes are rejected; switch back to Marcus to complete it.
7. Return to Admin's **Activity** view to inspect class progress, AI scores, and review ownership.

Benjamin Lee and Chloe Wong are additional seeded student identities.

## API

| Method | Endpoint |
| --- | --- |
| `GET` | `/api/cases` |
| `POST` | `/api/session/start` |
| `POST` | `/api/session/message` |
| `GET` | `/api/session/:id` |
| `POST` | `/api/session/:id/pause` |
| `POST` | `/api/session/:id/resume` |
| `POST` | `/api/session/:id/complete` |
| `GET` | `/api/professor/sessions` |
| `GET` | `/api/professor/classes` |
| `GET`, `POST`, `PATCH` | `/api/professor/assignments` |
| `POST` | `/api/professor/review` |
| `GET` | `/api/admin/overview` |
| `GET`, `PATCH` | `/api/admin/users` |
| `GET`, `POST`, `PATCH` | `/api/admin/classes` |
| `PUT` | `/api/admin/classes/:id/members` |
| `GET`, `POST`, `PATCH` | `/api/admin/cases` |
| `POST` | `/api/admin/cases/:id/publish` |
| `POST` | `/api/admin/cases/:id/clone` |
| `GET` | `/api/admin/sessions` |
| `POST` | `/api/admin/reviews/reassign` |
| `GET`, `POST` | `/api/demo/identity` |
| `GET`, `POST` | `/api/admin/humanization/datasets` |
| `GET`, `POST` | `/api/admin/humanization/candidates` |
| `GET`, `POST` | `/api/admin/humanization/runs` |
| `GET`, `POST` | `/api/admin/humanization/experiments` |
| `GET`, `POST`, `PATCH` | `/api/admin/humanization/releases` |
| `GET`, `POST` | `/api/professor/humanization/approvals` |

Request bodies and AI output use shared Zod schemas. Start a session with an `assignmentId`; include a client-generated `clientRequestId` with message submissions so duplicate requests in one session are idempotent. Review writes send answer labels/comments, tutor-quality ratings where applicable, overall feedback, and a `draft` or `completed` status.

```json
POST /api/session/start
{ "assignmentId": "uuid" }
```

```json
POST /api/session/message
{
  "sessionId": "uuid",
  "message": "student reasoning",
  "clientRequestId": "client-generated-id"
}
```

Student session responses omit per-answer AI classifications, reasoning gaps, and private learner weaknesses. Professor views receive the complete transcript and evaluation data.

## Testing

The standard gates are:

```bash
npm run typecheck       # TypeScript
npm test                # Vitest unit and integration tests
npm run lint            # ESLint
npm run build           # Next.js production build
```

Tests cover the four classifications and score calculation, three-attempt protection, phase progression and early completion, memory-patch allow-listing, signed-cookie tamper resistance, class and assignment isolation, persisted pause/resume behavior, review claiming/conflicts/locking, and valid/invalid OpenAI and Claude output with deterministic fallback.

### Governed tutor evolution

The Admin **Feedback lab** implements this one-way, auditable pipeline:

`completed faculty reviews → de-identification → frozen content-addressed dataset → prompt/model candidate → offline baseline comparison → shadow (0% served) → limited A/B (maximum 25%) → professor approval → Admin release or rollback`

Offline admission requires at least 20 labelled turns from at least two distinct faculty reviewer sources, perfect structured-output safety checks, answer agreement of at least 80%, false-advance rate no greater than 5%, and a structured tutor-QA pass rate of at least 70%. These reviewer sources establish dataset diversity but do not approve the candidate; after A/B evidence exists, a named professor must make a separate append-only release decision. The database repeats the important gates, RLS blocks browser table access, and rollout assignment is deterministic. Historical faculty quality scores are not copied onto a new candidate.

No request path performs online self-training. Individual comments are evidence for a future frozen dataset only: they never rewrite prompt files, model weights, learner memory, mastery, or phase progression. Use a fresh time-based holdout for each serious release and retain the previous release metadata for rollback.

Changes involving UI state, cookies, permissions, persistence, or deployment should also be exercised in a real browser using Student → Professor → Admin. Inspect Console and Network output and confirm the final repository/database state.

## Docker

The repository includes a production multi-stage image and a Docker Compose v2 configuration. Docker runs the app locally; it does not create a Supabase cloud project. Without credentials, the container still runs the memory repository and deterministic tutor.

Install and start Docker Desktop (or another Docker Compose v2-compatible engine), then run from the repository root:

```bash
docker compose up --build
```

The app is available at [http://localhost:3000](http://localhost:3000). Compose uses `/api/cases` as its health check. To inject local Supabase/OpenAI/Claude configuration explicitly:

```bash
docker compose --env-file .env.local up --build
```

If Docker Hub is unreachable but AWS Public ECR is available, override the Node base image:

```bash
docker build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine -t socratic-tutor:poc .
```

Stop and remove the container with:

```bash
docker compose down
```

Never put `.env.local`, service keys, or API keys in the image, Dockerfile, Compose file, source, or Git. These files are excluded by `.dockerignore`.

## Deployment

For Vercel:

1. Import this repository into Vercel.
2. Confirm the project uses Node.js 22 or newer, as required by `package.json`.
3. Configure all server-only variables in Project Settings → Environment Variables.
4. Apply Supabase migrations and seed data separately; do not expose the service-role key to the browser.
5. Deploy and run the Student → Professor → Admin smoke test.
6. Review Vercel Runtime Logs for persistent 4xx/5xx responses or provider configuration errors.

Do not place production secrets in `vercel.json`, Docker images, source code, screenshots, or browser-visible variables. Replace the demo identity mechanism with an institutional identity provider and complete privacy, audit, retention, and educational-data compliance work before production use.

## Troubleshooting

- **Data disappears after restart:** the memory repository is active. Verify that both Supabase variables are set and `FORCE_MEMORY_REPOSITORY` is not `true`.
- **The UI shows “Demo tutor”:** provider credentials/model IDs are incomplete, or that request fell back. Inspect redacted server logs for provider, request ID, and error type; logs should not contain student text or secrets.
- **A professor cannot see a class or session:** verify class membership, assignment ownership, and the session's `class_case_assignment_id`.
- **Close/Reopen or date requests return 400:** send ISO-8601 timestamps with `Z` or an explicit offset, and ensure the due time is strictly later than the opening time.
- **Supabase permission error:** use the service-role key only on the server and confirm all migrations have been applied.

## Security and extension checklist

- Treat student answers as untrusted, length-limited input.
- Never request, store, or display hidden chain-of-thought.
- Validate model output and merge only allow-listed state changes.
- Preserve transactions, unique constraints, idempotency, and optimistic version checks.
- Add role and resource-level authorization tests for every new API.
- Add a new migration instead of rewriting an applied migration.
- Keep the deterministic fallback when adding a provider.
