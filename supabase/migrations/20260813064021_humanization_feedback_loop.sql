begin;

-- Humanization feedback is deliberately separated from live tutoring data.
-- These tables contain only de-identified samples and experiment metadata;
-- student ids, emails, and raw transcripts must not be copied into them.

create or replace function public.humanization_sample_is_deidentified(payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  key_name text;
  child jsonb;
  scalar text;
begin
  if payload is null then
    return false;
  end if;

  if jsonb_typeof(payload) = 'object' then
    for key_name, child in select key, value from jsonb_each(payload) loop
      -- These key names are never valid in a frozen sample.  The application
      -- may still store clinical reasoning text under safe keys such as
      -- answer, phase, baseline, or tutor_quality after de-identification.
      if lower(key_name) ~ '(patient|student|learner|user|auth|email|phone|address|mrn|medical_record|date_of_birth|dob|identifier|full_name|real_name|raw|original|free_text|transcript|reviewer_pseudonym)' then
        return false;
      end if;
      if not public.humanization_sample_is_deidentified(child) then
        return false;
      end if;
    end loop;
    return true;
  elsif jsonb_typeof(payload) = 'array' then
    for child in select value from jsonb_array_elements(payload) loop
      if not public.humanization_sample_is_deidentified(child) then
        return false;
      end if;
    end loop;
    return true;
  elsif jsonb_typeof(payload) = 'string' then
    scalar := payload #>> '{}';
    -- Reject common direct identifiers even when they are nested in a safe
    -- field.  This is a defense-in-depth check; application-side redaction is
    -- still required before a sample is inserted.
    return scalar !~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
      and scalar !~ '(\+?\d[\d ()-]{6,}\d)';
  end if;

  return true;
end;
$$;

create or replace function public.humanization_require_user_role(
  p_user_id uuid,
  p_expected_role text
)
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  if p_user_id is null or not exists (
    select 1
      from public.users as u
     where u.id = p_user_id
       and u.role::text = p_expected_role
       and coalesce(u.is_active, true)
  ) then
    raise exception using errcode = '42501',
      message = format('User must be an active %s', p_expected_role);
  end if;
end;
$$;

create table public.humanization_datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'building',
  content_hash text,
  deidentification_version text not null,
  source_from timestamptz,
  source_to timestamptz,
  entry_count integer not null default 0,
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  frozen_at timestamptz,
  constraint humanization_datasets_name_not_blank check (length(btrim(name)) > 0),
  constraint humanization_datasets_status check (status in ('building', 'frozen', 'archived')),
  constraint humanization_datasets_hash_format check (
    content_hash is null or content_hash ~ '^[a-fA-F0-9]{64}$'
  ),
  constraint humanization_datasets_version_not_blank check (length(btrim(deidentification_version)) > 0),
  constraint humanization_datasets_source_window check (
    source_from is null or source_to is null or source_from <= source_to
  ),
  constraint humanization_datasets_entry_count_nonnegative check (entry_count >= 0),
  constraint humanization_datasets_frozen_consistent check (
    (status = 'building' and frozen_at is null)
    or (status in ('frozen', 'archived') and frozen_at is not null and content_hash is not null)
  )
);

create unique index humanization_datasets_content_hash_unique_idx
  on public.humanization_datasets (content_hash)
  where content_hash is not null;

create table public.humanization_dataset_entries (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.humanization_datasets (id) on delete cascade,
  sample_key text not null,
  pseudonym text not null,
  sample jsonb not null,
  sample_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint humanization_dataset_entries_sample_key_not_blank check (length(btrim(sample_key)) > 0),
  constraint humanization_dataset_entries_pseudonym_hash check (
    pseudonym ~ '^[A-Za-z0-9_-]{8,128}$'
  ),
  constraint humanization_dataset_entries_sample_object check (jsonb_typeof(sample) = 'object'),
  constraint humanization_dataset_entries_sample_deidentified check (
    public.humanization_sample_is_deidentified(sample)
  ),
  constraint humanization_dataset_entries_hash_format check (sample_hash ~ '^[a-fA-F0-9]{64}$'),
  constraint humanization_dataset_entries_key_unique unique (dataset_id, sample_key),
  constraint humanization_dataset_entries_hash_unique unique (dataset_id, sample_hash)
);

