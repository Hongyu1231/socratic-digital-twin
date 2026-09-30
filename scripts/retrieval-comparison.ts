import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTeachingContextWithTrace } from "../lib/materials/retrieval";

/** Metadata-only passage identity used by the comparison. */
export interface ComparisonPassage {
  sourceId: string;
  page: number;
  locator?: string;
  score: number;
}

export interface ComparisonTrace {
  query: string;
  passages: ComparisonPassage[];
}

export interface ExpectedPassage {
  sourceId: string;
  page: number;
  locator?: string;
}

/** One fixed answer from the offline comparison set. */
export interface RetrievalComparisonSample {
  id: string;
  studentAnswer: string;
  currentQuestion: string;
  phaseGoal: string;
  targetCriterionText: string;
  expectedPassages: ExpectedPassage[];
}

export interface RetrievalComparisonQueries {
  /** The query currently used by state-machine.ts. */
  baseline: string;
  /** The candidate query from PR #2 §3.9. */
  criterion: string;
}

export interface RankedVariant {
  queryLength: number;
  passages: ComparisonPassage[];
  expectedRank: number | null;
  expectedScore: number | null;
  reciprocalRank: number;
}

export type SampleVerdict = "criterion-better" | "equal" | "baseline-better";

export interface RetrievalComparisonSampleResult {
  id: string;
  baseline: RankedVariant;
  criterion: RankedVariant;
  verdict: SampleVerdict;
}

export interface RetrievalComparisonMetrics {
  samples: number;
  baselineHitRateAt4: number;
  criterionHitRateAt4: number;
  baselineMeanReciprocalRank: number;
  criterionMeanReciprocalRank: number;
  criterionNotWorseOnSyntheticLabels: boolean;
}

export interface RetrievalComparisonReport {
  harness: "retrieval-comparison-v1";
  dataset: "synthetic";
  runtimePolicyChanged: false;
  decision: "retain-baseline-pending-labelled-evidence";
  clinicalConclusion: "not-assessed";
  metrics: RetrievalComparisonMetrics;
  samples: RetrievalComparisonSampleResult[];
}

export type RetrievalFunction = (caseId: string, query: string) => ComparisonTrace;

const CASE_ID = "77777777-7777-4777-8777-777777777777";
const PACKAGE_ID = "retrieval-comparison-synthetic";

function assertSample(sample: RetrievalComparisonSample): void {
  if (!sample.id.trim()) throw new Error("Retrieval comparison samples require an id.");
  if (!sample.studentAnswer.trim()) throw new Error(`Sample ${sample.id} has an empty student answer.`);
  if (!sample.currentQuestion.trim()) throw new Error(`Sample ${sample.id} has an empty current question.`);
  if (!sample.phaseGoal.trim()) throw new Error(`Sample ${sample.id} has an empty phase goal.`);
  if (!sample.targetCriterionText.trim()) throw new Error(`Sample ${sample.id} has an empty target criterion.`);
  if (sample.expectedPassages.length === 0) throw new Error(`Sample ${sample.id} has no expected passage label.`);
}

/**
 * Build the two exact query variants described by PR #2 §3.9.
 *
 * The baseline deliberately mirrors state-machine.ts. No normalization is
 * performed here because the production retrieval layer owns query bounds and
 * tokenization.
 */
export function buildComparisonQueries(sample: RetrievalComparisonSample): RetrievalComparisonQueries {
  assertSample(sample);
  return {
    baseline: `${sample.studentAnswer} ${sample.currentQuestion} ${sample.phaseGoal}`,
    criterion: `${sample.studentAnswer} ${sample.targetCriterionText}`,
  };
}

function passageMatches(actual: ComparisonPassage, expected: ExpectedPassage): boolean {
  return actual.sourceId === expected.sourceId
    && actual.page === expected.page
    && (expected.locator === undefined || actual.locator === expected.locator);
}

