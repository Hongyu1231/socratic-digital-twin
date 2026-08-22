-- Run after the Edge Function is deployed and these Vault secrets exist:
--   project_url: https://<project-ref>.supabase.co
--   session_summary_worker_cron_secret: the same random value configured as
--     the Edge Function's SUMMARY_WORKER_CRON_SECRET.
-- No production value belongs in this file or in migration history.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'session-summary-worker-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/session-summary-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-summary-worker-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'session_summary_worker_cron_secret'
      )
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'requestedAt', now()),
    timeout_milliseconds := 5000
  ) as request_id
  where exists (
    select 1 from vault.decrypted_secrets where name = 'project_url'
  )
    and exists (
      select 1 from vault.decrypted_secrets where name = 'session_summary_worker_cron_secret'
    );
  $job$
);