create table public.tutor_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  instructions text not null,
  status text not null default 'draft',
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tutor_candidates_name_not_blank check (length(btrim(name)) > 0),
  constraint tutor_candidates_provider check (provider in ('openai', 'claude', 'deterministic')),
  constraint tutor_candidates_model_not_blank check (length(btrim(model)) > 0),
  constraint tutor_candidates_prompt_version_not_blank check (length(btrim(prompt_version)) > 0),
  constraint tutor_candidates_instructions_not_blank check (length(btrim(instructions)) > 0),
  constraint tutor_candidates_instructions_size check (length(instructions) <= 20000),
  constraint tutor_candidates_status check (status in ('draft', 'evaluated', 'retired')),
  constraint tutor_candidates_provider_model_prompt_unique unique (provider, model, prompt_version)
);

create table public.humanization_eval_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.humanization_datasets (id) on delete restrict,
  candidate_id uuid not null references public.tutor_candidates (id) on delete restrict,
  status text not null default 'pending',
  baseline_metrics jsonb,
  candidate_metrics jsonb,
  metric_deltas jsonb,
  gate_result jsonb,
  error text,
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint humanization_eval_runs_status check (status in ('pending', 'running', 'completed', 'failed')),
  constraint humanization_eval_runs_metrics_object check (
    (baseline_metrics is null or jsonb_typeof(baseline_metrics) = 'object')
    and (candidate_metrics is null or jsonb_typeof(candidate_metrics) = 'object')
    and (metric_deltas is null or jsonb_typeof(metric_deltas) = 'object')
    and (gate_result is null or jsonb_typeof(gate_result) = 'object')
  ),
  constraint humanization_eval_runs_gate_boolean check (
    gate_result is null or not (gate_result ? 'passed')
    or coalesce(jsonb_typeof(gate_result -> 'passed') = 'boolean', false)
  ),
  constraint humanization_eval_runs_terminal_consistent check (
    (status in ('pending', 'running') and completed_at is null and error is null)
    or (status = 'completed' and completed_at is not null and error is null
      and baseline_metrics is not null and candidate_metrics is not null
      and metric_deltas is not null and gate_result is not null
      and coalesce(jsonb_typeof(gate_result -> 'passed') = 'boolean', false))
    or (status = 'failed' and completed_at is not null and error is not null and length(btrim(error)) > 0)
  )
);

create table public.humanization_experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  candidate_id uuid not null references public.tutor_candidates (id) on delete restrict,
  eval_run_id uuid not null references public.humanization_eval_runs (id) on delete restrict,
  mode text not null,
  status text not null default 'draft',
  traffic_percent numeric(5, 2) not null default 0,
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  ended_at timestamptz,
  constraint humanization_experiments_name_not_blank check (length(btrim(name)) > 0),
  constraint humanization_experiments_mode check (mode in ('shadow', 'ab')),
  constraint humanization_experiments_status check (status in ('draft', 'running', 'paused', 'completed')),
  -- Candidate exposure is deliberately capped during this POC. A later
  -- migration, backed by faculty governance evidence, is required to raise it.
  constraint humanization_experiments_traffic_range check (traffic_percent >= 0 and traffic_percent <= 25),
  constraint humanization_experiments_shadow_traffic check (mode <> 'shadow' or traffic_percent = 0),
  constraint humanization_experiments_timestamps check (
    (status = 'draft' and started_at is null and ended_at is null)
    or (status in ('running', 'paused') and started_at is not null and ended_at is null)
    or (status = 'completed' and started_at is not null and ended_at is not null and ended_at >= started_at)
  )
);

