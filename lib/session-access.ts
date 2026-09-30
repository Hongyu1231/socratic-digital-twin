import { AuthError, type DemoIdentity } from "@/lib/auth";
import type { SessionBundle } from "@/lib/domain";
import type { TutorRepository } from "@/lib/repository/types";

/** Authorize one already-loaded session without loading every class session. */
export async function assertSessionAccess(
  identity: DemoIdentity,
  bundle: SessionBundle,
  repository: Pick<TutorRepository, "listClasses">,
): Promise<void> {
  if (bundle.case.id !== bundle.session.caseId) throw new Error("Session case not found.");
  if (identity.role === "admin") return;
  if (identity.role === "student") {
    if (bundle.session.studentId === identity.id) return;
    throw new AuthError(403, "This session belongs to another learner.");
  }
  const classId = bundle.assignment?.classId;
  if (identity.role === "professor" && classId) {
    const classes = await repository.listClasses(identity.id);
    if (classes.some((item) => item.id === classId && item.members.some(
      (member) => member.userId === identity.id && member.role === "professor",
    ))) return;
  }
  throw new AuthError(403, "This session belongs to another class.");
}
