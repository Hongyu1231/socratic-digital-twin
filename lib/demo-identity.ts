import type { DemoUser, PublicDemoIdentity } from "@/lib/domain";
import {
  DEMO_ADMIN_ID,
  DEMO_PROFESSOR_2_ID,
  DEMO_PROFESSOR_ID,
  DEMO_STUDENT_2_ID,
  DEMO_STUDENT_3_ID,
  DEMO_STUDENT_ID,
} from "@/lib/seed";

const SEEDED_DEMO_IDENTITY_IDS = new Set([
  DEMO_STUDENT_ID,
  DEMO_STUDENT_2_ID,
  DEMO_STUDENT_3_ID,
  DEMO_PROFESSOR_ID,
  DEMO_PROFESSOR_2_ID,
  DEMO_ADMIN_ID,
]);

export function isAllowedDemoIdentity(user: DemoUser): boolean {
  return SEEDED_DEMO_IDENTITY_IDS.has(user.id) && user.isActive !== false;
}

export function toPublicDemoIdentity(user: DemoUser): PublicDemoIdentity {
  return { id: user.id, name: user.name, role: user.role };
}
