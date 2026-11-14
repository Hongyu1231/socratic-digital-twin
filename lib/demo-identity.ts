import type { DemoUser, PublicDemoIdentity } from "@/lib/domain";
import {
  DEMO_ADMIN_ID,
  DEMO_PROFESSOR_2_ID,
  DEMO_PROFESSOR_ID,
  DEMO_STUDENT_2_ID,
  DEMO_STUDENT_3_ID,
  DEMO_STUDENT_ID,
  TEST_STUDENT_1_ID,
  TEST_STUDENT_2_ID,
  TEST_STUDENT_3_ID,
  getDemoUser,
} from "@/lib/seed";

const SEEDED_DEMO_IDENTITY_IDS = new Set([
  DEMO_STUDENT_ID,
  DEMO_STUDENT_2_ID,
  DEMO_STUDENT_3_ID,
  TEST_STUDENT_1_ID,
  TEST_STUDENT_2_ID,
  TEST_STUDENT_3_ID,
  DEMO_PROFESSOR_ID,
  DEMO_PROFESSOR_2_ID,
  DEMO_ADMIN_ID,
]);

export function isAllowedDemoIdentity(user: DemoUser): boolean {
  const seeded = getDemoUser(user.id);
  return SEEDED_DEMO_IDENTITY_IDS.has(user.id) && seeded?.role === user.role && user.isActive !== false;
}

export function toPublicDemoIdentity(user: DemoUser): PublicDemoIdentity {
  return { id: user.id, name: user.name, role: user.role };
}
