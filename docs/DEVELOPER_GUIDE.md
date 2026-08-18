# Developer Guide

This guide is the practical onboarding reference for engineers working on Socratic Digital Twin AI Tutor. It explains how to run the project, how frontend and backend work should be approached, and what is required before a change is ready for review.

Read [System Architecture](ARCHITECTURE.md) before making a cross-layer change. Follow [Contributing](../CONTRIBUTING.md) when opening a pull request.

## 1. First 30 minutes

### Prerequisites

- Node.js 22 or newer
- npm
- Git
- Optional: Supabase CLI and Docker for local PostgreSQL
- Optional: Supabase, OpenAI, and Anthropic credentials

### Install and run

```bash
npm install
```

Create the local environment file:

```powershell
Copy-Item .env.example .env.local
```

On macOS or Linux:

```bash
cp .env.example .env.local
```

Start the application:

```bash
npm run dev
```

Open `http://localhost:3000`. Empty credentials are supported: the application uses seeded memory data and the deterministic Tutor.

### Confirm the three-role flow

1. As **Student — Alicia Tan**, open an assignment and submit an answer.
2. Pause and resume the session, then complete or end it.
3. Switch to **Professor — Prof. Marcus Lim** and inspect or claim the review.
4. Switch to **Admin — Dr. Elaine Koh** and inspect users, classes, cases, activity, and the Tutor improvement lab.

This smoke test verifies more than page rendering: it exercises the signed identity cookie, API authorization, state machine, repository, and role-specific response shaping.

## 2. Documentation map

| Document | Use it for |
| --- | --- |
| `README.md` | Product summary, configuration, demo, deployment, troubleshooting |
| `docs/ARCHITECTURE.md` | Frontend/backend boundaries, data flow, adapters, invariants |
| `docs/DEVELOPER_GUIDE.md` | Setup, daily development, debugging, verification |
| `CONTRIBUTING.md` | Branch, commit, pull-request, and review expectations |
| `docs/HUMANIZATION_PLAN.md` | Governed Professor-feedback and Tutor-evolution design |
| `docs/USER_GUIDE.md` | English end-user instructions |

## 3. Repository orientation

### Frontend

| Location | What it contains |
| --- | --- |
| `app/page.tsx` | Student case selection |
| `app/session/[id]/` | Student chat and summary |
| `app/professor/` | Professor dashboard and detailed review |
| `app/admin/` | Admin operations and Tutor improvement lab |
| `components/` | Shared identity, resource, and date-time UI |
| `app/globals.css` | Global visual system |
| `*.module.css` | Page-scoped Professor styles |

### Backend

| Location | What it contains |
| --- | --- |
| `app/api/` | Server-only HTTP route handlers |
| `lib/auth.ts` | Signed demo identity and role guards |
| `lib/schemas.ts` | Runtime request and model-output validation |
| `lib/tutor/state-machine.ts` | Authoritative learning workflow |
| `lib/repository/` | Persistence interface and adapters |
| `lib/tutor/` | AI providers, deterministic fallback, prompt, summary, speech |
| `lib/experiments/` | Frozen evaluation and governed release workflow |
| `supabase/` | PostgreSQL migrations, configuration, and seed data |

### Shared contracts

- `lib/domain.ts` is the primary domain model.
- `lib/schemas.ts` is the runtime validation model.
- `lib/repository/types.ts` is the persistence contract.
- `lib/database.types.ts` mirrors the Supabase schema.

When one contract changes, search for all consumers before editing. A new field commonly requires changes in the domain type, Zod schema, route, repository mapping, UI, and tests.

## 4. Runtime modes

Persistence and Tutor providers are selected independently.

| Configuration | Persistence | Tutor |
| --- | --- | --- |
| No credentials | Memory | Deterministic |
| Supabase pair only | Supabase | Deterministic |
| OpenAI pair | Existing persistence selection | OpenAI with deterministic request fallback |
| Claude pair without OpenAI pair | Existing persistence selection | Claude with deterministic request fallback |
| `FORCE_MEMORY_REPOSITORY=true` | Memory | Normal Tutor selection |

Required pairs:

- Supabase: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- OpenAI: `OPENAI_API_KEY` and `OPENAI_MODEL`
- Claude: `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`

`DEMO_SESSION_SECRET` is required in production. `EXPERIMENT_PSEUDONYM_SECRET` is required in production when freezing Tutor-evaluation datasets. Keep every secret server-only; do not add a `NEXT_PUBLIC_` prefix.

## 5. Frontend development

### Component rules

- Keep network calls at page/feature boundaries rather than inside visual leaf components.
- Use shared domain types for API responses.
- Represent initial loading, mutation loading, empty, error, and success states explicitly.
- Track the specific pending action; show a spinner and action verb on the clicked control.
- Disable duplicate mutations while a request is active.
- Use optimistic UI only when the server response will replace it.
- Preserve keyboard navigation, labels, focus behavior, and mobile layouts.
- Keep all user-facing copy in English unless a localized document is intentionally being edited.

### Client/server boundary

Files with `"use client"` may use browser APIs and React state. They must not import server secrets, repository adapters, AI SDK clients, `next/headers`, or service-role code.

Client components call `/api/**`. Route handlers enforce the actual rules. Hiding a button is presentation behavior, not authorization.

### Styling

The shared visual language is in `app/globals.css`. Professor pages also use CSS Modules. Reuse existing button, status, form, loading, and panel patterns before introducing a new variant.

For meaningful UI changes, test at desktop and mobile widths and inspect both the browser console and network responses.

## 6. Backend development

### Route-handler template

A route handler should normally:

