import type { LearningSession, SessionBundle } from "@/lib/domain";

/** Support prose can use a different generator from the answer evaluation. */
export function latestTutorRuntime(
  session: Pick<LearningSession, "messages" | "evaluations">,
  defaultTutor: SessionBundle["runtime"]["tutor"],
): Pick<SessionBundle["runtime"], "tutor" | "fallbackFrom"> {
  const latestReply = session.messages.findLast((message) => message.sender === "ai");
  if (latestReply?.supportProvider) {
    return { tutor: latestReply.supportProvider, fallbackFrom: latestReply.supportFallbackFrom };
  }
  const evaluation = session.evaluations.at(-1);
  return { tutor: evaluation?.provider ?? defaultTutor, fallbackFrom: evaluation?.fallbackFrom };
}
