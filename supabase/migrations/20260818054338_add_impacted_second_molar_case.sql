begin;

-- Keep the authoritative faculty case narrative available to the tutor as
-- case context; phase rubrics and guidance below act as the curated knowledge.
update public.cases
set presenting_complaint = 'A 12-year-old patient is referred by a general dental practitioner because the upper right permanent canine has not erupted. The primary canine on that side remains present. The patient has a Class I molar relationship with mild upper-arch crowding, and a panoramic radiograph is available.',
    patient_context = coalesce(patient_context, '{}'::jsonb) || '{"age":12,"dentition":"mixed","chief_complaint":"unerupted upper right canine","imaging_available":["panoramic"]}'::jsonb,
    updated_at = timezone('utc', now())
where id = '33333333-3333-4333-8333-333333333333'::uuid;

-- Faculty-scripted six-phase teaching case. It contains synthetic teaching
-- content only and stores authoring extensions in existing JSONB fields.
insert into public.cases (
  id, slug, title, specialty, diagnosis, presenting_complaint, status,
  patient_context, tags, created_by, source_case_id, version, published_at
)
select
  '33333333-3333-4333-8333-333333333337'::uuid,
  'impacted-mandibular-second-molar',
  'Impacted Mandibular Second Molar',
  'orthodontics',
  null,
  'A 14-year-old patient is referred because the mandibular right second molar has not erupted. The first molars and premolars are fully erupted; the patient has a Class I molar relationship, a well-aligned upper arch, and mild lower-arch crowding. A panoramic radiograph shows about 40 degrees of mesial inclination, the crown contacting the distal surface of the first molar, three-quarters root formation, and a developing third-molar bud distally.',
  'active'::public.case_status,
  '{"age":14,"simulation":true,"imaging_available":["panoramic"],"attachments":[]}'::jsonb,
  array['impacted second molar','orthodontics','biomechanics','clinical reasoning']::text[],
  admin_user.id,
  null,
  1,
  '2026-08-18T00:00:00Z'::timestamptz
from public.users as admin_user
where admin_user.id = '99999999-9999-4999-8999-999999999999'::uuid
on conflict (id) do nothing;