create table public.humanization_experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.humanization_experiments (id) on delete cascade,
  assignment_key text not null,
  sample_key text,
  arm text not null,
  assignment_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint humanization_experiment_assignments_key_not_blank check (length(btrim(assignment_key)) > 0),
  constraint humanization_experiment_assignments_hash_format check (assignment_hash ~ '^[a-fA-F0-9]{64}$'),
  constraint humanization_experiment_assignments_sample_key_not_blank check (
    sample_key is null or length(btrim(sample_key)) > 0
  ),
  constraint humanization_experiment_assignments_arm check (arm in ('baseline', 'candidate')),
  constraint humanization_experiment_assignments_unique unique (experiment_id, assignment_key)
);

create table public.humanization_shadow_results (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.humanization_experiments (id) on delete cascade,
  sample_key text,
  turn_key text,
  arm text not null,
  baseline_output jsonb not null,
  candidate_output jsonb not null,
  safety_passed boolean not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint humanization_shadow_results_key_required check (
    (sample_key is not null and length(btrim(sample_key)) > 0)
    or (turn_key is not null and length(btrim(turn_key)) > 0)
  ),
  constraint humanization_shadow_results_arm check (arm in ('baseline', 'candidate')),
  constraint humanization_shadow_results_output_object check (
    jsonb_typeof(baseline_output) = 'object'
    and jsonb_typeof(candidate_output) = 'object'
    and public.humanization_sample_is_deidentified(baseline_output)
    and public.humanization_sample_is_deidentified(candidate_output)
  ),
  constraint humanization_shadow_results_keys_not_both_null check (
    sample_key is not null or turn_key is not null
  )
);

create table public.faculty_release_approvals (
  id uuid primary key default gen_random_uuid(),
  eval_run_id uuid not null references public.humanization_eval_runs (id) on delete cascade,
  professor_id uuid not null references public.users (id) on delete restrict,
  decision text not null,
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  constraint faculty_release_approvals_decision check (decision in ('approved', 'rejected')),
  constraint faculty_release_approvals_notes_size check (length(notes) <= 10000),
  constraint faculty_release_approvals_unique unique (eval_run_id, professor_id)
);

create table public.tutor_releases (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.tutor_candidates (id) on delete restrict,
  eval_run_id uuid not null references public.humanization_eval_runs (id) on delete restrict,
  status text not null default 'active',
  traffic_percent numeric(5, 2) not null default 0,
  released_by uuid not null references public.users (id) on delete restrict,
  release_notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  rolled_back_by uuid references public.users (id) on delete restrict,
  rolled_back_at timestamptz,
  rollback_reason text,
  constraint tutor_releases_status check (status in ('active', 'rolled_back')),
  constraint tutor_releases_traffic_range check (traffic_percent >= 0 and traffic_percent <= 25),
  constraint tutor_releases_release_notes_size check (length(release_notes) <= 10000),
  constraint tutor_releases_rollback_consistent check (
    (status = 'active' and rolled_back_by is null and rolled_back_at is null and rollback_reason is null)
    or (status = 'rolled_back' and rolled_back_at is not null
      and rolled_back_by is not null
      and rollback_reason is not null and length(btrim(rollback_reason)) > 0)
  )
);

create table public.tutor_release_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.tutor_releases (id) on delete cascade,
  event_type text not null,
  actor_id uuid not null references public.users (id) on delete restrict,
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  constraint tutor_release_events_type check (event_type in ('released', 'rolled_back')),
  constraint tutor_release_events_notes_size check (length(notes) <= 10000)
);

