-- Deterministic, idempotent POC fixtures.  These rows intentionally do not
-- create auth.users records; public.users.auth_user_id can be linked when a
-- local/remote Auth account is provisioned.

insert into public.users (
  id,
  email,
  display_name,
  role,
  profile
)
values
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'alicia.tan@u.nus.edu',
    'Alicia Tan',
    'student'::public.user_role,
    '{"program":"DMD","year":3,"learning_goal":"diagnostic reasoning"}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    'marcus.lim@nus.edu.sg',
    'Prof. Marcus Lim',
    'professor'::public.user_role,
    '{"specialty":"orthodontics","institution":"POC Dental School"}'::jsonb
  ),
  (
    '11111111-1111-4111-8111-111111111112'::uuid,
    'benjamin.lee@u.nus.edu',
    'Benjamin Lee',
    'student'::public.user_role,
    '{"program":"DMD","year":3}'::jsonb
  ),
  (
    '11111111-1111-4111-8111-111111111113'::uuid,
    'chloe.wong@u.nus.edu',
    'Chloe Wong',
    'student'::public.user_role,
    '{"program":"DMD","year":3}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222223'::uuid,
    'sarah.ng@nus.edu.sg',
    'Prof. Sarah Ng',
    'professor'::public.user_role,
    '{"specialty":"orthodontics","institution":"POC Dental School"}'::jsonb
  ),
  (
    '99999999-9999-4999-8999-999999999999'::uuid,
    'elaine.koh@nus.edu.sg',
    'Dr. Elaine Koh',
    'admin'::public.user_role,
    '{"title":"Programme administrator","institution":"POC Dental School"}'::jsonb
  )
on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      profile = excluded.profile,
      updated_at = timezone('utc', now());

insert into public.cases (
  id,
  slug,
  title,
  specialty,
  diagnosis,
  presenting_complaint,
  status,
  patient_context,
  tags,
  created_by,
  source_case_id,
  version,
  published_at
)
values (
  '33333333-3333-4333-8333-333333333333'::uuid,
  'impacted-maxillary-canine',
  'Impacted Maxillary Canine',
  'orthodontics',
  null,
  'A 12-year-old patient is referred by a general dental practitioner because the upper right permanent canine has not erupted. The primary canine on that side remains present. The patient has a Class I molar relationship with mild upper-arch crowding, and a panoramic radiograph is available.',
  'active'::public.case_status,
  '{"age":12,"dentition":"mixed","chief_complaint":"unerupted upper right canine","imaging_available":["panoramic"]}'::jsonb,
  array['impacted canine','maxillary canine','orthodontics']::text[],
  '99999999-9999-4999-8999-999999999999'::uuid,
  null,
  1,
  '2026-08-09T00:00:00Z'::timestamptz
)
on conflict (id) do update
  set slug = excluded.slug,
      title = excluded.title,
      specialty = excluded.specialty,
      diagnosis = excluded.diagnosis,
      presenting_complaint = excluded.presenting_complaint,
      status = excluded.status,
      patient_context = excluded.patient_context,
      tags = excluded.tags,
      created_by = excluded.created_by,
      source_case_id = excluded.source_case_id,
      version = excluded.version,
      published_at = excluded.published_at,
      updated_at = timezone('utc', now());

insert into public.classes (id, name, code, term, status, created_by)
values (
  '55555555-5555-4555-8555-555555555555'::uuid,
  'Orthodontic Reasoning Demo',
  'DENT-DEMO',
  'AY2026/27',
  'active',
  '99999999-9999-4999-8999-999999999999'::uuid
)
on conflict (id) do update
  set name = excluded.name,
      code = excluded.code,
      term = excluded.term,
      status = excluded.status,
      updated_at = timezone('utc', now());

insert into public.class_memberships (class_id, user_id, role, is_lead)
values
  ('55555555-5555-4555-8555-555555555555'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'student', false),
  ('55555555-5555-4555-8555-555555555555'::uuid, '11111111-1111-4111-8111-111111111112'::uuid, 'student', false),
  ('55555555-5555-4555-8555-555555555555'::uuid, '11111111-1111-4111-8111-111111111113'::uuid, 'student', false),
  ('55555555-5555-4555-8555-555555555555'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'professor', true),
  ('55555555-5555-4555-8555-555555555555'::uuid, '22222222-2222-4222-8222-222222222223'::uuid, 'professor', false)