function rankVariant(trace: ComparisonTrace, expectedPassages: ExpectedPassage[]): RankedVariant {
  const passages = trace.passages.slice(0, 4).map(({ sourceId, page, locator, score }) => ({ sourceId, page, locator, score }));
  const expectedIndex = passages.findIndex((actual) => expectedPassages.some((expected) => passageMatches(actual, expected)));
  const expectedRank = expectedIndex < 0 ? null : expectedIndex + 1;
  return {
    queryLength: trace.query.length,
    passages,
    expectedRank,
    expectedScore: expectedIndex < 0 ? null : passages[expectedIndex]?.score ?? null,
    reciprocalRank: expectedRank === null ? 0 : 1 / expectedRank,
  };
}

function verdict(baseline: RankedVariant, criterion: RankedVariant): SampleVerdict {
  if (baseline.expectedRank === null && criterion.expectedRank === null) return "equal";
  if (baseline.expectedRank === null) return "criterion-better";
  if (criterion.expectedRank === null) return "baseline-better";
  if (criterion.expectedRank < baseline.expectedRank) return "criterion-better";
  if (criterion.expectedRank > baseline.expectedRank) return "baseline-better";
  return "equal";
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Compare two retrieval query variants against fixed, metadata-only labels.
 *
 * This function intentionally accepts the retriever as a dependency. That
 * keeps the harness usable with the current runtime retriever in tests while
 * making it impossible for the comparison to silently change online policy.
 */
export function runRetrievalComparison(options: {
  caseId: string;
  samples: RetrievalComparisonSample[];
  retrieve: RetrievalFunction;
}): RetrievalComparisonReport {
  if (options.samples.length === 0) throw new Error("Retrieval comparison requires at least one labelled sample.");
  const sampleIds = new Set<string>();
  const results = options.samples.map((sample) => {
    assertSample(sample);
    if (sampleIds.has(sample.id)) throw new Error(`Duplicate retrieval comparison sample id: ${sample.id}.`);
    sampleIds.add(sample.id);
    const queries = buildComparisonQueries(sample);
    const baseline = rankVariant(options.retrieve(options.caseId, queries.baseline), sample.expectedPassages);
    const criterion = rankVariant(options.retrieve(options.caseId, queries.criterion), sample.expectedPassages);
    return { id: sample.id, baseline, criterion, verdict: verdict(baseline, criterion) };
  });

  const baselineReciprocalRanks = results.map((result) => result.baseline.reciprocalRank);
  const criterionReciprocalRanks = results.map((result) => result.criterion.reciprocalRank);
  const baselineHits = results.filter((result) => result.baseline.expectedRank !== null).length;
  const criterionHits = results.filter((result) => result.criterion.expectedRank !== null).length;
  const criterionNotWorseOnSyntheticLabels = results.every((result) => result.verdict !== "baseline-better");

  return {
    harness: "retrieval-comparison-v1",
    dataset: "synthetic",
    runtimePolicyChanged: false,
    decision: "retain-baseline-pending-labelled-evidence",
    clinicalConclusion: "not-assessed",
    metrics: {
      samples: results.length,
      baselineHitRateAt4: baselineHits / Math.max(1, results.length),
      criterionHitRateAt4: criterionHits / Math.max(1, results.length),
      baselineMeanReciprocalRank: mean(baselineReciprocalRanks),
      criterionMeanReciprocalRank: mean(criterionReciprocalRanks),
      criterionNotWorseOnSyntheticLabels,
    },
    samples: results,
  };
}

/**
 * Small synthetic set that exercises a baseline distractor, an equal hit, and
 * a criterion-specific hit. Text is invented for engineering tests and is not
 * a clinical teaching source.
 */
export function syntheticComparisonSamples(): RetrievalComparisonSample[] {
  return [
    {
      id: "criterion-specific-adjacent-root-risk",
      studentAnswer: "I would describe the canine position and inspect the adjacent tooth.",
      currentQuestion: "What exact relationship of the canine to the neighbouring tooth and occlusal plane can you state?",
      phaseGoal: "Describe the canine position before planning treatment.",
      targetCriterionText: "Assess the lateral incisor root resorption risk from the impacted canine.",
      expectedPassages: [{ sourceId: "synthetic-root-risk", page: 1 }],
    },
    {
      id: "equal-direct-root-risk",
      studentAnswer: "I would assess lateral incisor root resorption on the radiograph.",
      currentQuestion: "Which radiographic finding matters most?",
      phaseGoal: "Assess adjacent-root risk.",
      targetCriterionText: "Assess the lateral incisor root resorption risk from the impacted canine.",
      expectedPassages: [{ sourceId: "synthetic-root-risk", page: 1 }],
    },
    {
      id: "baseline-position-description",
      studentAnswer: "The canine is palatal and close to the lateral root.",
      currentQuestion: "What position and angulation do you see?",
      phaseGoal: "Describe canine position and angulation.",
      targetCriterionText: "Record the adjacent tooth root relationship.",
      expectedPassages: [{ sourceId: "synthetic-position", page: 1 }],
    },
  ];
}

function syntheticManifest() {
  return {
    formatVersion: 1,
    packageId: PACKAGE_ID,
    cases: [{
      case: {
        id: CASE_ID,
        title: "Synthetic retrieval comparison case",
        description: "Synthetic case content used only for offline retrieval regression tests.",
        difficulty: "intermediate",
        learningObjectives: ["Describe findings using evidence."],
        phases: [{
          order: 1,
          title: "Observe",
          goal: "Describe the supplied evidence.",
          rubric: ["Describe the relevant finding."],
          starterQuestion: "What do you observe?",
          exampleQuestions: ["Which record supports that observation?"],
        }],
      },
      expertNotes: "Synthetic note; not clinical content.",
      sourceDocument: "synthetic-retrieval-fixture.txt",
    }],
    articles: [
      {
        id: "synthetic-root-risk",
        title: "Synthetic adjacent-root risk",
        filename: "synthetic-root-risk.txt",
        sha256: "1".repeat(64),
        pages: [{
          page: 1,
          text: "An impacted canine may be associated with lateral incisor root resorption risk; assess the adjacent root on the radiograph.",
        }],
      },
      {
        id: "synthetic-position",
        title: "Synthetic canine position",
        filename: "synthetic-position.txt",
        sha256: "2".repeat(64),
        pages: [{
          page: 1,
          text: "Record the canine's palatal position, angulation, and relationship to the occlusal plane and neighbouring tooth.",
        }],
      },
      {
        id: "synthetic-distractor",
        title: "Synthetic occlusal relationship distractor",
        filename: "synthetic-distractor.txt",
        sha256: "3".repeat(64),
        pages: [{
          page: 1,
          text: "Describe the canine position and occlusal-plane relationship before considering treatment options.",
        }],
      },
    ],
    media: [],
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Run the fixed synthetic set through the current production retriever. */
export function runSyntheticRetrievalComparison(): RetrievalComparisonReport {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryParent, "socratic-retrieval-comparison-"));
  const cleanup = () => {
    if (path.dirname(fs.realpathSync(root)) !== temporaryParent) throw new Error("Unexpected temporary fixture path; refusing recursive cleanup.");
    fs.rmSync(root, { recursive: true, force: true });
  };
  const previousMaterialsDir = process.env.TUTOR_MATERIALS_DIR;
  const previousMemoryFlag = process.env.FORCE_MEMORY_REPOSITORY;
  const previousVercel = process.env.VERCEL;
  try {
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(syntheticManifest()), "utf8");
    process.env.TUTOR_MATERIALS_DIR = root;
    process.env.FORCE_MEMORY_REPOSITORY = "true";
    delete process.env.VERCEL;
    return runRetrievalComparison({
      caseId: CASE_ID,
      samples: syntheticComparisonSamples(),
      retrieve: (caseId, query) => getTeachingContextWithTrace(caseId, query).trace,
    });
  } finally {
    restoreEnvironment("TUTOR_MATERIALS_DIR", previousMaterialsDir);
    restoreEnvironment("FORCE_MEMORY_REPOSITORY", previousMemoryFlag);
    restoreEnvironment("VERCEL", previousVercel);
    cleanup();
  }
}

function isMainModule(): boolean {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  process.stdout.write(`${JSON.stringify(runSyntheticRetrievalComparison(), null, 2)}\n`);
}