create index humanization_datasets_status_idx on public.humanization_datasets (status);
create index humanization_datasets_created_by_idx on public.humanization_datasets (created_by);
create index humanization_dataset_entries_dataset_idx on public.humanization_dataset_entries (dataset_id);
create index tutor_candidates_status_idx on public.tutor_candidates (status);
create index tutor_candidates_provider_model_idx on public.tutor_candidates (provider, model);
create index humanization_eval_runs_dataset_idx on public.humanization_eval_runs (dataset_id);
create index humanization_eval_runs_candidate_idx on public.humanization_eval_runs (candidate_id);
create index humanization_eval_runs_status_idx on public.humanization_eval_runs (status);
create index humanization_experiments_candidate_idx on public.humanization_experiments (candidate_id);
create index humanization_experiments_status_idx on public.humanization_experiments (status);
create index humanization_experiment_assignments_experiment_idx on public.humanization_experiment_assignments (experiment_id);
create index humanization_shadow_results_experiment_idx on public.humanization_shadow_results (experiment_id);
create unique index humanization_shadow_results_unique_key_idx
  on public.humanization_shadow_results (
    experiment_id,
    arm,
    coalesce(sample_key, ''),
    coalesce(turn_key, '')
  );
create index faculty_release_approvals_eval_run_idx on public.faculty_release_approvals (eval_run_id);
create index faculty_release_approvals_professor_idx on public.faculty_release_approvals (professor_id);
create index tutor_releases_candidate_idx on public.tutor_releases (candidate_id);
create index tutor_releases_eval_run_idx on public.tutor_releases (eval_run_id);
create index tutor_release_events_release_idx on public.tutor_release_events (release_id, created_at);
create unique index tutor_releases_one_active_candidate_idx
  on public.tutor_releases (candidate_id)
  where status = 'active';

create or replace function public.humanization_guard_dataset()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actual_count integer;
begin
  if tg_op = 'INSERT' then
    perform public.humanization_require_user_role(new.created_by, 'admin');
    if new.status <> 'building' then
      raise exception using errcode = '22023', message = 'A new dataset must start in building status';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Evaluation datasets are append-only; archive instead of deleting';
  end if;

  if new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'Dataset provenance is immutable';
  end if;

  if old.status = 'archived' then
    raise exception using errcode = '55000', message = 'Archived datasets are immutable';
  end if;
  if old.status = 'frozen' and (
    new.name is distinct from old.name
    or new.content_hash is distinct from old.content_hash
    or new.deidentification_version is distinct from old.deidentification_version
    or new.source_from is distinct from old.source_from
    or new.source_to is distinct from old.source_to
    or new.entry_count is distinct from old.entry_count
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.frozen_at is distinct from old.frozen_at
  ) then
    raise exception using errcode = '55000', message = 'Frozen dataset content and provenance are immutable';
  end if;
  if new.status <> old.status and not (old.status = 'building' and new.status = 'frozen')
    and not (old.status = 'frozen' and new.status = 'archived') then
    raise exception using errcode = '22023', message = 'Invalid dataset status transition';
  end if;

  if new.status = 'frozen' then
    if new.frozen_at is null or new.content_hash is null then
      raise exception using errcode = '22023', message = 'Frozen dataset needs a hash and frozen_at timestamp';
    end if;
    select count(*) into actual_count
      from public.humanization_dataset_entries as e
     where e.dataset_id = new.id;
    if new.entry_count <> actual_count then
      raise exception using errcode = '22023',
        message = format('Dataset entry_count %s does not match %s entries', new.entry_count, actual_count);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.humanization_guard_dataset_entry()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  dataset_status text;
begin
  if tg_op = 'INSERT' then
    select status into dataset_status from public.humanization_datasets where id = new.dataset_id;
    if dataset_status <> 'building' then
      raise exception using errcode = '55000', message = 'Entries can only be added to a building dataset';
    end if;
    return new;
  end if;
  raise exception using errcode = '55000', message = 'Dataset entries are append-only and immutable';
end;
$$;