on conflict (class_id, user_id) do update
  set role = excluded.role,
      is_lead = excluded.is_lead,
      updated_at = timezone('utc', now());

insert into public.class_case_assignments (id, class_id, case_id, assigned_by, status, opens_at, due_at)
values (
  '66666666-6666-4666-8666-666666666666'::uuid,
  '55555555-5555-4555-8555-555555555555'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  'open',
  '2026-08-09T00:00:00Z'::timestamptz,
  null
)
on conflict (id) do update
  set class_id = excluded.class_id,
      case_id = excluded.case_id,
      assigned_by = excluded.assigned_by,
      status = excluded.status,
      opens_at = excluded.opens_at,
      due_at = excluded.due_at,
      updated_at = timezone('utc', now());

insert into public.case_phases (
  id,
  case_id,
  phase_order,
  phase_key,
  title,
  objectives,
  questions,
  teaching_notes,
  expected_findings,
  metadata
)
values
  (
    '44444444-4444-4444-8444-444444444441'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    1,
    'history',
    'Problem Identification',
    array[
      'Identify the central clinical concern without jumping to a definitive diagnosis',
      'Relate eruption asymmetry and timing to clinical significance'
    ]::text[],
    array[
      'What concerns you most about this presentation, and why?',
      'What makes delayed eruption clinically significant in this patient?'
    ]::text[],
    'Start with the patient narrative and avoid anchoring on the radiograph before gathering context.',
    '{"age":12,"key_history":["delayed eruption","no relevant trauma","good general health"]}'::jsonb,
    '{"checkpoint":"history_complete"}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444442'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    2,
    'examination_imaging',
    'Clinical & Radiographic Assessment',
    array[
      'Build a proportionate clinical and radiographic assessment strategy',
      'Justify when three-dimensional imaging would resolve a material uncertainty'
    ]::text[],
    array[
      'How would you investigate the position of the canine step by step?',
      'Why might CBCT not always be the first investigation?'
    ]::text[],
    'Ask the learner to state what each image adds and to identify adjacent-root risk.',
    '{"clinical":["retained_primary_canine","bulge_on_palatal_mucosa"],"imaging":["palatal_position","mesial_tilt","root_proximity_to_lateral_incisor"]}'::jsonb,
    '{"checkpoint":"exam_and_imaging_interpreted"}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444443'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    3,
    'diagnosis_risk',
    'Risk Assessment & Decision Making',
    array[
      'State a defensible diagnosis and relevant differentials',
      'Identify risks of observation, exposure, traction, and extraction'
    ]::text[],
    array[
      'What findings would make you revise the working diagnosis?',
      'Which risks must be discussed before choosing an intervention?'
    ]::text[],
    'Make uncertainty explicit and connect each risk to a finding or missing piece of evidence.',
    '{"working_diagnosis":"palatal impaction of #13","risks":["ankylosis","root_resorption","space_loss","surgical_morbidity"]}'::jsonb,
    '{"checkpoint":"diagnosis_and_risks_stated"}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444444'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    4,
    'treatment_planning',
    'Management',
    array[
      'Compare observation, surgical exposure with orthodontic traction, and extraction options',
      'Design a phased plan with referral, space management, and monitoring'
    ]::text[],
    array[
      'Which option best fits the current position and periodontal prognosis?',
      'How would you sequence space creation, exposure, traction, and review?'
    ]::text[],
    'Require the learner to justify timing and alternatives rather than naming a single procedure.',
    '{"preferred_path":"space creation plus surgical exposure and orthodontic traction","dependencies":["periodontal assessment","orthodontic space","surgeon coordination"]}'::jsonb,
    '{"checkpoint":"plan_justified"}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444445'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid,
    5,
    'shared_decision_follow_up',
    'Reflection & Synthesis',
    array[
      'Make the reasoning process and its assumptions explicit',
      'Identify evidence that would justify revising the plan'
    ]::text[],
    array[
      'Looking back, which assumption had the greatest influence on your decision?',
      'What new evidence would make you revise your plan?'
    ]::text[],
    'Close with teach-back, consent, and a follow-up plan that names escalation triggers.',
    '{"communication":["teach_back","consent","expectation_setting"],"follow_up":["eruption_progress","periodontal_health","root_resorption_monitoring"]}'::jsonb,
    '{"checkpoint":"plan_communicated_and_follow_up_set"}'::jsonb
  )
