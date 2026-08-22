import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { resetRepositoryForTests } from "@/lib/repository";
import {
  DEMO_STUDENT_ID,
  IMPACTED_CANINE_CASE_ID,
  IMPACTED_SECOND_MOLAR_CASE_ID,
  impactedSecondMolarCase,
} from "@/lib/seed";
import { submitStudentAnswer } from "@/lib/tutor/state-machine";
import { caseInputSchema } from "@/lib/schemas";

describe("faculty script regressions", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
  });

  it("does not turn fifteen non-correct canine answers into completion or a score", async () => {
    let bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    for (let turn = 0; turn < 15; turn += 1) {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, "I am still unsure about this.");
    }

    expect(bundle.session.currentPhase).toBe(1);
    expect(bundle.session.status).toBe("active");
    expect(bundle.session.score).toBeNull();
    expect(bundle.session.evaluations).toHaveLength(15);
    expect(bundle.session.evaluations.every((evaluation) => evaluation.classification !== "correct")).toBe(true);
    expect(bundle.session.evaluations.every((evaluation) => !evaluation.phaseComplete)).toBe(true);
  });

  it("runs the impacted-canine corrections, revisit, perspective challenge and reflection", async () => {
    let bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const answer = async (content: string) => {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, content);
      return bundle.session.messages.at(-1)?.content;
    };

    await answer("The unerupted canine and eruption asymmetry matter because age and timing make impaction more likely than normal variation.");
    expect(await answer("I would take a CBCT.")).toBe("Before requesting any imaging, what could you learn from examining the patient?");
    expect(await answer("I would start with clinical palpation, then a panoramic OPG and parallax, reserving CBCT for uncertainty about root resorption or complex three-dimensional surgical planning.")).toBe(
      "You mentioned CBCT earlier. What remaining uncertainty would justify it after clinical examination and first-line imaging?",
    );
    await answer("After clinical palpation, panoramic imaging and parallax, CBCT is justified only if root resorption or complex position remains uncertain for surgical planning.");

    expect(await answer("The OPG shows that the canine is palatally displaced and overlapping the lateral incisor root.")).toBe(
      "How do you know the canine is palatally displaced from an OPG alone?",
    );
    expect(await answer("The OPG cannot show buccal or palatal position. Regardless, root resorption of the adjacent incisor, available space, angulation, age and prognosis determine urgency.")).toContain(
      "would you observe",
    );
    await answer("I would extract the primary canine and create orthodontic space now because age, angulation and adjacent-incisor resorption risk make observation less defensible.");

    expect(await answer("After exposure I would pull the canine down into the arch.")).toBe(
      "Where is the canine crown relative to the lateral incisor root before you pull it down?",
    );
    await answer("I would create space, use surgical exposure and orthodontic traction, first moving the crown distally away from the lateral root while controlling anchorage, then guide it into the arch.");
    expect(bundle.session.messages.at(-1)?.content).toBe("Why not extract the impacted canine and place an implant later?");

    expect(await answer("The alternative implant assumes growth is complete, but at age 12 the evidence and periodontal-ligament response create uncertainty, so I would reassess rather than discard the natural tooth.")).toContain(
      "highest-leverage decision point",
    );
    await answer("The highest-leverage point was early evidence gathering because uncertainty about eruption timing and adjacent-root risk could change the alternative plan and later reassessment.");

    expect(bundle.session.status).toBe("completed");
    expect(bundle.session.summary?.completedAllPhases).toBe(true);
    expect(bundle.session.messages.at(-1)?.content).toBe("You have completed all 5 phases. Your learning summary is ready.");
  });

  it("runs all six impacted-second-molar phases and the script-specific redirects", async () => {
    const parsed = caseInputSchema.safeParse({
      ...impactedSecondMolarCase,
      attachments: [{ kind: "image", title: "Panoramic radiograph", description: "Synthetic teaching radiograph", url: "/media/second-molar-opg.svg" }],
      phases: impactedSecondMolarCase.phases,
    });
    expect(parsed.success).toBe(true);

    let bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_SECOND_MOLAR_CASE_ID);
    const answer = async (content: string) => {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, content);
      return bundle.session.messages.at(-1)?.content;
    };

    await answer("At age 14, delayed eruption plus severe mesial angulation suggests impaction rather than normal eruption variation, with risk to the first molar.");
    expect(await answer("It needs treatment because the angulation is 40 degrees.")).toContain("15 degrees rather than 40 degrees");
    await answer("The 40-degree angulation, three-quarter root development, patient age and available space leave too little spontaneous correction potential, so intervention is justified.");

    expect(await answer("There must be enough space distal to the first molar for the second molar to upright.")).toContain("sitting directly behind the second molar");
    await answer("The developing third molar occupies the distal uprighting path, so removal is an irreversible space trade-off requiring prognosis discussion and consent.");

    expect(await answer("I would use a spring to upright it.")).toContain("what force, moment and anchorage control");
    await answer("I first thought the force should be mesial, but no, that would be wrong: apply a distally directed crown force and uprighting moment, account for tipping around the centre of resistance, and reinforce anchorage against the reactive mesial force.");

    expect(await answer("Yes, I would bond an attachment to the crown and begin traction.")).toContain("can you see it in the patient's mouth");
    await answer("If the crown is inaccessible, request conservative surgical exposure and bone removal, specifying attachment placement, force direction and flap design to the surgeon.");

    expect(await answer("There is no guarantee the third molar will replace it; that is too risky.")).toContain("might extracting the second molar");
    expect(await answer("The alternative is reasonable when second-molar prognosis is poor, the third-molar position and development are favourable, patient age is young and eruption potential remains.")).toContain(
      "single most consequential decision point",
    );
    await answer("The consequential decision point was assessing eruption potential; the cross-case principle is to integrate timing and spatial relationships before intervention so downstream mechanics remain safe.");

    expect(bundle.case.phases).toHaveLength(6);
    expect(bundle.session.status).toBe("completed");
    expect(bundle.session.messages.at(-1)?.content).toBe("You have completed all 6 phases. Your learning summary is ready.");
  });
});
