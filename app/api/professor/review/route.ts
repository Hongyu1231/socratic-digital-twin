import { requireProfessor } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { professorReviewSchema } from "@/lib/schemas";
import { prepareStudentMedia } from "@/lib/case-media";

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
    const bundle = await repository.saveReview({
      ...parsed.data,
      professorId: identity.id,
      reviews: parsed.data.reviews.filter((review) => !reflectionEvaluationIds.has(review.evaluationId)),
    });
    // saveReview authorizes ownership/class membership and returns this session.
    // Do not hydrate the professor's whole review queue after a single write.
    const completed = bundle.session.reviewStatus === "completed";
    return Response.json({
      ...bundle,
      case: { ...bundle.case, attachments: await prepareStudentMedia(bundle) },
      reviewClaim: {
        reviewerId: identity.id,
        reviewerName: identity.name,
        state: completed ? "completed" : "mine",
        canEdit: !completed,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
