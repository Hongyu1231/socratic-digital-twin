begin;

-- Additional text-only teaching simulations for the demo cohort. These rows
-- contain no real patient data and make no claim to provide clinical advice.
-- Minimal prerequisite identities/class make the data migration reproducible
-- during a fresh `db reset`; seed.sql later enriches these same fixed rows and
-- adds all demo memberships through idempotent upserts.

insert into public.users (id, email, display_name, role, profile)
values
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    'marcus.lim@nus.edu.sg',
    'Prof. Marcus Lim',
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
on conflict (id) do nothing;

insert into public.classes (id, name, code, term, status, created_by)
values (
  '55555555-5555-4555-8555-555555555555'::uuid,
  'Orthodontic Reasoning Demo',
  'DENT-DEMO',
  'AY2026/27',
  'active',
  '99999999-9999-4999-8999-999999999999'::uuid
)
on conflict (id) do nothing;

insert into public.cases (
  id, slug, title, specialty, diagnosis, presenting_complaint, status,
  patient_context, tags, created_by, source_case_id, version, published_at
)
select
  fixture.id,
  fixture.slug,
  fixture.title,
  fixture.specialty,
  null,
  fixture.presenting_complaint,
  'active'::public.case_status,
  fixture.patient_context,
  fixture.tags,
  admin_user.id,
  null,
  1,
  '2026-08-13T00:00:00Z'::timestamptz
from (
  values
    (
      '33333333-3333-4333-8333-333333333334'::uuid,
      'acute-posterior-tooth-pain',
      'Acute Posterior Tooth Pain',
      'endodontics',
      'A 29-year-old simulated patient reports spontaneous throbbing pain from a lower posterior tooth that lingers after cold drinks and disturbed sleep last night.',
      '{"age":29,"setting":"urgent dental visit","simulation":true,"available_information":["history","clinical tests","periapical radiograph report"]}'::jsonb,
      array['endodontics','pain assessment','diagnostic reasoning','antibiotic stewardship']::text[]
    ),
    (
      '33333333-3333-4333-8333-333333333335'::uuid,
      'periodontal-risk-and-bone-loss',
      'Periodontal Risk and Bone Loss',
      'periodontology',
      'A 35-year-old simulated patient reports bleeding during brushing, persistent bad breath, and recent movement of a lower incisor. The history includes daily tobacco use.',
      '{"age":35,"setting":"comprehensive assessment","simulation":true,"available_information":["history","periodontal chart","radiograph report"]}'::jsonb,
      array['periodontology','risk assessment','staging and grading','shared planning']::text[]
    ),
    (
      '33333333-3333-4333-8333-333333333336'::uuid,
      'fractured-immature-maxillary-incisor',
      'Fractured Immature Maxillary Incisor',
      'paediatric dentistry',
      'A 9-year-old simulated patient presents two hours after a playground fall with a fractured upper central incisor, a small visible pulp exposure, and an incompletely developed root.',
      '{"age":9,"setting":"same-day trauma visit","simulation":true,"available_information":["injury history","clinical examination","radiograph report"]}'::jsonb,
      array['dental trauma','immature permanent tooth','vital pulp therapy','follow-up']::text[]
    )
) as fixture(id, slug, title, specialty, presenting_complaint, patient_context, tags)
join public.users as admin_user
  on admin_user.id = '99999999-9999-4999-8999-999999999999'::uuid
on conflict (id) do nothing;

insert into public.case_phases (
  id, case_id, phase_order, phase_key, title, objectives, questions,
  teaching_notes, expected_findings, metadata
)
select
  fixture.id,
  fixture.case_id,
  fixture.phase_order,
  fixture.phase_key,
  fixture.title,
  fixture.objectives,
  fixture.questions,
  fixture.teaching_notes,
  fixture.expected_findings,
  jsonb_build_object('checkpoint', fixture.phase_key, 'simulation', true)