1. call the appropriate `require*()` role guard;
2. parse JSON with a schema from `lib/schemas.ts`;
3. call an application service or repository operation;
4. apply resource-level authorization through that operation;
5. return a role-appropriate JSON shape;
6. pass errors to `errorResponse()`.

Do not put provider credentials, raw SQL, or complex teaching-state transitions in a route handler.

### Repository changes

When persistence behavior changes:

1. update `TutorRepository` in `lib/repository/types.ts`;
2. implement the behavior in `lib/repository/memory.ts`;
3. implement it in `lib/repository/supabase.ts`;
4. add a new migration if schema behavior changes;
5. update `lib/database.types.ts` when the database shape changes;
6. add contract or workflow tests.

Never silently support a feature in only one adapter. The credential-free mode is a first-class acceptance path, not a mock left behind after development.

### Tutor changes

Tutor provider output is untrusted. Keep the shared Zod output schema small and closed, validate it after the SDK parses it, and let the state machine merge only approved memory fields.

Do not:

- request or store hidden chain-of-thought;
- let model text choose database identifiers or roles;
- let an individual Professor comment directly rewrite the live prompt;
- remove deterministic fallback without replacing its acceptance coverage.

Changes to Tutor behavior should receive a new prompt version and be evaluated through the frozen-dataset workflow described in `docs/HUMANIZATION_PLAN.md`.

### Database changes

Create a migration:

```bash
npx supabase@latest migration new descriptive_change_name
```

Validate and apply against the linked development project only after reviewing the generated SQL:

```bash
npx supabase@latest db push --linked --dry-run
npx supabase@latest db lint --linked --level error --fail-on error
npx supabase@latest db push --linked
```

Do not edit an applied migration. Do not reset or include seed data against a project containing data that must be preserved.

## 7. Common change recipes

### Add a new API field

1. Update the domain type in `lib/domain.ts`.
2. Update the Zod input or output schema in `lib/schemas.ts`.
3. Update the route handler and caller.
4. Update memory and Supabase mapping if the field is persisted.
5. Add a migration if required.
6. Test valid, invalid, unauthorized, and missing-field behavior.

### Add a new page action

1. Add an explicit pending-action state.
2. Disable conflicting controls during the request.
3. Show a spinner and present-tense action text.
4. Preserve the form or modal when the request fails.
5. Refresh from the authoritative response after success.
6. Test the slow-request state, not only the final state.

### Add a business rule

1. Place the rule in the application/repository layer, not only in the UI.
2. Add the corresponding database constraint when practical.
3. Return a stable 4xx conflict or validation response.
4. Add a positive test and a forbidden/conflict test.
5. Confirm memory and Supabase modes behave the same way.

### Add or change a case

- Demo-memory content: `lib/seed.ts`
- Supabase fixtures: a forward migration or `supabase/seed.sql`, depending on whether existing linked projects must receive it
- Admin-created content: use the Admin case editor and publish workflow

Published content is immutable. Clone a new draft version rather than modifying a published row.

## 8. Testing strategy

### Required local gates

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

### Test placement

| Scope | Location / pattern |
| --- | --- |
| Pure domain behavior | `lib/domain.test.ts` |
| Tutor behavior and providers | `lib/tutor/*.test.ts` |
| Repository workflows | `lib/repository/*.test.ts` |
| Authentication | `lib/auth.test.ts` |
| Tutor improvement | `lib/experiments/experiments.test.ts`, `app/admin/feedback-lab.test.ts` |
| Speech | `lib/speech.test.ts`, `lib/tutor/speech.test.ts` |

Prefer tests at stable boundaries. Test the public repository contract, state-machine result, route response, or rendered interaction rather than private implementation details.

The automated repository workflow suite primarily exercises the in-memory adapter. Supabase migration, constraint, RLS, grant, and RPC validation requires a configured linked development project (or a local Supabase runtime) and is not automatically covered by `npm test` alone.

### Browser verification

Browser verification is required when a change affects UI state, cookies, authorization, persistence, navigation, speech, or deployment.

Minimum cross-role verification:

1. Student starts/resumes a session and sees the submitted message immediately.
2. Professor sees only their classes and can claim an eligible review.
3. A second Professor cannot overwrite that claim.
4. Admin sees the updated activity and can perform only allowed review reassignment.
5. Unauthorized role/page combinations return a clear forbidden response.

Record the tested URL, role, action, expected status, and resulting state in the pull request.

## 9. Debugging guide

### Data disappears after restart

The memory repository is active. Check that both Supabase variables are present and that `FORCE_MEMORY_REPOSITORY` is not `true`.

### UI reports “Demo tutor”

The deterministic Tutor is active, or the configured provider fell back for that request. Check server logs for the redacted provider, request ID, and error type.

### A user can see a page but an action returns 403

The page-level role is valid, but resource authorization failed. Check class membership, assignment ownership, session ownership, or active-user status.

### A mutation returns 409

Treat it as a concurrency or immutability signal. Common causes are a stale learner-state version, an already-claimed review, a completed review, or an attempted edit to published content.

### Supabase and memory behave differently

Start with the repository contract and workflow tests. Then inspect Supabase row mapping, unique constraints, RPC arguments, and migration history. Do not patch the UI to hide adapter divergence.

## 10. Definition of done

A change is ready for review when:

- the requested behavior works in the relevant roles;
- frontend and backend responsibilities remain separated;
- runtime inputs and model outputs are validated;
- resource authorization is covered;
- memory and Supabase paths are updated where applicable;
- loading, empty, error, success, and conflict states are handled;
- tests and production build pass;
- browser verification is recorded for user-facing or stateful changes;
- documentation and `.env.example` are updated when behavior or configuration changes;
- no secret, student identifier, or real patient data appears in code, logs, fixtures, screenshots, or commits.
