begin;

-- Faculty evaluation of the tutor intervention is intentionally separate from
-- answer_reviews, which calibrates the AI's judgement of the student answer.
create table public.tutor_turn_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  evaluation_id uuid not null references public.evaluations (id) on delete cascade,
  tutor_message_id uuid not null references public.messages (id) on delete cascade,
  reviewer_id uuid not null references public.users (id) on delete restrict,
  naturalness smallint not null,
  specificity smallint not null,
  non_leading smallint not null,
  challenge_fit smallint not null,
  helpfulness smallint not null,
  failure_tags text[] not null default '{}'::text[],
  preferred_rewrite text,
  comments text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tutor_turn_reviews_evaluation_unique unique (evaluation_id),
  constraint tutor_turn_reviews_tutor_message_unique unique (tutor_message_id),
  constraint tutor_turn_reviews_naturalness_range check (naturalness between 1 and 5),
  constraint tutor_turn_reviews_specificity_range check (specificity between 1 and 5),
  constraint tutor_turn_reviews_non_leading_range check (non_leading between 1 and 5),
  constraint tutor_turn_reviews_challenge_fit_range check (challenge_fit between 1 and 5),
  constraint tutor_turn_reviews_helpfulness_range check (helpfulness between 1 and 5),
  constraint tutor_turn_reviews_failure_tags_no_nulls check (array_position(failure_tags, null) is null),
  constraint tutor_turn_reviews_failure_tags_allowed check (
    failure_tags <@ array[
      'generic', 'repetitive', 'leading', 'multi_part', 'too_difficult',
      'too_easy', 'mini_lecture', 'diagnosis_leak', 'not_grounded'
    ]::text[]
  ),
  constraint tutor_turn_reviews_timestamps_order check (updated_at >= created_at)
);

create index tutor_turn_reviews_session_idx on public.tutor_turn_reviews (session_id);
create index tutor_turn_reviews_reviewer_idx on public.tutor_turn_reviews (reviewer_id);

alter table public.tutor_turn_reviews enable row level security;
revoke all on table public.tutor_turn_reviews from public, anon, authenticated;
grant all on table public.tutor_turn_reviews to service_role;

commit;
