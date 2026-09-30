export interface AssignmentCreatePayload {
  classId: string;
  caseId: string;
  opensAt: string;
  dueAt: string | null;
}

export interface AssignmentRequest extends AssignmentCreatePayload {
  idempotencyKey: string;
}

/** Keep one key for an unchanged creation intent, including ambiguous timeouts. */
export function assignmentRequest(
  previous: AssignmentRequest | null,
  payload: AssignmentCreatePayload,
  newKey: () => string = () => `assignment:${crypto.randomUUID()}`,
): AssignmentRequest {
  if (previous && previous.classId === payload.classId && previous.caseId === payload.caseId
    && previous.opensAt === payload.opensAt && previous.dueAt === payload.dueAt) return previous;
  return { ...payload, idempotencyKey: newKey() };
}
