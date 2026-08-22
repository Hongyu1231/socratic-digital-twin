# Session summary worker

This function is intended to be invoked by Supabase Cron (or an equivalent
server-side scheduler) once per minute with a `POST` request and an
`x-summary-worker-secret` header. It claims at most
20 rows from `public.session_summary_jobs`, performs the external model call
without holding a database lock, and atomically applies or fails each claim.

Required secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUMMARY_WORKER_CRON_SECRET` (a random value used only to authenticate Cron)
- `TUTOR_PROVIDER` (`deterministic`, `openai`, or `claude`)
- The matching key/model pair when `TUTOR_PROVIDER` is `openai` or `claude`

Optional environment variables are `SUMMARY_WORKER_BATCH_SIZE` (default `5`)
and `SUMMARY_WORKER_TIMEOUT_MS` (default `25000`, bounded to 5–45 seconds).
The worker uses only the explicitly selected Tutor provider and never switches
between OpenAI and Claude. In deterministic mode it validates and reapplies the
already-saved local summary without making an external request. A schema-invalid
model response is treated as a failed attempt; the database
requires at least one `strengths` and one `nextSteps` item before it can be
applied. The deterministic summary saved by session completion remains in
`sessions.context.summary` if all three attempts fail.

The SQL migration owns the queue lease and retry policy: a claim increments
the attempt counter, failures retry after 30 seconds then 60 seconds, and the
third failure is terminal. `claim_token` prevents a stale worker from writing
after its lease was reclaimed.

After deploying the function, store the same random cron secret in Supabase
Vault as `session_summary_worker_cron_secret`, store the project URL as
`project_url`, and run `supabase/cron/session-summary-worker.sql`. That script
creates or replaces the once-per-minute job without placing either value in
source control. The function has JWT verification disabled because it performs
its own dedicated-secret check before creating a service-role client.

For local verification, inspect the queue with a service-role SQL session:

```sql
select id, session_id, status, attempt_count, available_at, last_error
from public.session_summary_jobs
order by created_at;
```
