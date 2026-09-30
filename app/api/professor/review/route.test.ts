import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  requireProfessor: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    role: "professor" as const,
  })),
}));

vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {},
  requireProfessor: mocks.requireProfessor,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: mocks.getRepository,
}));

vi.mock("@/lib/case-media", () => ({ prepareStudentMedia: vi.fn(async () => []) }));

import { POST } from "@/app/api/professor/review/route";

const sessionId = "11111111-1111-4111-8111-111111111111";
const gradedEvaluationId = "33333333-3333-4333-8333-333333333333";
const reflectionEvaluationId = "44444444-4444-4444-8444-444444444444";

describe("professor review API", () => {
  beforeEach(() => {
    mocks.getRepository.mockReset();
    mocks.requireProfessor.mockClear();
  });

  it("strips reflection evaluations from professor answer scoring while retaining tutor reviews", async () => {
    const bundle = {
      session: {
        id: sessionId,
        evaluations: [
          { id: gradedEvaluationId, isReflection: false },
          { id: reflectionEvaluationId, isReflection: true },
        ],
      },
    };
    const repository = {
      getSession: vi.fn(async () => bundle),
      saveReview: vi.fn(async () => bundle),
      listSessionsForProfessor: vi.fn(async () => [bundle]),
    };
    mocks.getRepository.mockReturnValue(repository);

    const response = await POST(new Request("http://localhost/api/professor/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        reviews: [
          { evaluationId: gradedEvaluationId, label: "partial", comments: "Needs a clearer link." },
          { evaluationId: reflectionEvaluationId, label: "correct", comments: "Should not be scored." },
        ],
        tutorReviews: [{
          evaluationId: reflectionEvaluationId,
          tutorMessageId: "55555555-5555-4555-8555-555555555555",
          naturalness: 4,
          specificity: 4,
          nonLeading: 4,
          challengeFit: 4,
          helpfulness: 4,
          failureTags: [],
          preferredRewrite: "",
          comments: "The reflection prompt was clear.",
        }],
        overallFeedback: "Good reasoning process.",
        status: "completed",
      }),
    }));

    expect(response.status).toBe(200);
    expect(repository.listSessionsForProfessor).not.toHaveBeenCalled();
    expect(repository.saveReview).toHaveBeenCalledWith(expect.objectContaining({
      reviews: [{ evaluationId: gradedEvaluationId, label: "partial", comments: "Needs a clearer link." }],
      tutorReviews: [expect.objectContaining({ evaluationId: reflectionEvaluationId })],
    }));
  });
});