create or replace function public.humanization_sync_dataset_entry_count()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  update public.humanization_datasets
     set entry_count = entry_count + 1
   where id = new.dataset_id;
  return new;
end;
$$;

create or replace function public.humanization_guard_candidate()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Tutor candidates are append-only; retire instead of deleting';
  end if;
  if tg_op = 'INSERT' then
    perform public.humanization_require_user_role(new.created_by, 'admin');
    return new;
  end if;
  if new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'Candidate provenance is immutable';
  end if;
  if old.status <> 'draft' and (
    new.name is distinct from old.name or new.provider is distinct from old.provider
    or new.model is distinct from old.model or new.prompt_version is distinct from old.prompt_version
    or new.instructions is distinct from old.instructions or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using errcode = '55000', message = 'Evaluated or retired candidate content is immutable';
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('evaluated', 'retired'))
    or (old.status = 'evaluated' and new.status = 'retired')
  ) then
    raise exception using errcode = '22023', message = 'Invalid tutor candidate status transition';
  end if;
  return new;
end;
$$;

create or replace function public.humanization_guard_eval_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  dataset_status text;
  candidate_status text;
begin
  if tg_op = 'INSERT' then
    perform public.humanization_require_user_role(new.created_by, 'admin');
    if new.status <> 'pending' then
      raise exception using errcode = '22023', message = 'A new evaluation run must start in pending status';
    end if;
    select status into dataset_status from public.humanization_datasets where id = new.dataset_id;
    select status into candidate_status from public.tutor_candidates where id = new.candidate_id;
    if dataset_status <> 'frozen' then
      raise exception using errcode = '55000', message = 'Evaluation requires a frozen dataset';
    end if;
    if candidate_status = 'retired' then
      raise exception using errcode = '55000', message = 'A retired candidate cannot be evaluated';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Evaluation runs are append-only';
  end if;

  if new.dataset_id is distinct from old.dataset_id or new.candidate_id is distinct from old.candidate_id
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'Evaluation run provenance is immutable';
  end if;
  if new.status <> old.status and not (
    (old.status = 'pending' and new.status in ('running', 'failed'))
    or (old.status = 'running' and new.status in ('completed', 'failed'))
  ) then
    raise exception using errcode = '22023', message = 'Invalid evaluation run status transition';
  end if;
  if old.status in ('completed', 'failed') and (
    new.status is distinct from old.status
    or new.baseline_metrics is distinct from old.baseline_metrics
    or new.candidate_metrics is distinct from old.candidate_metrics
    or new.metric_deltas is distinct from old.metric_deltas
    or new.gate_result is distinct from old.gate_result
    or new.error is distinct from old.error
    or new.completed_at is distinct from old.completed_at
  ) then
    raise exception using errcode = '55000', message = 'Terminal evaluation runs are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.humanization_guard_experiment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  run_candidate uuid;
  run_status text;
  gate_passed boolean;
  source_sample_count integer;
  source_reviewer_count integer;