-- Attach the core faculty-scripted moves to the existing canine phases. The
-- JSON keys below are authoring metadata, never evaluator rubric tokens.
update public.case_phases
set metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["clinical palpation","panoramic radiograph","parallax","position","CBCT justification"],"tutorGuidance":["Challenge premature advanced imaging, begin with clinical examination, and deliberately return to an earlier CBCT jump after first-line imaging has been discussed."],"tutorMoves":[{"id":"canine-premature-cbct","strategy":"challenge","question":"Before requesting any imaging, what could you learn from examining the patient?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["cbct"],"answerOmitsAll":["clinical","palpation","palpate","opg","panoramic","parallax"],"recordError":"Premature CBCT escalation before clinical examination and first-line imaging","blockAdvancement":true},{"id":"canine-revisit-cbct","strategy":"probe","question":"You mentioned CBCT earlier. What remaining uncertainty would justify it after clinical examination and first-line imaging?","classifications":["correct"],"previousErrorIncludesAny":["premature cbct"],"blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444442'::uuid;

update public.case_phases
set metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["root resorption","adjacent incisor","space","angulation","patient age and root development","prognosis"],"tutorGuidance":["An OPG cannot establish bucco-palatal position. Expose that assumption, then force a patient-specific commitment."],"tutorMoves":[{"id":"canine-opg-palatal-assumption","strategy":"challenge","question":"How do you know the canine is palatally displaced from an OPG alone?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["palatal","palatally"],"answerOmitsAll":["parallax","cbct","tube shift","cannot tell","can't tell","cannot show","can't show","does not show","doesn't show","2d","two-dimensional"],"recordError":"Inferred a bucco-palatal position from a two-dimensional OPG","blockAdvancement":true},{"id":"canine-management-commitment","strategy":"challenge","question":"For this patient, would you observe after primary-canine extraction or create orthodontic space at the same time, and why?","classifications":["correct"],"blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444443'::uuid;

update public.case_phases
set metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["interceptive extraction","space creation","surgical exposure","orthodontic traction","monitoring"],"tutorGuidance":["Require the direction of traction and anchorage consequences, not only the procedure name."],"tutorMoves":[{"id":"canine-unsafe-traction-vector","strategy":"challenge","question":"Where is the canine crown relative to the lateral incisor root before you pull it down?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["down into the arch","straight down","pull it down","vertically into the arch"],"answerOmitsAll":["distal","away from","clear the root"],"recordError":"Proposed pulling the canine across the lateral incisor root","blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444444'::uuid;

update public.case_phases
set questions = array['Why not extract the impacted canine and place an implant later?','What new evidence would make you revise your plan?','Where were you most at risk of jumping to a conclusion?']::text[],
    metadata = coalesce(metadata, '{}'::jsonb) || $json${"rubric":["evidence","uncertainty","assumption","alternative","reassessment","reflection"],"tutorGuidance":["Begin with a plausible alternative viewpoint, then end with a metacognitive question about the highest-leverage decision point."],"tutorMoves":[{"id":"canine-metacognitive-closure","strategy":"reflect","question":"Looking back at the whole case, where was the highest-leverage decision point, and what should a general dentist know?","classifications":["correct"],"blockAdvancement":true}]}$json$::jsonb
where id = '44444444-4444-4444-8444-444444444445'::uuid;

insert into public.case_phases (
  id, case_id, phase_order, phase_key, title, objectives, questions,
  teaching_notes, expected_findings, metadata
)
values
  (
    '44444444-4444-4444-8444-444444444481'::uuid,
    '33333333-3333-4333-8333-333333333337'::uuid,
    1,
    'problem_identification',
    'Problem Identification',
    array['Distinguish a delayed second molar from an impacted tooth and explain why the distinction matters.','eruption timing and normal variation','mesial angulation','diagnostic criteria','risk to the first molar','pericoronal pathology']::text[],
    array['What stands out to you in this case?','What would need to be true for you to call this impacted rather than delayed?']::text[],
    'Challenge premature diagnostic labels and use spatial cues to explore consequences for the adjacent first molar.',
    '{}'::jsonb,
    $json${"rubric":["eruption timing and normal variation","mesial angulation","diagnostic criteria","risk to the first molar","pericoronal pathology"],"tutorGuidance":["Challenge premature diagnostic labels and use spatial cues to explore consequences for the adjacent first molar."],"tutorMoves":[{"id":"molar-premature-diagnosis","strategy":"challenge","question":"What would need to be true for you to call it impacted rather than delayed?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["impacted","impaction"],"answerOmitsAll":["age","eruption","angulation","root development"],"recordError":"Called the second molar impacted before establishing diagnostic criteria","blockAdvancement":true}]}$json$::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444482'::uuid,
    '33333333-3333-4333-8333-333333333337'::uuid,
    2,
    'eruption_potential',
    'Assessing Eruption Potential',
    array['Judge observation versus intervention by integrating eruption potential rather than relying on one variable.','angulation severity','root development','patient age','available space','spontaneous correction','observation threshold']::text[],
    array['Does this tooth need treatment now, or could it still erupt on its own?','What if the angulation were 15 degrees rather than 40 degrees?']::text[],
    'Use a 15-degree hypothetical to expose single-variable reasoning and compare age, root development and space before forcing a decision.',
    '{}'::jsonb,
    $json${"rubric":["angulation severity","root development","patient age","available space","spontaneous correction","observation threshold"],"tutorGuidance":["Use a 15-degree hypothetical to expose single-variable reasoning and compare age, root development and space before forcing a decision."],"tutorMoves":[{"id":"molar-single-variable-angulation","strategy":"challenge","question":"What if the angulation were 15 degrees rather than 40 degrees; how would your decision change?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["40 degrees","40-degree","angulation","angle"],"answerOmitsAll":["age","root","space"],"recordError":"Based the intervention decision on angulation alone","blockAdvancement":true}]}$json$::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444483'::uuid,
    '33333333-3333-4333-8333-333333333337'::uuid,
    3,
    'space_and_third_molar',
    'Space Assessment and Treatment Planning',
    array['Assess the space required for uprighting and account for the developing third molar.','space distal to the first molar','third molar position','distal uprighting path','irreversible trade-off','consent']::text[],
    array['Before uprighting, what must be true about the space distal to the first molar?','What is sitting directly behind the second molar?']::text[],
    'If the third molar is omitted, use the spatial cue from the script rather than naming it.',
    '{}'::jsonb,
    $json${"rubric":["space distal to the first molar","third molar position","distal uprighting path","irreversible trade-off","consent"],"tutorGuidance":["If the third molar is omitted, use the spatial cue from the script rather than naming it."],"tutorMoves":[{"id":"molar-third-molar-omission","strategy":"scaffold","question":"Looking at the radiograph, what is sitting directly behind the second molar?","classifications":["correct","partial","vague","wrong"],"answerOmitsAll":["third molar","third-molar","wisdom tooth"],"recordError":"Omitted the developing third molar from the space assessment","blockAdvancement":true}]}$json$::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444484'::uuid,
    '33333333-3333-4333-8333-333333333337'::uuid,
    4,
    'biomechanics',
    'Biomechanics',
    array['Specify a safe uprighting force system, its moment and anchorage consequences.','distally directed crown force','moment and tipping','centre of resistance','reactive mesial force','anchorage reinforcement','direct or indirect anchorage']::text[],
    array['Describe the force system you would use to upright the second molar.','What force and moment do you need, and what controls the reaction?']::text[],
    'Ask for force, moment and anchorage specificity. Allow visible mid-sentence self-correction before intervening.',
    '{}'::jsonb,
    $json${"rubric":["distally directed crown force","moment and tipping","centre of resistance","reactive mesial force","anchorage reinforcement","direct or indirect anchorage"],"tutorGuidance":["Ask for force, moment and anchorage specificity. Allow visible mid-sentence self-correction before intervening."],"tutorMoves":[{"id":"molar-vague-biomechanics","strategy":"clarify","question":"When you say upright it, what force, moment and anchorage control do you need?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["upright","spring","elastic","tip"],"answerOmitsAll":["force","moment","anchorage"],"recordError":"Described uprighting without specifying force, moment or anchorage","blockAdvancement":true}]}$json$::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444485'::uuid,
    '33333333-3333-4333-8333-333333333337'::uuid,
    5,
    'surgical_access',
    'Surgical Considerations',
    array['Determine whether surgical access is required and communicate the mechanical requirements to the surgeon.','crown accessibility','surgical exposure','conservative bone removal','attachment placement','force direction','flap design']::text[],
    array['Can you always bond an attachment to the second molar and start treatment?','Can you see the crown in the patient''s mouth?']::text[],
    'Expose a false assumption about access with a spatial question; do not announce the need for surgery.',
    '{}'::jsonb,
    $json${"rubric":["crown accessibility","surgical exposure","conservative bone removal","attachment placement","force direction","flap design"],"tutorGuidance":["Expose a false assumption about access with a spatial question; do not announce the need for surgery."],"tutorMoves":[{"id":"molar-false-access-assumption","strategy":"challenge","question":"The crown is tipped under the distal surface of the first molar; can you see it in the patient's mouth?","classifications":["correct","partial","vague","wrong"],"answerIncludesAny":["bond","attachment","bracket","button"],"answerOmitsAll":["surgical","exposure","flap","bone"],"recordError":"Assumed the second-molar crown was accessible for bonding","blockAdvancement":true}]}$json$::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444486'::uuid,
    '33333333-3333-4333-8333-333333333337'::uuid,
    6,
    'reflection_and_synthesis',
    'Reflection and Synthesis',
    array['Evaluate a plausible extraction alternative and identify the most consequential decision point.','second-molar prognosis','third-molar position and development','patient age','eruption potential','alternative viewpoint','consequential decision point','cross-case principle']::text[],
    array['Why not extract the impacted second molar and let the third molar drift forward?','Are there situations where that alternative might be reasonable?']::text[],
    'Push back on blanket dismissal of the extraction alternative, then close with a highest-leverage reflection and cross-case integration.',
    '{}'::jsonb,
    $json${"rubric":["second-molar prognosis","third-molar position and development","patient age","eruption potential","alternative viewpoint","consequential decision point","cross-case principle"],"tutorGuidance":["Push back on blanket dismissal of the extraction alternative, then close with a highest-leverage reflection and cross-case integration."],"tutorMoves":[{"id":"molar-nuance-alternative","strategy":"challenge","question":"In what situation might extracting the second molar and relying on the third molar be reasonable?","classifications":["partial","vague","wrong"],"answerIncludesAny":["no guarantee","would not extract","wouldn't extract","too risky","gambling"]},{"id":"molar-metacognitive-closure","strategy":"reflect","question":"Across the whole case, where was the single most consequential decision point, and why?","classifications":["correct"],"blockAdvancement":true}]}$json$::jsonb
  )
on conflict (id) do nothing;

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at, due_at
)
select
  '66666666-6666-4666-8666-666666666670'::uuid,
  demo_class.id,
  teaching_case.id,
  professor.id,
  'open',
  '2026-08-18T00:00:00Z'::timestamptz,
  null
from public.classes as demo_class
join public.users as professor
  on professor.id = '22222222-2222-4222-8222-222222222222'::uuid
join public.cases as teaching_case
  on teaching_case.id = '33333333-3333-4333-8333-333333333337'::uuid
where demo_class.id = '55555555-5555-4555-8555-555555555555'::uuid
on conflict (id) do nothing;

commit;
