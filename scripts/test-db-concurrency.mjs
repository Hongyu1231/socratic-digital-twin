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

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestResult(pathname, options = {}) {
  const response = await fetch(restUrl(pathname), {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { ...headers, ...(options.headers ?? {}) },
  });
  return { status: response.status, body: await responseBody(response) };
}

async function request(pathname, options = {}, expectedStatuses = [200, 201, 204]) {
  const result = await requestResult(pathname, options);
  if (!expectedStatuses.includes(result.status)) {
    const detail = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    throw new Error(`${options.method ?? "GET"} ${pathname} returned ${result.status}: ${detail}`);
  }
  return result;
}

async function rpc(name, args, expectedStatuses = [200]) {
  const result = await requestResult(`/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(args),
  });
  return { ...result, expected: expectedStatuses.includes(result.status) };
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
  const result = await requestResult(url.pathname + url.search, {
    headers: { Accept: "application/json" },
  });
  if (result.status !== 200) throw new Error(`GET ${table} returned ${result.status}: ${JSON.stringify(result.body)}`);
  if (!Array.isArray(result.body)) throw new Error(`GET ${table} returned a non-array response.`);
  return result.body;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function firstRow(body) {
  return Array.isArray(body) ? body[0] : body;
}

function scalarUuid(body) {
  if (typeof body === "string") return body;
  const row = firstRow(body);
  if (!row || typeof row !== "object") return null;
  const values = Object.values(row);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

function requireTimestampOrder(row, label) {
  requireCondition(
    Date.parse(row.created_at) <= Date.parse(row.updated_at),
    `${label} violated the created_at/updated_at ordering invariant.`,
  );
}

const adminId = "99999999-9999-4999-8999-999999999999";
const studentId = "11111111-1111-4111-8111-111111111111";
const professorId = "22222222-2222-4222-8222-222222222222";

const caseId = randomUUID();
const initialPhaseId = randomUUID();
const savedPhaseId = randomUUID();
const supersedingCaseId = randomUUID();
const supersedingPhaseId = randomUUID();
const classId = randomUUID();
const assignmentId = randomUUID();
const racedAssignmentId = randomUUID();
const sessionStartAssignmentId = randomUUID();
const sessionId = randomUUID();
const requestId = `ci-concurrent-turn-${randomUUID()}`;
let caseCreated = false;
let supersedingCaseCreated = false;
let supersedingPublishSucceeded = false;
let classCreated = false;
let assignmentCreated = false;
let racedAssignmentCreated = false;
let sessionStartAssignmentCreated = false;
let sessionStartSessionId = null;
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
  // This is the backwards-compatible two-argument REST payload.  With no
  // default on the three-argument function, PostgREST resolves this wrapper
  // deterministically instead of reporting an overloaded-function conflict.
  const publishPayload = { p_case_id: caseId, p_published_at: new Date().toISOString() };

  const [saveResult, publishResult] = await Promise.all([
    rpc("save_case_draft", savePayload, [200]),
    rpc("publish_case", publishPayload, [200]),
  ]);

  requireCondition(publishResult.status === 200, `Concurrent publish failed: ${JSON.stringify(publishResult.body)}`);
  requireCondition(firstRow(publishResult.body)?.id === caseId, "Concurrent publish did not return the fixture case.");
  const saveSucceeded = saveResult.status === 200;
  const saveRejectedAsPublished = [400, 500].includes(saveResult.status)
    && saveResult.body?.code === "55000"
    && saveResult.body?.message === "Case cannot be saved from status active";
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

  await insert("cases", {
    id: supersedingCaseId,
    slug: `ci-concurrency-${supersedingCaseId.slice(0, 8)}`,
    title: "Concurrency Superseding Case",
    specialty: "dentistry",
    presenting_complaint: "Synthetic superseding fixture.",
    status: "draft",
    published_at: null,
    patient_context: { source: "isolated-ci-concurrency", superseding: true },
    tags: ["synthetic", "superseding"],
    created_by: adminId,
    source_case_id: caseId,
    version: 2,
    difficulty: "advanced",
    attachments: [],
    is_test_fixture: true,
  });
  supersedingCaseCreated = true;
  await insert("case_phases", {
    id: supersedingPhaseId,
    case_id: supersedingCaseId,
    phase_order: 1,
    phase_key: "observe",
    title: "Observe superseding version",
    objectives: ["Record the supplied evidence"],
    questions: ["What changes in this version?"],
    teaching_notes: null,
    expected_findings: {},
    metadata: {},
  });

  await insert("classes", {
    id: classId,
    name: `Concurrency Fixture ${classId.slice(0, 8)}`,
    code: `CI-${classId.slice(0, 8)}`,
    term: "isolated-ci",
    status: "active",
    created_by: adminId,
  });
  classCreated = true;
  await insert("class_memberships", [
    { class_id: classId, user_id: professorId, role: "professor", is_lead: true },
    { class_id: classId, user_id: studentId, role: "student", is_lead: false },
  ]);

  // This assignment is present before publication and must be moved to the
  // target.  The second insert races publication: it either commits first and
  // is moved as well, or observes the superseded parent and is rejected.
  // Deliberately give the fixture a client timestamp later than the publish
  // transaction can have started.  The publish update must preserve it rather
  // than writing transaction-start `now()` back into updated_at.
  const timestampRegressionFloor = Date.now();
  const assignmentTimestamp = new Date(timestampRegressionFloor + 60_000).toISOString();
  await insert("class_case_assignments", {
    id: assignmentId,
    class_id: classId,
    case_id: caseId,
    assigned_by: professorId,
    status: "open",
    opens_at: assignmentTimestamp,
    due_at: null,
    created_at: assignmentTimestamp,
    updated_at: assignmentTimestamp,
    idempotency_key: `ci-concurrency-${assignmentId}`,
  });
  assignmentCreated = true;

  const [supersedingPublishResult, racedAssignmentResult] = await Promise.all([
    // This is the explicit three-argument REST payload and exercises the
    // default-free overload together with assignment movement.
    rpc("publish_case", {
      p_case_id: supersedingCaseId,
      p_published_at: new Date().toISOString(),
      p_move_open_assignments: true,
    }, [200]),
    requestResult("/rest/v1/class_case_assignments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      // This second timestamp is also intentionally later than the publish
      // transaction.  Depending on lock order the row is either moved or the
      // active-case guard rejects it.
      body: JSON.stringify({
        id: racedAssignmentId,
        class_id: classId,
        case_id: caseId,
        assigned_by: professorId,
        status: "open",
        opens_at: new Date(timestampRegressionFloor + 120_000).toISOString(),
        due_at: null,
        created_at: new Date(timestampRegressionFloor + 120_000).toISOString(),
        updated_at: new Date(timestampRegressionFloor + 120_000).toISOString(),
        idempotency_key: `ci-concurrency-${racedAssignmentId}`,
      }),
    }),
  ]);

  requireCondition(supersedingPublishResult.status === 200, `Three-argument publish failed: ${JSON.stringify(supersedingPublishResult.body)}`);
  requireCondition(firstRow(supersedingPublishResult.body)?.id === supersedingCaseId, "Three-argument publish returned the wrong case.");
  // The publish transaction has committed at this point.  If the following
  // race assertion fails, cleanup must not try to archive the now-superseded
  // source case.
  supersedingPublishSucceeded = true;
  requireCondition(
    [201, 204, 400, 409, 500].includes(racedAssignmentResult.status),
    `Concurrent assignment insert returned an unexpected status: ${JSON.stringify(racedAssignmentResult)}`,
  );
  const raceAssignmentRejected = [400, 409, 500].includes(racedAssignmentResult.status)
    && racedAssignmentResult.body?.code === "55000"
    && racedAssignmentResult.body?.message === "Assignments may target only active cases";
  if (raceAssignmentRejected) {
    // Expected outcome when publication wins the parent-case lock.
  } else if ([201, 204].includes(racedAssignmentResult.status)) {
    racedAssignmentCreated = true;
  } else {
    throw new Error(`Concurrent assignment rejection was not the publication guard: ${JSON.stringify(racedAssignmentResult)}`);
  }

  const caseRows = await selectRows("cases", { id: `in.(${caseId},${supersedingCaseId})` });
  const oldCase = caseRows.find((row) => row.id === caseId);
  const newCase = caseRows.find((row) => row.id === supersedingCaseId);
  requireCondition(oldCase?.status === "superseded", "Concurrent publication did not supersede the old fixture case.");
  requireCondition(newCase?.status === "active", "Concurrent publication did not activate the new fixture case.");

  const movedAssignment = await selectRows("class_case_assignments", { id: `eq.${assignmentId}` });
  requireCondition(movedAssignment.length === 1 && movedAssignment[0].case_id === supersedingCaseId, "The pre-existing open assignment was not moved atomically.");
  requireCondition(Date.parse(movedAssignment[0].created_at) > timestampRegressionFloor, "The timestamp regression fixture was not later than the publish transaction start.");
  requireTimestampOrder(movedAssignment[0], "The moved assignment");
  const oldOpenAssignments = await selectRows("class_case_assignments", {
    case_id: `eq.${caseId}`,
    status: "eq.open",
  });
  requireCondition(oldOpenAssignments.length === 0, "An open assignment remained attached to the superseded case.");
  const racedAssignment = await selectRows("class_case_assignments", { id: `eq.${racedAssignmentId}` });
  if (racedAssignmentCreated) {
    requireCondition(racedAssignment.length === 1 && racedAssignment[0].case_id === supersedingCaseId, "The racing assignment was not moved after winning the lock.");
    requireTimestampOrder(racedAssignment[0], "The racing assignment");
  } else {
    requireCondition(racedAssignment.length === 0, "A rejected racing assignment left a row behind.");
  }

  // Exercise the atomic session initializer with two genuinely concurrent
  // REST/RPC requests for the same assignment and student. The function must
  // serialize on the assignment/student unique key and return the fully
  // initialized winner to both callers, rather than exposing a partial row.
  await insert("class_case_assignments", {
    id: sessionStartAssignmentId,
    class_id: classId,
    case_id: supersedingCaseId,
    assigned_by: professorId,
    status: "open",
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    due_at: null,
    idempotency_key: `ci-concurrency-session-start-${sessionStartAssignmentId}`,
  });
  sessionStartAssignmentCreated = true;
  const sessionStartPayload = {
    p_student_id: studentId,
    p_assignment_id: sessionStartAssignmentId,
    p_case_id: supersedingCaseId,
    p_first_phase_id: supersedingPhaseId,
    p_initial_state: {
      sessionId: "",
      version: 1,
      strengths: [],
      previousErrors: [],
    },
    p_opening_content: "What do you notice in this record?",
  };
  const [firstSessionStart, secondSessionStart] = await Promise.all([
    rpc("create_session_for_assignment", sessionStartPayload, [200]),
    rpc("create_session_for_assignment", sessionStartPayload, [200]),
  ]);
  for (const result of [firstSessionStart, secondSessionStart]) {
    requireCondition(result.status === 200, `Concurrent session start failed: ${JSON.stringify(result.body)}`);
  }
  const firstSessionId = scalarUuid(firstSessionStart.body);
  const secondSessionId = scalarUuid(secondSessionStart.body);
  requireCondition(firstSessionId && secondSessionId, `Concurrent session start did not return UUIDs: ${JSON.stringify([firstSessionStart.body, secondSessionStart.body])}`);
  requireCondition(firstSessionId === secondSessionId, "Concurrent session starts returned different session IDs.");
  sessionStartSessionId = firstSessionId;

  const initializedSessions = await selectRows("sessions", {
    class_case_assignment_id: `eq.${sessionStartAssignmentId}`,
    student_id: `eq.${studentId}`,
  });
  const initializedStates = await selectRows("session_state", { session_id: `eq.${sessionStartSessionId}` });
  const initializedOpeningMessages = await selectRows("messages", {
    session_id: `eq.${sessionStartSessionId}`,
    role: "eq.tutor",
    sequence_no: "eq.1",
  });
  requireCondition(initializedSessions.length === 1, `Concurrent session starts created ${initializedSessions.length} session rows.`);
  requireCondition(initializedStates.length === 1, `Concurrent session starts created ${initializedStates.length} session_state rows.`);
  requireCondition(initializedOpeningMessages.length === 1, `Concurrent session starts created ${initializedOpeningMessages.length} opening messages.`);
  requireCondition(initializedSessions[0].case_id === supersedingCaseId && initializedSessions[0].status === "active", "Concurrent session start returned an invalid session projection.");
  requireCondition(initializedStates[0].state?.sessionId === sessionStartSessionId, "Concurrent session state does not reference the returned session ID.");
  requireCondition(initializedOpeningMessages[0].content === sessionStartPayload.p_opening_content, "Concurrent session start returned an unexpected opening message.");

  await insert("sessions", {
    id: sessionId,
    case_id: supersedingCaseId,
    student_id: studentId,
    professor_id: professorId,
    class_case_assignment_id: assignmentId,
    status: "active",
    current_phase_id: supersedingPhaseId,
    context: {},
  });
  sessionCreated = true;
  await insert("session_state", {
    session_id: sessionId,
    current_phase_id: supersedingPhaseId,
    state: { version: 1 },
    facts: [],
    unresolved_questions: [],
  });

  const requestIdPayload = {
    p_session_id: sessionId,
    p_student_sender_id: studentId,
    p_student_content: "The canine is unerupted.",
    p_student_phase_id: supersedingPhaseId,
    p_ai_content: "What evidence supports that observation?",
    p_ai_phase_id: supersedingPhaseId,
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
    p_current_phase_id: supersedingPhaseId,
    p_session_status: "active",
    p_client_request_id: requestId,
    p_student_metadata: { source: "isolated-ci-concurrency" },
    p_ai_metadata: { moveType: "question" },
  };
  const turnResults = await Promise.all([
    rpc("commit_tutor_turn", requestIdPayload, [200]),
    rpc("commit_tutor_turn", requestIdPayload, [200]),
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

  console.log("Isolated concurrency checks passed: two-argument wrapper, three-argument publish/assignment locking, and tutor-turn idempotency.");
} finally {
  if (sessionCreated) {
    await request(`/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Session fixture cleanup failed: ${error.message}`));
  }
  if (sessionStartAssignmentCreated) {
    // Delete by assignment/student as a fallback when a failed assertion did
    // not retain the returned UUID. The assignment is random and test-only.
    await request(`/rest/v1/sessions?class_case_assignment_id=eq.${encodeURIComponent(sessionStartAssignmentId)}&student_id=eq.${encodeURIComponent(studentId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Session-start fixture cleanup failed: ${error.message}`));
    await request(`/rest/v1/class_case_assignments?id=eq.${encodeURIComponent(sessionStartAssignmentId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Session-start assignment fixture cleanup failed: ${error.message}`));
  }
  if (racedAssignmentCreated) {
    await request(`/rest/v1/class_case_assignments?id=eq.${encodeURIComponent(racedAssignmentId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Racing assignment fixture cleanup failed: ${error.message}`));
  }
  if (assignmentCreated) {
    await request(`/rest/v1/class_case_assignments?id=eq.${encodeURIComponent(assignmentId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Assignment fixture cleanup failed: ${error.message}`));
  }
  if (supersedingCaseCreated) {
    await cleanupRpc("archive_case", { p_case_id: supersedingCaseId }, [200]).catch((error) => console.error(`Superseding case fixture cleanup failed: ${error.message}`));
  }
  if (caseCreated && !supersedingPublishSucceeded) {
    await cleanupRpc("archive_case", { p_case_id: caseId }, [200]).catch((error) => console.error(`Case fixture cleanup failed: ${error.message}`));
  }
  if (classCreated) {
    // Delete by the fixture's random class id as a final bounded cleanup.  It
    // catches either race outcome and keeps the class FK-safe if a failed REST
    // transaction returned after the row was accepted.
    await request(`/rest/v1/class_case_assignments?class_id=eq.${encodeURIComponent(classId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Assignment class-scope cleanup failed: ${error.message}`));
    await request(`/rest/v1/classes?id=eq.${encodeURIComponent(classId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }, [200, 204]).catch((error) => console.error(`Class fixture cleanup failed: ${error.message}`));
  }
}
