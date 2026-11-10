import { describe, expect, it } from "vitest";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { DEMO_STUDENT_ID, TEST_CLASS_ID, TEST_STUDENT_1_ID, TEST_STUDENT_2_ID, TEST_STUDENT_3_ID } from "@/lib/seed";
import { isAllowedDemoIdentity } from "@/lib/demo-identity";

describe("isolated demo test identities", () => {
  it("assigns three separate synthetic students to a QA class without changing demo memberships", async () => {
    const repository = new InMemoryTutorRepository();
    repository.reset();
    const identities = [TEST_STUDENT_1_ID, TEST_STUDENT_2_ID, TEST_STUDENT_3_ID];
    const users = await repository.listUsers();
    for (const id of identities) {
      const user = users.find((value) => value.id === id)!;
      expect(user.role).toBe("student");
      expect(user.email.endsWith("@example.invalid")).toBe(true);
      expect(isAllowedDemoIdentity(user)).toBe(true);
      expect(isAllowedDemoIdentity({ ...user, role: "admin" })).toBe(false);
      const offerings = await repository.listStudentOfferings(id);
      expect(offerings.length).toBeGreaterThan(0);
      expect(offerings.every((entry) => entry.assignment.classId === TEST_CLASS_ID)).toBe(true);
    }
    expect((await repository.listStudentOfferings(DEMO_STUDENT_ID)).every((entry) => entry.assignment.classId !== TEST_CLASS_ID)).toBe(true);

    const firstOffering = (await repository.listStudentOfferings(TEST_STUDENT_1_ID))[0];
    const first = await repository.createSession(TEST_STUDENT_1_ID, firstOffering.case.id, firstOffering.assignment.id);
    const second = await repository.createSession(TEST_STUDENT_2_ID, firstOffering.case.id, firstOffering.assignment.id);
    expect(second.session.id).not.toBe(first.session.id);
    expect((await repository.createSession(TEST_STUDENT_1_ID, firstOffering.case.id, firstOffering.assignment.id)).session.id)
      .toBe(first.session.id);
  });
});
