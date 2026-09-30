/* global process, URL, fetch, console, AbortSignal */

import { randomUUID } from "node:crypto";
import { assertLoopbackTestTarget } from "./test-db-concurrency-target.mjs";

const FETCH_TIMEOUT_MS = 15_000;
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.API_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
const dataEnvironment = process.env.SUPABASE_DATA_ENVIRONMENT ?? process.env.E2E_DATA_ENVIRONMENT;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL/API_URL and SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY are required.");
}
const baseUrl = assertLoopbackTestTarget(supabaseUrl, dataEnvironment);

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "content-type": "application/json",
};

function restUrl(pathname, search = {}) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return url;
}

async function request(pathname, options = {}, expectedStatuses = [200, 201, 204]) {
  const response = await fetch(restUrl(pathname), {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { ...headers, ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!expectedStatuses.includes(response.status)) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${options.method ?? "GET"} ${pathname} returned ${response.status}: ${detail}`);
  }
  return { status: response.status, body };
}

async function rpc(name, args, expectedStatuses = [200]) {
  const response = await fetch(restUrl(`/rest/v1/rpc/${name}`), {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, expected: expectedStatuses.includes(response.status) };
}

async function cleanupRpc(name, args, expectedStatuses = [200]) {
  const result = await rpc(name, args, expectedStatuses);
  if (!result.expected) {
    throw new Error(`${name} cleanup returned ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result;
}

async function insert(table, rows) {
  await request(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  }, [201, 204]);
}

async function selectRows(table, filters) {
  const url = restUrl(`/rest/v1/${table}`, { select: "*", ...filters });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { ...headers, Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${table} returned ${response.status}: ${text}`);
  const body = text ? JSON.parse(text) : [];
  if (!Array.isArray(body)) throw new Error(`GET ${table} returned a non-array response.`);
  return body;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function firstRow(body) {
  return Array.isArray(body) ? body[0] : body;
}

const adminId = "99999999-9999-4999-8999-999999999999";
const studentId = "11111111-1111-4111-8111-111111111111";
const professorId = "22222222-2222-4222-8222-222222222222";

const caseId = randomUUID();
const initialPhaseId = randomUUID();
const savedPhaseId = randomUUID();
const classId = randomUUID();
const assignmentId = randomUUID();
const sessionId = randomUUID();
const requestId = `ci-concurrent-turn-${randomUUID()}`;
let caseCreated = false;
let classCreated = false;
let assignmentCreated = false;
let sessionCreated = false;

try {
  await insert("cases", {
    id: caseId,
    slug: `ci-concurrency-${caseId.slice(0, 8)}`,
    title: "Concurrency Draft Case",
    specialty: "dentistry",
    presenting_complaint: "Synthetic concurrency fixture.",
    status: "draft",
    published_at: null,
    patient_context: { source: "isolated-ci-concurrency" },
    tags: ["synthetic"],
    created_by: adminId,
    source_case_id: null,
    version: 1,
    difficulty: "intermediate",
    attachments: [],
    is_test_fixture: true,
  });
  caseCreated = true;
  await insert("case_phases", {
    id: initialPhaseId,
    case_id: caseId,
    phase_order: 1,
    phase_key: "observe",
    title: "Observe",
    objectives: ["Record the supplied evidence"],
    questions: ["What do you notice?"],
    teaching_notes: null,
    expected_findings: {},
    metadata: {},
  });

  const savePayload = {
    p_case_id: caseId,
    p_title: "Concurrency Saved Draft",
    p_slug: `ci-concurrency-${caseId.slice(0, 8)}`,
    p_specialty: "dentistry",
    p_presenting_complaint: "Synthetic concurrency fixture after save.",
    p_created_by: adminId,
    p_source_case_id: null,
    p_version: 1,
    p_patient_context: { source: "isolated-ci-concurrency", saved: true },
    p_attachments: [],
    p_tags: ["synthetic", "saved"],
    p_difficulty: "advanced",
    p_phases: [{
      id: savedPhaseId,
      phase_order: 1,
      phase_key: "observe",
      title: "Observe after save",
      objectives: ["Record the supplied evidence"],
      questions: ["What do you notice after the save?"],
      teaching_notes: null,
      expected_findings: {},
      metadata: {},
    }],
  };
  const publishPayload = { p_case_id: caseId, p_published_at: new Date().toISOString() };

  const [saveResult, publishResult] = await Promise.all([
    rpc("save_case_draft", savePayload, [200]),
    rpc("publish_case", publishPayload, [200]),
  ]);

  requireCondition(publishResult.status === 200, `Concurrent publish failed: ${JSON.stringify(publishResult.body)}`);
  requireCondition(firstRow(publishResult.body)?.id === caseId, "Concurrent publish did not return the fixture case.");
  const saveSucceeded = saveResult.status === 200;
  const saveRejectedAsPublished = saveResult.status === 400
    && saveResult.body?.code === "55000"
    && /status active/i.test(saveResult.body?.message ?? "");
  requireCondition(saveSucceeded || saveRejectedAsPublished, `Concurrent draft save returned an unexpected result: ${JSON.stringify(saveResult)}`);
  if (saveSucceeded) {
    requireCondition(firstRow(saveResult.body)?.id === caseId, "Concurrent draft save did not return the fixture case.");
  }

  const publishedCases = await selectRows("cases", { id: `eq.${caseId}` });
  requireCondition(
    publishedCases.length === 1
      && publishedCases[0].id === caseId
      && publishedCases[0].status === "active"
      && publishedCases[0].is_test_fixture === true,
    "Concurrent save/publish did not leave one active test fixture case.",
  );
  const publishedPhases = await selectRows("case_phases", { case_id: `eq.${caseId}` });
  requireCondition(publishedPhases.length === 1, "Concurrent save/publish left an unexpected phase count.");
  const publishedPhaseId = publishedPhases[0].id;

  await insert("classes", {
    id: classId,
    name: `Concurrency Fixture ${classId.slice(0, 8)}`,
    code: `CI-${classId.slice(0, 8)}`,
    term: "isolated-ci",
    status: "active",
    created_by: adminId,
  });
  classCreated = true;

  await insert("class_case_assignments", {
    id: assignmentId,
    class_id: classId,
    case_id: caseId,
    assigned_by: professorId,
    status: "open",
    opens_at: new Date().toISOString(),
    due_at: null,
    idempotency_key: `ci-concurrency-${assignmentId}`,
  });
  assignmentCreated = true;

  await insert("sessions", {
    id: sessionId,
    case_id: caseId,
    student_id: studentId,
    professor_id: professorId,
    class_case_assignment_id: assignmentId,
    status: "active",
    current_phase_id: publishedPhaseId,
    context: {},
  });
  sessionCreated = true;
  await insert("session_state", {
    session_id: sessionId,
    current_phase_id: publishedPhaseId,
    state: { version: 1 },
    facts: [],
    unresolved_questions: [],
  });

  const turnPayload = {
    p_session_id: sessionId,
    p_student_sender_id: studentId,
    p_student_content: "The canine is unerupted.",
    p_student_phase_id: publishedPhaseId,
    p_ai_content: "What evidence supports that observation?",
    p_ai_phase_id: publishedPhaseId,
    p_evaluation_type: "formative",
    p_evaluation_score: 70,
    p_evaluation_criteria: { classification: "partial", supportLevel: 1 },
    p_evaluation_feedback: "Connect the finding to the next step.",
    p_evaluator_id: professorId,
    p_state: { version: 2 },
    p_expected_version: 1,
    p_session_context: {},
    p_facts: [],
    p_unresolved_questions: [],
    p_current_phase_id: publishedPhaseId,
    p_session_status: "active",
    p_client_request_id: requestId,
    p_student_metadata: { source: "isolated-ci-concurrency" },
    p_ai_metadata: { moveType: "question" },
  };
  const turnResults = await Promise.all([
    rpc("commit_tutor_turn", turnPayload, [200]),
    rpc("commit_tutor_turn", turnPayload, [200]),
  ]);
  for (const result of turnResults) {
    requireCondition(result.status === 200, `Concurrent tutor turn failed: ${JSON.stringify(result.body)}`);
    const committedTurn = firstRow(result.body);
    requireCondition(
      committedTurn?.student_message_id
        && committedTurn.evaluation_id
        && committedTurn.ai_message_id
        && committedTurn.session_state_id,
      "Concurrent tutor turn did not return a complete committed result.",
    );
  }

  const studentMessages = await selectRows("messages", {
    session_id: `eq.${sessionId}`,
    role: "eq.student",
    client_request_id: `eq.${requestId}`,
  });
  const tutorMessages = await selectRows("messages", { session_id: `eq.${sessionId}`, role: "eq.tutor" });
  const evaluations = await selectRows("evaluations", { session_id: `eq.${sessionId}` });
  requireCondition(studentMessages.length === 1, `Expected one idempotent student message, got ${studentMessages.length}.`);
  requireCondition(tutorMessages.length === 1, `Expected one idempotent tutor message, got ${tutorMessages.length}.`);
  requireCondition(evaluations.length === 1, `Expected one idempotent evaluation, got ${evaluations.length}.`);

  console.log("Isolated concurrency checks passed: save/publish serialization and tutor-turn idempotency.");
} finally {
  if (sessionCreated) {
    await request(`/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Session fixture cleanup failed: ${error.message}`));
  }
  if (caseCreated) {
    await cleanupRpc("archive_case", { p_case_id: caseId }, [200]).catch((error) => console.error(`Case fixture cleanup failed: ${error.message}`));
  }
  if (assignmentCreated) {
    await request(`/rest/v1/class_case_assignments?id=eq.${encodeURIComponent(assignmentId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Assignment fixture cleanup failed: ${error.message}`));
  }
  if (classCreated) {
    await request(`/rest/v1/classes?id=eq.${encodeURIComponent(classId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Class fixture cleanup failed: ${error.message}`));
  }
}
