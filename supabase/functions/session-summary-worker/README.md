# Session summary worker

This function is intended to be invoked by Supabase Cron (or an equivalent
server-side scheduler) once per minute with a `POST` request and an
`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` header. It claims at most
20 rows from `public.session_summary_jobs`, performs the external model call
without holding a database lock, and atomically applies or fails each claim.

Required secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` + `OPENAI_MODEL`, or `ANTHROPIC_API_KEY` + `CLAUDE_MODEL`

Optional environment variables are `SUMMARY_WORKER_BATCH_SIZE` (default `5`)
and `SUMMARY_WORKER_TIMEOUT_MS` (default `25000`, bounded to 5–45 seconds).
The worker tries OpenAI first and Claude second when both are configured. A
schema-invalid model response is treated as a failed attempt; the database
requires at least one `strengths` and one `nextSteps` item before it can be
applied. The deterministic summary saved by session completion remains in
`sessions.context.summary` if all three attempts fail.

The SQL migration owns the queue lease and retry policy: a claim increments
the attempt counter, failures retry after 30 seconds then 60 seconds, and the
third failure is terminal. `claim_token` prevents a stale worker from writing
after its lease was reclaimed.

For local verification, inspect the queue with a service-role SQL session:

```sql
select id, session_id, status, attempt_count, available_at, last_error
from public.session_summary_jobs
order by created_at;
```
