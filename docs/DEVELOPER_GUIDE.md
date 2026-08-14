# Developer Guide

This document is for developers who need to run, debug, extend, or deploy Socratic Digital Twin AI Tutor.

## 1. Purpose

This teaching POC demonstrates an end-to-end workflow: Admin organizes teaching, Professor assigns a case, Student completes Socratic reasoning, Professor reviews the submission, and Admin monitors the overall state.

It is not a clinical diagnostic system. It stores no real patient data and does not implement production registration, OAuth, or Supabase Auth. A signed HttpOnly cookie stores the selected seeded demo identity.

## 2. Stack and requirements

- Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS
- Node.js 22+
- Shared Zod validation
- Supabase PostgreSQL or an in-process repository
- OpenAI Responses API, Claude Messages API, or the deterministic tutor
- Vitest, ESLint, TypeScript, and Next.js production builds

## 3. Quick start

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. With no external credentials, the complete demo runs with in-memory data and the deterministic tutor.

Run before submitting changes:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## 4. Adapter architecture

The database and AI providers are selected independently. `FORCE_MEMORY_REPOSITORY=true` forces memory mode. Otherwise, a complete Supabase URL/service-role pair enables Supabase. A complete OpenAI key/model pair selects OpenAI first; otherwise a complete Anthropic key/model pair selects Claude. Missing credentials or a failed individual AI call fall back to the deterministic tutor.

The browser never receives database or AI credentials. Pages call Next.js server routes, which apply authentication, authorization, Zod validation, state-machine rules, and repository operations.

## 5. Environment variables

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `DEMO_SESSION_SECRET` | Required in production | HMAC secret for the demo identity cookie |
| `SUPABASE_URL` | Optional | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-only database key; never prefix with `NEXT_PUBLIC_` |
| `FORCE_MEMORY_REPOSITORY` | Optional | Forces the in-memory adapter |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Optional pair | Preferred structured-output tutor |
| `OPENAI_PROXY_URL` | Optional | HTTP(S) proxy used by the Node.js OpenAI client |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | Optional pair | Secondary structured-output tutor |

Keep secrets in `.env.local`, Vercel Environment Variables, or a secret manager. Never commit them or import them into client components.

## 6. Repository layout

| Path | Responsibility |
| --- | --- |
| `app/` | App Router pages and server APIs |
| `components/site-header.tsx` | Seeded identity selector |
| `lib/domain.ts` | Domain types and scoring constants |
| `lib/schemas.ts` | Shared Zod schemas |
| `lib/auth.ts` | Cookie signing and role guards |
| `lib/repository/` | Interface, memory adapter, and Supabase adapter |
| `lib/tutor/` | Providers, deterministic fallback, summaries, and state machine |
| `supabase/migrations/` | Versioned database schema |
| `supabase/seed.sql` | Idempotent demo data |

## 7. Identity and authorization

`POST /api/demo/identity` accepts only a seeded `userId`. The server derives the role from the repository, preventing the client from declaring elevated privileges. Route handlers use `requireStudent`, `requireProfessor`, or `requireAdmin`, followed by resource-level checks for session ownership and class membership.

This mechanism is intentionally limited to the POC. A production system should use an institutional identity provider and map external identities to internal users and class permissions.

## 8. Tutor state machine

For each student answer, the state machine:

1. Loads the session and checks ownership/status.
2. Resolves the current phase and attempt number.
3. Calls the selected tutor, with deterministic fallback.
4. Creates one student message, evaluation, allow-listed memory patch, and follow-up.
5. Commits the turn atomically with an expected state version.
6. Advances on `correct`, or after the third unsuccessful attempt.
7. Completes automatically after phase five, or produces an incomplete summary when the learner ends early.

AI scoring is the rounded average of `correct=100`, `partial=70`, `vague=40`, and `wrong=0`. The professor score is stored independently.

## 9. Supabase setup

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push
```

Run `supabase/seed.sql` in the SQL Editor, or use `db push --include-seed` only for a disposable development project.

The schema covers users, classes and memberships, versioned cases and phases, assignments, sessions, messages, evaluations, learner state, and reviews. Public tables use RLS and revoke direct `anon`/`authenticated` table access. Only the server-side service-role repository accesses them. `commit_tutor_turn` atomically persists a teaching turn.

## 10. Core business rules

- Draft cases require exactly five complete phases.
- Published cases are immutable; clone a new draft version to edit.
- Professors may assign only published cases to their own classes.
- Closed or expired assignments cannot start new sessions; an existing session may continue.
- A student has one resumable session per assignment.
- `POST /api/session/:id/pause` persists `pausedAt` without changing the learner-state version; `POST /api/session/:id/resume` clears it. Answer submission is rejected while paused.
- Only completed sessions may be reviewed.
- The first professor to save a draft atomically claims the review; colleagues become read-only.
- Admin may release or reassign unfinished reviews; completed reviews are locked.

## 11. API conventions

API bodies and AI output use shared Zod schemas. Use `assignmentId` to start a session. Message submissions should include a client-generated `clientRequestId` for idempotency. Review writes send a batch of evaluation labels and comments plus overall feedback and a `draft` or `completed` status.

Student session responses omit AI classifications, reasoning gaps, and private learner weaknesses. Professor views receive the full evaluation and transcript.

## 12. Testing

Run the four standard gates shown in Quick Start. Automated coverage includes scoring, all four classifications, phase progression, three-attempt protection, memory allow-listing, early completion, signed-cookie tamper resistance, class isolation, review claiming, and AI adapter fallback.

Changes involving UI state, cookies, permissions, or persistence also require a real-browser Student → Professor → Admin test. Inspect browser Console and Network output and confirm the resulting database state.

## 13. Docker and deployment

```bash
docker compose up --build
docker compose down
```

For Vercel, import the GitHub repository, configure all server-only environment variables in Project Settings, deploy, and run a three-role smoke test. Review Runtime Logs for persistent 4xx/5xx or provider configuration errors. Never place production secrets in source, `vercel.json`, Docker images, screenshots, or browser-visible variables.

## 14. Troubleshooting

- Data disappears after restart: the memory repository is active; verify the complete Supabase credential pair and `FORCE_MEMORY_REPOSITORY`.
- UI shows Demo tutor: provider configuration is incomplete or that request fell back. Inspect redacted server logs for provider, request ID, and error type.
- Professor cannot see a class/session: verify class membership, assignment ownership, and `class_case_assignment_id`.
- Assignment dates return 400: send ISO-8601 with `Z` or an explicit offset, and keep the due time strictly later than the opening time.
- Supabase permission error: use the service-role key only on the server and confirm all migrations were applied.

## 15. Security and extension checklist

- Treat student answers as untrusted and length-limited input.
- Never request, store, or display hidden chain-of-thought.
- Validate model output and merge only allow-listed state changes.
- Preserve atomicity, uniqueness, idempotency, and optimistic version checks.
- Add role and resource authorization tests for every new API.
- Add new migrations instead of rewriting applied history.
- Keep the deterministic fallback when adding providers.
- Replace demo auth and complete privacy, audit, retention, and educational-data compliance work before production use.
