import { describe, expect, it } from "vitest";
import { groupByCase, sessionLabel } from "@/lib/case-catalogue";
import type { ClinicalCase, SessionStatus, StudentCaseOffering } from "@/lib/domain";

let assignmentCounter = 0;

function offering(input: {
  caseId: string;
  title?: string;
  caseStatus?: ClinicalCase["status"];
  availability?: StudentCaseOffering["availability"];
  sessionId?: string | null;
  sessionStatus?: SessionStatus | null;
  pausedAt?: string | null;
}): StudentCaseOffering {
  assignmentCounter += 1;
  return {
    assignment: {
      id: `assignment-${assignmentCounter}`,
      classId: "class-1",
      caseId: input.caseId,
      assignedBy: "professor-1",
      status: "open",
      opensAt: "2026-08-01T00:00:00.000Z",
      dueAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    teachingClass: { id: "class-1", name: "Orthodontic Reasoning Demo", code: "OR-1", term: "AY2026/27", status: "active", createdBy: "professor-1", createdAt: "2026-08-01T00:00:00.000Z", members: [] },
    case: {
      id: input.caseId,
      title: input.title ?? "Impacted Maxillary Canine",
      description: "A teaching simulation.",
      difficulty: "foundation",
      status: input.caseStatus ?? "available",
      learningObjectives: [],
      phases: [],
    },
    existingSessionId: input.sessionId ?? null,
    existingSessionStatus: input.sessionStatus ?? null,
    existingSessionPausedAt: input.pausedAt ?? null,
    availability: input.availability ?? "open",
  };
}

describe("groupByCase", () => {
  it("renders one card per case when the same case is assigned repeatedly", () => {
    // Mirrors the live payload: 10 offerings across 4 cases, six of them the
    // same case, every one carrying its own session.
    const offerings = [
      offering({ caseId: "case-tooth-pain", title: "Acute Posterior Tooth Pain", sessionId: "s1", sessionStatus: "active" }),
      offering({ caseId: "case-incisor", title: "Fractured Immature Maxillary Incisor", caseStatus: "archived", sessionId: "s2", sessionStatus: "active" }),
      offering({ caseId: "case-perio", title: "Periodontal Risk and Bone Loss", caseStatus: "archived", sessionId: "s3", sessionStatus: "active" }),
      offering({ caseId: "case-tooth-pain", title: "Acute Posterior Tooth Pain", sessionId: "s4", sessionStatus: "completed" }),
      offering({ caseId: "case-canine", sessionId: "s5", sessionStatus: "active" }),
      offering({ caseId: "case-canine", availability: "closed", sessionId: "s6", sessionStatus: "active" }),
      offering({ caseId: "case-canine", availability: "closed", sessionId: "s7", sessionStatus: "active" }),
      offering({ caseId: "case-canine", availability: "closed", sessionId: "s8", sessionStatus: "completed" }),
      offering({ caseId: "case-canine", availability: "closed", sessionId: "s9", sessionStatus: "active" }),
      offering({ caseId: "case-canine", availability: "closed", sessionId: "s10", sessionStatus: "active" }),
    ];

    const groups = groupByCase(offerings);

    expect(groups).toHaveLength(4);
    const canine = groups.find((group) => group.primary.case.id === "case-canine")!;
    expect(canine.extras).toHaveLength(5);
    // Every session stays reachable: nothing is dropped by the grouping.
    const reachable = groups.flatMap((group) => [group.primary, ...group.extras]).map((item) => item.existingSessionId);
    expect(new Set(reachable).size).toBe(10);
  });

  it("leads with the open, unfinished session rather than a closed one", () => {
    const groups = groupByCase([
      offering({ caseId: "case-canine", availability: "closed", sessionId: "old", sessionStatus: "active" }),
      offering({ caseId: "case-canine", availability: "open", sessionId: "current", sessionStatus: "active" }),
    ]);
    expect(groups[0].primary.existingSessionId).toBe("current");
  });

  it("prefers unfinished work over a startable assignment with no session", () => {
    const groups = groupByCase([
      offering({ caseId: "case-canine", availability: "open" }),
      offering({ caseId: "case-canine", availability: "closed", sessionId: "paused", sessionStatus: "active", pausedAt: "2026-08-12T00:00:00.000Z" }),
    ]);
    expect(groups[0].primary.existingSessionId).toBe("paused");
  });

  it("hides archived and draft cases the student has never started", () => {
    const groups = groupByCase([
      offering({ caseId: "case-archived", caseStatus: "archived" }),
      offering({ caseId: "case-draft", caseStatus: "draft" }),
      offering({ caseId: "case-live" }),
    ]);
    expect(groups.map((group) => group.primary.case.id)).toEqual(["case-live"]);
  });

  it("keeps an archived case visible when a session exists on it", () => {
    const groups = groupByCase([
      offering({ caseId: "case-archived", caseStatus: "archived", sessionId: "s1", sessionStatus: "active" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.case.status).toBe("archived");
  });

  it("lists only extras that carry a session", () => {
    const groups = groupByCase([
      offering({ caseId: "case-canine", availability: "open", sessionId: "s1", sessionStatus: "active" }),
      offering({ caseId: "case-canine", availability: "open" }),
    ]);
    expect(groups[0].extras).toHaveLength(0);
  });
});

describe("sessionLabel", () => {
  it("distinguishes completed, paused and in-progress sessions", () => {
    expect(sessionLabel(offering({ caseId: "c", sessionId: "s", sessionStatus: "completed" }))).toBe("Completed");
    expect(sessionLabel(offering({ caseId: "c", sessionId: "s", sessionStatus: "active", pausedAt: "2026-08-12T00:00:00.000Z" }))).toBe("Paused");
    expect(sessionLabel(offering({ caseId: "c", sessionId: "s", sessionStatus: "active" }))).toBe("In progress");
  });
});
