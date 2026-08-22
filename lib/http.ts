import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import type { SessionBundle } from "@/lib/domain";
import { ArchivedCaseError } from "@/lib/repository/types";

export function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ArchivedCaseError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 410 });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const status = /not found/i.test(message) ? 404 : /belongs|role|required|outside|not available|not a member/i.test(message) ? 403 : /already|changed|conflict|claimed|immutable|published|completed review/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status });
}

export function studentView(bundle: SessionBundle): SessionBundle {
  return {
    ...bundle,
    session: {
      ...bundle.session,
      evaluations: [],
      state: {
        ...bundle.session.state,
        previousErrors: [],
        weaknesses: [],
      },
    },
    answerReviews: [],
    tutorTurnReviews: [],
    sessionReview: bundle.sessionReview?.status === "completed" ? bundle.sessionReview : null,
  };
}
