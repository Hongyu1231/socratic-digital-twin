import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CasePhase, LearnerState } from "@/lib/domain";
import { OpenAITutor } from "@/lib/tutor/openai";

const runLive = process.env.RUN_CASE1_JESSICA_LIVE === "true";
const liveDescribe = runLive ? describe : describe.skip;

liveDescribe("Case 1 Phase 4 clinical feedback with the live model", () => {
  const cases = [
    "1. Impacted #23. 2. Severe upper and moderate lower crowding. 3. Class III low-angle skeletal pattern with a retrusive maxilla. 4. Proclined upper and upright lower incisors. 5. Class III incisor relationship, bilateral Class I molars, #22/#33 crossbite and lateral open bites.",
    "1. Severe upper and moderate lower crowding. 2. Impacted #23. 3. Class III low-angle skeletal pattern with a retrusive maxilla. 4. Proclined upper and upright lower incisors. 5. Class III incisor relationship, bilateral Class I molars, #22/#33 crossbite and lateral open bites.",
  ];
  it.each(cases)("accepts a prioritised list without a separate chief complaint: %s", async (answer) => {
    const dir = process.env.CASE1_FEEDBACK_PACK;
    if (!dir || !process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new Error("Private pack and OpenAI configuration required.");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    const item = manifest.cases[0];
    const phase = item.case.phases[3] as CasePhase;
    const state: LearnerState = {
      sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", currentGoal: phase.goal,
      previousErrors: [], strengths: [], weaknesses: [], nextStrategy: "probe", phaseAttempts: { "4": 0 },
      mastery: { "4": 0 }, version: 1, updatedAt: new Date().toISOString(),
    };
    const result = await new OpenAITutor(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL).evaluate({
      phase, answer, state, attempt: 1, currentQuestion: phase.starterQuestion,
      caseContext: {
        title: item.case.title, description: item.case.description,
        learningObjectives: item.case.learningObjectives, attachments: [],
        teachingContext: { expertNotes: item.expertNotes, sourceDocument: item.sourceDocument, literature: [] },
      },
    });
    const met = (result.criteriaMet ?? []).map((entry) => typeof entry === "string" ? entry : entry.id);
    expect(result.source).toBe("openai");
    expect(result.classification).not.toBe("wrong");
    expect(met).toContain("p4-both-arch-crowding");
    expect(met).toContain("p4-prioritised-list");
    expect(result.nextQuestion).not.toMatch(/bite findings|which number|what number|rank (?:it|this|that) as/i);
  }, 60_000);
});