on conflict (id) do update
  set case_id = excluded.case_id,
      phase_order = excluded.phase_order,
      phase_key = excluded.phase_key,
      title = excluded.title,
      objectives = excluded.objectives,
      questions = excluded.questions,
      teaching_notes = excluded.teaching_notes,
      expected_findings = excluded.expected_findings,
      -- Migrations may add faculty-authored rubric/guidance/moves before the
      -- development seed runs. Preserve those keys while refreshing the seed
      -- checkpoint so a database reset cannot silently remove tutor behaviour.
      metadata = coalesce(public.case_phases.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = timezone('utc', now());

-- Demo phase rows are created by this seed after every migration has already
-- run. Apply the faculty-scripted metadata here as well as in the deployment
-- migration so a clean local reset and an existing hosted database converge
-- on the same tutor behaviour.
update public.case_phases
set metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["unerupted or delayed eruption","eruption asymmetry","possible impaction","age or eruption timing"],"tutorGuidance":["Withhold the diagnosis, distinguish observation from clinical significance, and use a spatial cue before naming adjacent-root harm."],"tutorMoves":[]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444441'::uuid;

update public.case_phases
set metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["clinical palpation","panoramic radiograph","parallax","position","CBCT justification"],"tutorGuidance":["Challenge premature advanced imaging, begin with clinical examination, and deliberately return to an earlier CBCT jump after first-line imaging has been discussed."],"tutorMoves":[{"id":"canine-premature-cbct","strategy":"challenge","question":"Before requesting any imaging, what could you learn from examining the patient?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["cbct"],"answerOmitsAll":["clinical","palpation","palpate","opg","panoramic","parallax"],"recordError":"Premature CBCT escalation before clinical examination and first-line imaging","blockAdvancement":true},{"id":"canine-revisit-cbct","strategy":"probe","question":"You mentioned CBCT earlier. What remaining uncertainty would justify it after clinical examination and first-line imaging?","classifications":["correct"],"previousErrorIncludesAny":["premature cbct"],"blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444442'::uuid;

update public.case_phases
set metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["root resorption","adjacent incisor","space","angulation","patient age and root development","prognosis"],"tutorGuidance":["An OPG cannot establish bucco-palatal position. Expose that assumption, then force a patient-specific commitment after weighing age, root development, space, angulation and adjacent-root risk."],"tutorMoves":[{"id":"canine-opg-palatal-assumption","strategy":"challenge","question":"How do you know the canine is palatally displaced from an OPG alone?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["palatal","palatally"],"answerOmitsAll":["parallax","cbct","tube shift","cannot tell","can't tell","cannot show","can't show","does not show","doesn't show","2d","two-dimensional"],"recordError":"Inferred a bucco-palatal position from a two-dimensional OPG","blockAdvancement":true},{"id":"canine-management-commitment","strategy":"challenge","question":"For this patient, would you observe after primary-canine extraction or create orthodontic space at the same time, and why?","classifications":["correct"],"blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444443'::uuid;

update public.case_phases
set metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["interceptive extraction","space creation","surgical exposure","orthodontic traction","monitoring"],"tutorGuidance":["Require the direction of traction and anchorage consequences, not only the procedure name. If the crown overlaps the lateral root, cue the learner to move it away before bringing it into the arch."],"tutorMoves":[{"id":"canine-unsafe-traction-vector","strategy":"challenge","question":"Where is the canine crown relative to the lateral incisor root before you pull it down?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["down into the arch","straight down","pull it down","vertically into the arch"],"answerOmitsAll":["distal","away from","clear the root"],"recordError":"Proposed pulling the canine across the lateral incisor root","blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444444'::uuid;

update public.case_phases
set questions = array['Why not extract the impacted canine and place an implant later?','What new evidence would make you revise your plan?','Where were you most at risk of jumping to a conclusion?']::text[],
    metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["evidence","uncertainty","assumption","alternative","reassessment","reflection"],"tutorGuidance":["Begin with a plausible alternative viewpoint, then end with a metacognitive question about the highest-leverage decision point."],"tutorMoves":[{"id":"canine-metacognitive-closure","strategy":"reflect","question":"Looking back at the whole case, where was the highest-leverage decision point, and what should a general dentist know?","classifications":["correct"],"blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444445'::uuid;
