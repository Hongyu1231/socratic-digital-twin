import { requireProfessor } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { professorReviewSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await requireProfessor();
    const parsed = professorReviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid review." }, { status: 400 });
    }
    const repository = getRepository();
    const session = await repository.getSession(parsed.data.sessionId);
    if (!session) throw new Error("Session not found.");
    const reflectionEvaluationIds = new Set(
      session.session.evaluations.filter((evaluation) => evaluation.isReflection).map((evaluation) => evaluation.id),
    );
    await repository.saveReview({
      ...parsed.data,
      professorId: identity.id,
      reviews: parsed.data.reviews.filter((review) => !reflectionEvaluationIds.has(review.evaluationId)),
    });
    const bundle = (await repository.listSessionsForProfessor(identity.id)).find((item) => item.session.id === parsed.data.sessionId);
    return Response.json(bundle);
  } catch (error) {
    return errorResponse(error);
  }
}
