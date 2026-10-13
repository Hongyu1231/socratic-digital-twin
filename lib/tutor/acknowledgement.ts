import type { TutorEvaluationResult } from "@/lib/domain";
import {
  remainingTutorRequestMs,
  TUTOR_PROVIDER_TIMEOUT_MS,
  TUTOR_REQUEST_BUDGET_MS,
} from "@/lib/tutor/request-budget";

export const ACKNOWLEDGEMENT_MAX_LENGTH = 200;

/**
 * Acknowledgements are optional at the application boundary, but a provider
 * response is only usable as an acknowledgement when it is short, grounded
 * wording rather than another question. Keep this check in one place so both
 * provider adapters retry the same cases.
 */
export function normalizeAcknowledgement(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const acknowledgement = value.trim();
  if (!acknowledgement || acknowledgement.length > ACKNOWLEDGEMENT_MAX_LENGTH || /[?？]/.test(acknowledgement)) {
    return undefined;
  }
  return acknowledgement;
}

export const STEP_UP_ACKNOWLEDGEMENT_MAX_WORDS = 20;
export const SUPPORTED_PHASE_ACKNOWLEDGEMENT = "Let's move on to the next part.";

const MASTERY_CLAIM = /\b(?:you(?:'|\u2019)?ve got (?:it|this)|you have got (?:it|this)|you got (?:it|this)|got it right|master(?:y|ed|ing)?|well done|good job|great|excellent|perfect|spot on|nailed|exactly right|that(?:'|\u2019)?s right|correct(?:ly)?|fully underst(?:and|ood)|you (?:now )?understand)\b/i;

/**
 * A phase that ended after a reveal keeps the model's own acknowledgement, but
 * only when it does not suggest the learner got there unaided. Anything else
 * becomes the fixed neutral line.
 */
export function supportedPhaseAcknowledgement(value: unknown): string {
  const acknowledgement = normalizeAcknowledgement(value);
  return acknowledgement && !MASTERY_CLAIM.test(acknowledgement) ? acknowledgement : SUPPORTED_PHASE_ACKNOWLEDGEMENT;
}

/** The acknowledgement shown before a step-up is one short sentence, or nothing. */
export function stepUpAcknowledgement(value: unknown): string | undefined {
  const acknowledgement = normalizeAcknowledgement(value);
  if (!acknowledgement || acknowledgement.split(/\s+/).length > STEP_UP_ACKNOWLEDGEMENT_MAX_WORDS) return undefined;
  return acknowledgement;
}

export const ACKNOWLEDGEMENT_RETRY_INSTRUCTIONS = [
  "The evaluation is already complete; repair only the acknowledgement field.",
  "Return one short, grounded sentence of at most 200 characters with no question mark.",
  "Name one specific idea or uncertainty present in the student's answer, and never affirm a wrong claim.",
  "Keep every grading field and the question unchanged; if no grounded acknowledgement is possible, return null.",
].join(" ");

/**
 * Return a deadline for the whole provider evaluation, including its one
 * acknowledgement repair attempt. `timeoutMs` is the remaining shared request
 * budget supplied by the state machine; keep it distinct from the 25-second
 * timeout applied to an individual SDK call.
 */
export function acknowledgementDeadline(timeoutMs?: number, now = Date.now()): number {
  const budget = timeoutMs === undefined
    ? TUTOR_PROVIDER_TIMEOUT_MS
    : Math.max(1, Math.min(Math.floor(timeoutMs), TUTOR_REQUEST_BUDGET_MS));
  return now + budget;
}

/**
 * Retry only a missing or semantically invalid acknowledgement once. The
 * first result remains authoritative for grading and evidence: a retry can
 * contribute only its valid acknowledgement. A failed or exhausted retry is
 * deliberately swallowed so the caller can send the first question alone.
 */
export async function retryAcknowledgement(
  first: TutorEvaluationResult,
  deadline: number,
  retry: (timeoutMs: number) => Promise<TutorEvaluationResult>,
): Promise<TutorEvaluationResult> {
  if (normalizeAcknowledgement(first.acknowledgement)) return first;

  const timeoutMs = remainingTutorRequestMs(deadline);
  if (timeoutMs <= 0) return { ...first, acknowledgement: undefined };

  try {
    const repaired = await retry(timeoutMs);
    const acknowledgement = normalizeAcknowledgement(repaired.acknowledgement);
    return {
      ...first,
      acknowledgement,
    };
  } catch {
    return { ...first, acknowledgement: undefined };
  }
}
