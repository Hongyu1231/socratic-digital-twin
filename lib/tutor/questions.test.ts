import { describe, expect, it } from "vitest";
import { hasAskedQuestion, questionTexts } from "@/lib/tutor/questions";
describe("session-wide question wording guard", () => {
  it("extracts a support question without storing the plan or acknowledgement", () => {
    expect(questionTexts("You identified #23. One plan uses a single view. What might that plan miss?")).toEqual(["What might that plan miss?"]);
  });
  it("matches the trailing question from earlier support prose", () => {
    expect(hasAskedQuestion("What might that plan miss?", ["One plan uses a single view. What might that plan miss?"])).toBe(true);
  });
  it("catches close lexical rewording of a priority request", () => {
    expect(hasAskedQuestion("What problem would you prioritize first from the records?", ["Which problem would you prioritise first?"])).toBe(true);
  });
  it("does not conflate different teeth or genuinely different clinical asks", () => {
    expect(hasAskedQuestion("How would you assess the prognosis of #23?", ["How would you assess the prognosis of #22?"])).toBe(false);
    expect(hasAskedQuestion("How would this affect your extraction plan?", ["Which record shows the canine's position?"])).toBe(false);
  });
});
