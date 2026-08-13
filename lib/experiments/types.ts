import type { HumanizationMetrics } from "@/lib/tutor/humanization-metrics";

export type DatasetStatus = "building" | "frozen" | "archived";
export type CandidateStatus = "draft" | "evaluated" | "retired";
export type EvalRunStatus = "pending" | "running" | "completed" | "failed";
export type ExperimentMode = "shadow" | "ab";
export type ExperimentStatus = "draft" | "running" | "paused" | "completed";
export type ApprovalDecision = "approved" | "rejected";
export type ReleaseStatus = "active" | "rolled_back";
export type CandidateProvider = "openai" | "claude" | "deterministic";

export interface FrozenTutorSample {
  sampleKey: string;
  reviewerPseudonym: string;
  phase: {
    title: string;
    goal: string;
    rubric: string[];
  };
  answer: string;
  attempt: number;
  professorLabel: "correct" | "partial" | "vague" | "wrong";
  baseline: {
    aiLabel: "correct" | "partial" | "vague" | "wrong";
    confidence: number;
    phaseComplete: boolean;
    tutorReply: string;
    provider: string;
    model: string;
    promptVersion: string;
  };
  tutorQuality: {
    naturalness: number;
    specificity: number;
    nonLeading: number;
    challengeFit: number;
    helpfulness: number;
    failureTags: string[];
  } | null;
}

export interface FrozenDataset {
  id: string;
  name: string;
  status: DatasetStatus;
  entryCount: number;
  contentHash: string | null;
  deidentificationVersion: string;
  sourceFrom: string | null;
  sourceTo: string | null;
  createdBy: string;
  createdAt: string;
  frozenAt: string | null;
}

export interface TutorCandidate {
  id: string;
  name: string;
  provider: CandidateProvider;
  model: string;
  promptVersion: string;
  instructions: string;
  status: CandidateStatus;
  createdBy: string;
  createdAt: string;
}

export interface ReleaseGateResult {
  passed: boolean;
  reasons: string[];
  sampleCount: number;
  safetyPassRate: number;
  distinctReviewerCount: number;
  requiresObservedFacultyApproval: true;
}

export interface EvalRun {
  id: string;
  datasetId: string;
  candidateId: string;
  status: EvalRunStatus;
  baselineMetrics: HumanizationMetrics | null;
  candidateMetrics: HumanizationMetrics | null;
  metricDeltas: Partial<Record<keyof HumanizationMetrics, number | null>>;
  gate: ReleaseGateResult | null;
  error: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface CandidatePrediction {
  sampleKey: string;
  classification: FrozenTutorSample["professorLabel"];
  confidence: number;
  nextQuestion: string;
  safetyPassed: boolean;
  safetyReasons: string[];
}

export interface HumanizationExperiment {
  id: string;
  name: string;
  candidateId: string;
  evalRunId: string;
  mode: ExperimentMode;
  status: ExperimentStatus;
  trafficPercent: number;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface FacultyApproval {
  id: string;
  evalRunId: string;
  professorId: string;
  professorName?: string;
  decision: ApprovalDecision;
  notes: string;
  createdAt: string;
}

export interface TutorRelease {
  id: string;
  candidateId: string;
  evalRunId: string;
  status: ReleaseStatus;
  trafficPercent: number;
  releasedBy: string;
  releaseNotes: string;
  createdAt: string;
  rolledBackAt: string | null;
  rolledBackBy?: string | null;
  rollbackReason: string | null;
}

export interface HumanizationOverview {
  datasets: FrozenDataset[];
  candidates: TutorCandidate[];
  runs: EvalRun[];
  experiments: HumanizationExperiment[];
  approvals: FacultyApproval[];
  releases: TutorRelease[];
}

export interface ActiveTutorExperiment {
  experiment: HumanizationExperiment;
  candidate: TutorCandidate;
}
