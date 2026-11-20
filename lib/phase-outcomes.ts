import type { PhaseTutorProgress, SessionSummary } from "@/lib/domain";
import type { StudentPhase } from "@/lib/student-contract";

export function phaseCompletionLabel(phase: StudentPhase, currentPhase: number, summary: SessionSummary): string {
  const progress = phase.phaseProgress;
  const supported = progress?.completedWithSupport || summary.supportedPhases?.includes(phase.order);
  const evidenced = progress && progress.criteriaTotal > 0 && progress.criteriaMet >= progress.criteriaTotal;
  if (!summary.completedAllPhases && phase.order >= currentPhase && !supported && !evidenced) return "Not completed";
  if (supported) return "Completed with tutor support";
  if (evidenced) return "Completed independently";
  // Legacy sessions can be complete without v2 evidence/support metadata.
  return "Completed (support not recorded)";
}

export type ReviewPhaseOutcome = "independent" | "with_support" | "not_completed";

/**
 * The professor review page rule: a phase counts only when the tutor recorded
 * it as completed, and support is the phase's own completedWithSupport flag.
 * The pilot export uses this too, so both always agree.
 */
export function reviewPhaseOutcome(progress: Pick<PhaseTutorProgress, "completed" | "completedWithSupport"> | undefined): ReviewPhaseOutcome {
  if (!progress?.completed) return "not_completed";
  return progress.completedWithSupport ? "with_support" : "independent";
}
