import type { LearningSession, SessionBundle } from "@/lib/domain";

/** Help has no evaluation row; derive its generator from the paired tutor message. */
export function latestTutorRuntime(
  session: Pick<LearningSession, "messages" | "evaluations">,
  defaultTutor: SessionBundle["runtime"]["tutor"],
): Pick<SessionBundle["runtime"], "tutor" | "fallbackFrom"> {
  const latestReply = session.messages.findLast((message) => message.sender === "ai");
  if (latestReply?.turnKind === "help" && latestReply.supportProvider) {
    return { tutor: latestReply.supportProvider, fallbackFrom: latestReply.supportFallbackFrom };
  }
  const evaluation = session.evaluations.at(-1);
  return { tutor: evaluation?.provider ?? defaultTutor, fallbackFrom: evaluation?.fallbackFrom };
}