begin
  if tg_op = 'INSERT' then
    perform public.humanization_require_user_role(new.created_by, 'admin');
    select candidate_id, status, (gate_result ->> 'passed')::boolean
      into run_candidate, run_status, gate_passed
      from public.humanization_eval_runs where id = new.eval_run_id;
    if run_candidate is distinct from new.candidate_id or run_status <> 'completed'
      or gate_passed is distinct from true then
      raise exception using errcode = '55000', message = 'Experiment must reference a passed completed run for the same candidate';
    end if;
    select count(*), count(distinct entry.sample ->> 'reviewerPseudonym')
      into source_sample_count, source_reviewer_count
      from public.humanization_dataset_entries as entry
      join public.humanization_eval_runs as run on run.dataset_id = entry.dataset_id
     where run.id = new.eval_run_id;
    if source_sample_count < 20 or source_reviewer_count < 2 then
      raise exception using errcode = '55000', message = 'Experiment requires at least 20 frozen samples from two faculty reviewers';
    end if;
    if new.mode = 'ab' and new.status = 'running' and not exists (
      select 1
        from public.humanization_experiments as shadow
       where shadow.eval_run_id = new.eval_run_id
         and shadow.mode = 'shadow'
         and shadow.status in ('paused', 'completed')
         and exists (
           select 1 from public.humanization_shadow_results as result
            where result.experiment_id = shadow.id
         )
         and not exists (
           select 1 from public.humanization_shadow_results as result
            where result.experiment_id = shadow.id and not result.safety_passed
         )
    ) then
      raise exception using errcode = '55000', message = 'A/B requires a completed shadow observation with recorded results';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Experiments are append-only';
  end if;
  if new.candidate_id is distinct from old.candidate_id or new.eval_run_id is distinct from old.eval_run_id
    or new.mode is distinct from old.mode or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'Experiment identity and mode are immutable';
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status = 'running')
    or (old.status = 'running' and new.status in ('paused', 'completed'))
    or (old.status = 'paused' and new.status in ('running', 'completed'))
  ) then
    raise exception using errcode = '22023', message = 'Invalid experiment status transition';
  end if;
  if old.status = 'completed' and (
    new.name is distinct from old.name
    or new.status is distinct from old.status
    or new.traffic_percent is distinct from old.traffic_percent
    or new.started_at is distinct from old.started_at
    or new.ended_at is distinct from old.ended_at
  ) then
    raise exception using errcode = '55000', message = 'Completed experiments are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.humanization_guard_experiment_assignment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  experiment_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'Experiment assignments are immutable';
  end if;
  select status into experiment_status from public.humanization_experiments where id = new.experiment_id;
  if experiment_status not in ('draft', 'running') then
    raise exception using errcode = '55000', message = 'Assignments require a draft or running experiment';
  end if;
  return new;
end;
$$;

create or replace function public.humanization_guard_shadow_result()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  experiment_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'Shadow results are immutable';
  end if;
  select status into experiment_status from public.humanization_experiments where id = new.experiment_id;
  if experiment_status <> 'running' then
    raise exception using errcode = '55000', message = 'Shadow results require a running experiment';
  end if;
  return new;
end;
$$;

create or replace function public.humanization_guard_approval()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  run_status text;
begin
  if tg_op = 'INSERT' then
    perform public.humanization_require_user_role(new.professor_id, 'professor');
    select status into run_status from public.humanization_eval_runs where id = new.eval_run_id;
    if run_status <> 'completed' then
      raise exception using errcode = '55000', message = 'Faculty approval requires a completed evaluation run';
    end if;
    if not exists (
      select 1
        from public.humanization_experiments as experiment
       where experiment.eval_run_id = new.eval_run_id
         and experiment.mode = 'ab'
         and experiment.status in ('running', 'paused', 'completed')
         and exists (
           select 1 from public.humanization_shadow_results as result
            where result.experiment_id = experiment.id
         )
         and not exists (
           select 1 from public.humanization_shadow_results as result
            where result.experiment_id = experiment.id and not result.safety_passed
         )
    ) then
      raise exception using errcode = '55000', message = 'Faculty approval requires observed limited A/B evidence';
    end if;
    return new;
  end if;
  raise exception using errcode = '55000', message = 'Faculty approvals are append-only';
end;
$$;