from (
  values
    (
      '44444444-4444-4444-8444-444444444451'::uuid,
      '33333333-3333-4333-8333-333333333334'::uuid,
      1,
      'pain_pattern_and_urgency',
      'Pain Pattern & Urgency',
      array['Build a concise problem representation from the pain history and screen for urgent spread or systemic involvement']::text[],
      array['Which details in this pain history are most diagnostically useful, and what urgent features must you still exclude?','How would duration, provocation, spontaneity, and sleep disturbance change your concern?']::text[],
      'Reward a structured history and explicit red-flag screen before the learner names a diagnosis.',
      '{"onset":true,"duration":true,"provocation":true,"spontaneous_pain":true,"sleep_disturbance":true,"swelling_or_systemic_features":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444452'::uuid,
      '33333333-3333-4333-8333-333333333334'::uuid,
      2,
      'focused_testing',
      'Focused Clinical Testing',
      array['Design a sequenced clinical and radiographic assessment using comparison teeth and tests that answer a stated uncertainty']::text[],
      array['Which examination and diagnostic tests would you perform, in what order, and what would each result tell you?','Why should sensibility findings be interpreted alongside percussion, palpation, probing, and radiographic information?']::text[],
      'Ask what each test contributes; a list without interpretation is incomplete.',
      '{"visual_exam":true,"control_tooth":true,"sensibility_testing":true,"percussion":true,"palpation":true,"periodontal_probing":true,"radiograph":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444453'::uuid,
      '33333333-3333-4333-8333-333333333334'::uuid,
      3,
      'diagnostic_integration',
      'Diagnostic Integration',
      array['Integrate history and test findings into separate defensible pulpal and apical working diagnoses while retaining relevant alternatives']::text[],
      array['How would you combine the history and test results into a pulpal and an apical working diagnosis?','Which conflicting result would make you reconsider the leading explanation?']::text[],
      'Keep the learner anchored to evidence and uncertainty rather than accepting a label alone.',
      '{"pulpal_diagnosis":true,"apical_diagnosis":true,"differentials":true,"supporting_evidence":true,"uncertainty":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444454'::uuid,
      '33333333-3333-4333-8333-333333333334'::uuid,
      4,
      'immediate_management',
      'Immediate Management',
      array['Propose proportionate immediate and definitive management, including analgesia and explicit antibiotic stewardship']::text[],
      array['What immediate care would address the source of pain, and how would you plan definitive treatment?','Under which findings would systemic antibiotics become appropriate, and why are they not routine for toothache alone?']::text[],
      'Require source control, consent, restorability and appropriate escalation to be considered.',
      '{"source_control":true,"definitive_care":true,"analgesia":true,"restorability":true,"consent":true,"antibiotic_stewardship":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444455'::uuid,
      '33333333-3333-4333-8333-333333333334'::uuid,
      5,
      'safety_net_reflection',
      'Safety Net & Reflection',
      array['Communicate uncertainty, review timing, escalation triggers, and the evidence that would change the plan']::text[],
      array['How would you explain the plan, safety-net the patient, and arrange review?','Which assumption in your reasoning is most vulnerable to new evidence?']::text[],
      'Close with teach-back and clear triggers for urgent reassessment.',
      '{"teach_back":true,"review_interval":true,"red_flags":true,"escalation":true,"reflection":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444461'::uuid,
      '33333333-3333-4333-8333-333333333335'::uuid,
      1,
      'periodontal_problem_representation',
      'Problem Representation & Risk',
      array['Summarize the periodontal concern and identify modifiable and non-modifiable risk factors without premature staging']::text[],
      array['How would you summarize the central periodontal concern, and which risk factors matter most?','What additional history would help distinguish local disease from a generalized pattern?']::text[],
      'Look for risk-context reasoning, including tobacco exposure, glycaemic status, family history and previous care.',
      '{"bleeding":true,"tooth_mobility":true,"tobacco_exposure":true,"medical_risk":true,"extent_unknown":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444462'::uuid,
      '33333333-3333-4333-8333-333333333335'::uuid,
      2,
      'periodontal_data_collection',
      'Periodontal Data Collection',
      array['Plan a complete periodontal and radiographic assessment that can determine extent, severity, complexity, and current activity']::text[],
      array['Which measurements and examinations are required before you can characterize this condition?','How would you use probing, attachment levels, mobility, furcations, plaque, bleeding, and radiographs together?']::text[],
      'A full chart and risk assessment are expected; isolated pocket depths are insufficient.',
      '{"six_point_chart":true,"clinical_attachment":true,"bleeding_on_probing":true,"plaque":true,"mobility":true,"furcation":true,"radiographic_bone_loss":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444463'::uuid,
      '33333333-3333-4333-8333-333333333335'::uuid,
      3,
      'periodontal_classification',
      'Classification & Prognosis',
      array['Use the collected evidence to justify a periodontal diagnosis, extent, stage, grade, and tooth-level prognosis']::text[],
      array['How would you justify the extent, stage, and grade rather than simply naming them?','Which finding has the greatest influence on prognosis, and what uncertainty remains?']::text[],
      'Ask for criterion-level justification and note that simulated information may remain incomplete.',
      '{"diagnosis":true,"extent":true,"stage":true,"grade":true,"risk_modifiers":true,"tooth_prognosis":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444464'::uuid,
      '33333333-3333-4333-8333-333333333335'::uuid,
      4,
      'cause_related_plan',
      'Cause-related Management',
      array['Design a phased, patient-centred initial plan that addresses biofilm, risk factors, local contributors, and measurable outcomes']::text[],
      array['What would your initial treatment phase include, and how would you prioritize it?','How would you support tobacco cessation and agree on outcomes that matter to this patient?']::text[],
      'The plan should connect interventions to causes and include shared decision-making.',
      '{"oral_hygiene_support":true,"risk_factor_control":true,"non_surgical_therapy":true,"local_factors":true,"shared_goals":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444465'::uuid,
      '33333333-3333-4333-8333-333333333335'::uuid,
      5,
      'reevaluation_and_maintenance',
      'Re-evaluation & Maintenance',
      array['Define how response will be measured, when escalation is justified, and how supportive periodontal care is individualized']::text[],
      array['When and how would you re-evaluate the response to initial therapy?','Which residual findings would change the next phase or maintenance interval?']::text[],
      'Expect measurable endpoints, residual-risk reasoning and a sustainable recall plan.',
      '{"reevaluation_timing":true,"probing_response":true,"bleeding_response":true,"residual_pockets":true,"escalation":true,"maintenance_interval":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444471'::uuid,
      '33333333-3333-4333-8333-333333333336'::uuid,
      1,
      'trauma_history_and_triage',
      'Trauma History & Triage',
      array['Prioritize general trauma safety, injury timing, contamination, symptoms, and factors that affect dental prognosis']::text[],
      array['What must you establish first in the history and triage before focusing on the fractured tooth?','How do injury timing and root maturity influence the urgency of preserving pulp vitality?']::text[],
      'Begin with broader injury safety, tetanus and safeguarding context where relevant.',
      '{"general_injury_screen":true,"loss_of_consciousness":true,"injury_time":true,"contamination":true,"tetanus_context":true,"root_maturity":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444472'::uuid,
      '33333333-3333-4333-8333-333333333336'::uuid,
      2,
      'trauma_examination',
      'Clinical & Radiographic Assessment',
      array['Plan a gentle trauma examination and appropriate imaging that detects associated luxation, root, alveolar, and soft-tissue injuries']::text[],
      array['How would you examine this child and tooth while minimizing additional discomfort?','Which associated injuries must be excluded clinically and radiographically?']::text[],
      'Do not assume an isolated crown injury; include soft tissues, occlusion and adjacent teeth.',
      '{"soft_tissues":true,"fragment_search":true,"mobility":true,"displacement":true,"percussion":true,"occlusion":true,"radiographs":true,"adjacent_teeth":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444473'::uuid,
      '33333333-3333-4333-8333-333333333336'::uuid,
      3,
      'injury_classification_and_goals',
      'Injury Classification & Biological Goals',
      array['Classify the dental injury and explain why maintaining healthy vital pulp is important for continued root development']::text[],
      array['How would you classify the injury, and what is the main biological treatment goal?','Which findings would make vital pulp therapy less predictable?']::text[],
      'Ask the learner to connect diagnosis, pulp status, exposure characteristics and open-apex biology.',
      '{"injury_classification":true,"pulp_exposure":true,"vitality_context":true,"apexogenesis":true,"prognostic_factors":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444474'::uuid,
      '33333333-3333-4333-8333-333333333336'::uuid,
      4,
      'vital_pulp_management',
      'Vital Pulp Management',
      array['Compare conservative vital-pulp options and justify a same-day plan that preserves tissue, seals the tooth, and supports the child']::text[],
      array['Which management option best protects continued root development, and how would you perform it?','How would exposure size, time, contamination, haemostasis, restorability, and cooperation alter your choice?']::text[],
      'Require justification of material, haemostasis, seal, pain control, consent and alternatives.',
      '{"partial_pulpotomy_reasoning":true,"asepsis":true,"haemostasis":true,"biocompatible_material":true,"coronal_seal":true,"consent":true}'::jsonb
    ),
    (
      '44444444-4444-4444-8444-444444444475'::uuid,
      '33333333-3333-4333-8333-333333333336'::uuid,
      5,
      'trauma_follow_up',
      'Follow-up & Reflection',
      array['Construct clinical and radiographic follow-up that monitors healing, vitality, root development, and complications']::text[],
      array['What would you monitor at review, and which changes would require intervention?','How would you explain uncertainty and long-term follow-up to the child and caregiver?']::text[],
      'Include age-appropriate communication, prevention and explicit loss-to-follow-up risk.',
      '{"symptoms":true,"clinical_signs":true,"pulp_response":true,"root_development":true,"periapical_health":true,"restoration_integrity":true,"safety_net":true}'::jsonb
    )
) as fixture(id, case_id, phase_order, phase_key, title, objectives, questions, teaching_notes, expected_findings)
join public.cases as parent_case on parent_case.id = fixture.case_id
on conflict (id) do nothing;

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at, due_at
)
select
  fixture.id,
  demo_class.id,
  fixture.case_id,
  professor.id,
  'open',
  '2026-08-13T00:00:00Z'::timestamptz,
  null
from (
  values
    ('66666666-6666-4666-8666-666666666667'::uuid, '33333333-3333-4333-8333-333333333334'::uuid),
    ('66666666-6666-4666-8666-666666666668'::uuid, '33333333-3333-4333-8333-333333333335'::uuid),
    ('66666666-6666-4666-8666-666666666669'::uuid, '33333333-3333-4333-8333-333333333336'::uuid)
) as fixture(id, case_id)
join public.classes as demo_class
  on demo_class.id = '55555555-5555-4555-8555-555555555555'::uuid
join public.users as professor
  on professor.id = '22222222-2222-4222-8222-222222222222'::uuid
join public.cases as teaching_case
  on teaching_case.id = fixture.case_id
on conflict (id) do nothing;

commit;
