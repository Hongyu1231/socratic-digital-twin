# Contributing

Thank you for contributing to Socratic Digital Twin AI Tutor. This POC handles educational interaction data and server-side AI credentials, so small changes should still follow a disciplined engineering workflow.

Before starting, read:

- [Developer Guide](docs/DEVELOPER_GUIDE.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Tutor Humanization Plan](docs/HUMANIZATION_PLAN.md) when changing Tutor behavior

## 1. Development workflow

1. Pull the latest `master`.
2. Create a focused branch such as `feat/assignment-filters`, `fix/review-claim`, or `docs/backend-map`.
3. Keep the change scoped to one behavior or refactor.
4. Add or update tests with the implementation.
5. Run all quality gates.
6. Perform role-based browser verification when the change is user-facing or stateful.
7. Open a pull request; do not use direct production changes as a substitute for reviewed source control.

## 2. Commit guidance

Use short, imperative commit messages. Conventional prefixes are encouraged:

- `feat:` new behavior
- `fix:` defect correction
- `refactor:` behavior-preserving structure change
- `test:` test-only change
- `docs:` documentation-only change
- `chore:` tooling or maintenance

Do not mix unrelated cleanup with a feature or bug fix.

## 3. Engineering expectations

### Frontend

- Call backend routes rather than importing repositories or provider SDKs.
- Handle loading, empty, error, success, disabled, and conflict states.
- Keep user-facing UI copy in English.
- Preserve accessibility and responsive behavior.
- Do not rely on hidden UI controls for authorization.

### Backend

- Authenticate and authorize every protected route.
- Validate HTTP input and AI output with Zod.
- Enforce resource ownership in addition to roles.
- Keep multi-row state changes atomic.
- Preserve idempotency and optimistic concurrency behavior.
- Update both memory and Supabase adapters when the repository contract changes.

### Database

- Add a forward migration; never rewrite applied migration history.
- Enable RLS and review grants for new public tables.
- Put durable invariants in constraints or guarded database functions.
- Keep the Supabase service-role key server-only.

### Tutor and data safety

- Treat student text as untrusted data.
- Never request, expose, or persist hidden chain-of-thought.
- Do not store real patient data in fixtures or tests.
- Do not log student answers, secrets, or raw provider errors.
- Keep deterministic fallback working.
- Route Tutor behavior changes through frozen evaluation, controlled testing, and faculty approval.

## 4. Required checks

Run from the repository root:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

If a migration changed, also run the appropriate Supabase dry run and lint against the development project.

## 5. Pull-request checklist

Include the following in the pull-request description:

- **Problem:** what behavior or risk is being addressed.
- **Approach:** why the selected layer is the correct owner.
- **Frontend impact:** pages, components, interaction states, accessibility.
- **Backend impact:** routes, schemas, authorization, repository, providers.
- **Data impact:** migration, compatibility, backfill, rollback.
- **Verification:** automated commands and browser roles/actions tested.
- **Screenshots:** before/after for meaningful visual changes.
- **Risk and rollback:** likely failure mode and safe rollback path.

Reviewers should be able to trace a request from UI to route, service, repository, and persisted result without guessing.

## 6. Secrets and local files

Never commit:

- `.env.local` or any environment-specific secret file;
- OpenAI, Anthropic, Supabase, Vercel, or GitHub credentials;
- exported production data;
- screenshots containing secrets, real student data, or real patient data;
- generated build output or local dependency directories.

Use `.env.example` for variable names and safe descriptions only.