create or replace function public.humanization_guard_release()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  run_candidate uuid;
  run_status text;
  gate_passed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Tutor releases are append-only; roll back instead of deleting';
  end if;
  if tg_op = 'INSERT' then
    perform public.humanization_require_user_role(new.released_by, 'admin');
    if new.status <> 'active' then
      raise exception using errcode = '22023', message = 'A new tutor release must start in active status';
    end if;
    select candidate_id, status, (gate_result ->> 'passed')::boolean
      into run_candidate, run_status, gate_passed
      from public.humanization_eval_runs where id = new.eval_run_id;
    if run_candidate is distinct from new.candidate_id or run_status <> 'completed' or gate_passed is distinct from true then
      raise exception using errcode = '55000', message = 'Release requires a passed completed evaluation for the same candidate';
    end if;
    if not exists (
      select 1 from public.faculty_release_approvals as a
       where a.eval_run_id = new.eval_run_id and a.decision = 'approved'
    ) then
      raise exception using errcode = '55000', message = 'Release requires at least one faculty approval';
    end if;
    if exists (
      select 1 from public.faculty_release_approvals as a
       where a.eval_run_id = new.eval_run_id and a.decision = 'rejected'
    ) then
      raise exception using errcode = '55000', message = 'Release is blocked by a faculty rejection';
    end if;
    if not exists (
      select 1 from public.humanization_experiments as experiment
       where experiment.eval_run_id = new.eval_run_id
         and experiment.mode = 'ab'
         and experiment.status = 'running'
    ) then
      raise exception using errcode = '55000', message = 'Release requires a running limited A/B experiment';
    end if;
    if exists (
      select 1
        from public.humanization_shadow_results as result
        join public.humanization_experiments as experiment on experiment.id = result.experiment_id
       where experiment.eval_run_id = new.eval_run_id
         and experiment.mode = 'ab'
         and not result.safety_passed
    ) then
      raise exception using errcode = '55000', message = 'Release is blocked by an A/B safety regression';
    end if;
    return new;
  end if;
  if new.candidate_id is distinct from old.candidate_id or new.eval_run_id is distinct from old.eval_run_id
    or new.released_by is distinct from old.released_by or new.created_at is distinct from old.created_at
    or new.traffic_percent is distinct from old.traffic_percent or new.release_notes is distinct from old.release_notes then
    raise exception using errcode = '55000', message = 'Release provenance is immutable';
  end if;
  if old.status <> 'active' or new.status <> 'rolled_back' then
    raise exception using errcode = '55000', message = 'Only an active release can be rolled back';
  end if;
  if new.rolled_back_by is null or new.rolled_back_at is null
    or new.rollback_reason is null or length(btrim(new.rollback_reason)) = 0 then
    raise exception using errcode = '22023', message = 'Rollback requires actor, timestamp, and reason';
  end if;
  perform public.humanization_require_user_role(new.rolled_back_by, 'admin');
  return new;
end;
$$;

create or replace function public.humanization_record_release_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tutor_release_events (release_id, event_type, actor_id, notes)
    values (new.id, 'released', new.released_by, new.release_notes);
  elsif old.status is distinct from new.status and new.status = 'rolled_back' then
    insert into public.tutor_release_events (release_id, event_type, actor_id, notes)
    values (new.id, 'rolled_back', coalesce(new.rolled_back_by, new.released_by), new.rollback_reason);
  end if;
  return new;
end;
$$;

create or replace function public.humanization_guard_release_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'Release history is append-only';
  end if;
  perform public.humanization_require_user_role(new.actor_id, 'admin');
  return new;
end;
$$;

create trigger humanization_datasets_guard
before insert or update or delete on public.humanization_datasets
for each row execute function public.humanization_guard_dataset();

create trigger humanization_dataset_entries_guard
before insert or update or delete on public.humanization_dataset_entries
for each row execute function public.humanization_guard_dataset_entry();

create trigger humanization_dataset_entries_count
after insert on public.humanization_dataset_entries
for each row execute function public.humanization_sync_dataset_entry_count();

create trigger tutor_candidates_guard
before insert or update on public.tutor_candidates
for each row execute function public.humanization_guard_candidate();

create trigger humanization_eval_runs_guard
before insert or update or delete on public.humanization_eval_runs
for each row execute function public.humanization_guard_eval_run();

create trigger humanization_experiments_guard
before insert or update or delete on public.humanization_experiments
for each row execute function public.humanization_guard_experiment();

create trigger humanization_experiment_assignments_guard
before insert or update or delete on public.humanization_experiment_assignments
for each row execute function public.humanization_guard_experiment_assignment();

create trigger humanization_shadow_results_guard
before insert or update or delete on public.humanization_shadow_results
for each row execute function public.humanization_guard_shadow_result();

create trigger faculty_release_approvals_guard
before insert or update or delete on public.faculty_release_approvals
for each row execute function public.humanization_guard_approval();

create trigger tutor_releases_guard
before insert or update or delete on public.tutor_releases
for each row execute function public.humanization_guard_release();

create trigger tutor_release_events_audit
after insert or update on public.tutor_releases
for each row execute function public.humanization_record_release_event();

create trigger tutor_release_events_guard
before insert or update or delete on public.tutor_release_events
for each row execute function public.humanization_guard_release_event();

alter table public.humanization_datasets enable row level security;
alter table public.humanization_dataset_entries enable row level security;
alter table public.tutor_candidates enable row level security;
alter table public.humanization_eval_runs enable row level security;
alter table public.humanization_experiments enable row level security;
alter table public.humanization_experiment_assignments enable row level security;
alter table public.humanization_shadow_results enable row level security;
alter table public.faculty_release_approvals enable row level security;
alter table public.tutor_releases enable row level security;
alter table public.tutor_release_events enable row level security;

revoke all on table public.humanization_datasets from public, anon, authenticated;
revoke all on table public.humanization_dataset_entries from public, anon, authenticated;
revoke all on table public.tutor_candidates from public, anon, authenticated;
revoke all on table public.humanization_eval_runs from public, anon, authenticated;
revoke all on table public.humanization_experiments from public, anon, authenticated;
revoke all on table public.humanization_experiment_assignments from public, anon, authenticated;
revoke all on table public.humanization_shadow_results from public, anon, authenticated;
revoke all on table public.faculty_release_approvals from public, anon, authenticated;
revoke all on table public.tutor_releases from public, anon, authenticated;
revoke all on table public.tutor_release_events from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on table public.humanization_datasets to service_role;
grant all on table public.humanization_dataset_entries to service_role;
grant all on table public.tutor_candidates to service_role;
grant all on table public.humanization_eval_runs to service_role;
grant all on table public.humanization_experiments to service_role;
grant all on table public.humanization_experiment_assignments to service_role;
grant all on table public.humanization_shadow_results to service_role;
grant all on table public.faculty_release_approvals to service_role;
grant all on table public.tutor_releases to service_role;
grant all on table public.tutor_release_events to service_role;

revoke all on function public.humanization_sample_is_deidentified(jsonb) from public, anon, authenticated;
revoke all on function public.humanization_require_user_role(uuid, text) from public, anon, authenticated;
revoke all on function public.humanization_guard_dataset() from public, anon, authenticated;
revoke all on function public.humanization_guard_dataset_entry() from public, anon, authenticated;
revoke all on function public.humanization_sync_dataset_entry_count() from public, anon, authenticated;
revoke all on function public.humanization_guard_candidate() from public, anon, authenticated;
revoke all on function public.humanization_guard_eval_run() from public, anon, authenticated;
revoke all on function public.humanization_guard_experiment() from public, anon, authenticated;
revoke all on function public.humanization_guard_experiment_assignment() from public, anon, authenticated;
revoke all on function public.humanization_guard_shadow_result() from public, anon, authenticated;
revoke all on function public.humanization_guard_approval() from public, anon, authenticated;
revoke all on function public.humanization_guard_release() from public, anon, authenticated;
revoke all on function public.humanization_record_release_event() from public, anon, authenticated;
revoke all on function public.humanization_guard_release_event() from public, anon, authenticated;
grant execute on function public.humanization_sample_is_deidentified(jsonb) to service_role;
grant execute on function public.humanization_require_user_role(uuid, text) to service_role;

commit;
