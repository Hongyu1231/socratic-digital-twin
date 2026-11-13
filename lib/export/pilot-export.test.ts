import { describe, expect, it } from "vitest";

import { buildPilotExport, formatSingaporeTime } from "@/lib/export/pilot-export";
import {
  assignments, CLASS_ID, EXPORTED_AT, fixtureSessions, LONG_ANSWER, PROFESSOR_ID, SECRET_EMAILS, SECRET_NAMES, teachingClass, users,
} from "@/lib/export/pilot-fixtures";

const build = () => buildPilotExport({ teachingClass, assignments, sessions: fixtureSessions(), exportedAt: EXPORTED_AT });

describe("pilot export rows", () => {
  it("keeps only this class's residents, ordered by code then attempt", () => {
    const data = build();
    expect(data.summary.map((row) => [row.code, row.attempt])).toEqual([["R02", 1], ["R03", 1], ["R03", 2], ["R10", 1]]);
    expect(data.classCode).toBe("CASE-1-PILOT");
    expect(data.exportDate).toBe("2026-11-06");
  });

  it("drops professor sessions and sessions from another class", () => {
    const data = build();
    const codes = new Set(data.summary.map((row) => row.code));
    expect(codes.has("R99")).toBe(false);
    expect(data.summary.filter((row) => row.code === "R03")).toHaveLength(2);
    expect(JSON.stringify(data)).not.toContain(PROFESSOR_ID);
  });

  it("numbers two attempts by one resident by start time and names their Word files", () => {
    const r03 = build().summary.filter((row) => row.code === "R03");
    expect(r03.map((row) => row.attempt)).toEqual([1, 2]);
    expect(r03.map((row) => row.fileName)).toEqual(["R03.docx", "R03-attempt-2.docx"]);
    expect(r03[0]!.startedAt < r03[1]!.startedAt).toBe(true);
  });

  it("labels all three phase outcomes the same way the review page does", () => {
    const [, r03] = build().summary;
    expect(r03!.phases.map((phase) => phase.outcome)).toEqual(["independent", "with_support", "independent", "independent", "independent", "independent"]);
    expect(r03!.phases[1]!.label).toBe("Tutor walked them through it");
    const r10 = build().summary.at(-1)!;
    expect(r10.phases.map((phase) => phase.label)).toEqual(["Did it on their own", ...Array(5).fill("Didn't finish this phase")]);
  });

  it("reports completed, ended early and still in progress", () => {
    const labels = Object.fromEntries(build().summary.map((row) => [`${row.code}-${row.attempt}`, row.statusLabel]));
    expect(labels).toEqual({ "R02-1": "Ended early", "R03-1": "Completed", "R03-2": "Still in progress", "R10-1": "Ended early" });
  });

  it("takes every recorded pause out of time spent", () => {
    const [r02, r03First, r03Paused, r10] = build().summary;
    expect(r03First!.timeSpentMinutes).toBe(65 - 10 - 5); // two pauses
    expect(r10!.timeSpentMinutes).toBe(20 - 3); // one pause
    expect(r02!.timeSpentMinutes).toBe(0); // ended early, no messages, no pauses
    // Still in progress, last message 01:25, paused since 01:30: ends at the last message.
    expect(r03Paused!.finishedText).toBe("");
    expect(r03Paused!.timeSpentMinutes).toBe(25);
    expect(r03Paused!.earlierPausesUnknown).toBe(false);
  });

  it("counts a never-paused session exactly, up to its last message while in progress", () => {
    const sessions = fixtureSessions().map((item) => item.student.id === users.r03!.id && item.session.status === "active"
      ? { ...item, session: { ...item.session, pausedAt: null, pauseHistory: undefined } } : item);
    const r03Paused = buildPilotExport({ teachingClass, assignments, sessions, exportedAt: new Date("2026-11-03T03:00:00.000Z") }).summary[2]!;
    expect(r03Paused.timeSpentMinutes).toBe(25); // not the 120 minutes to download time
  });

  it("counts from the start when paused right now with no pause history", () => {
    const sessions = fixtureSessions().map((item) => item.student.id === users.r03!.id && item.session.status === "active"
      ? { ...item, session: { ...item.session, pauseHistory: undefined } } : item);
    const data = buildPilotExport({ teachingClass, assignments, sessions, exportedAt: EXPORTED_AT });
    expect(data.summary[2]!.timeSpentMinutes).toBe(25);
    expect(data.summary[2]!.earlierPausesUnknown).toBe(true);
    expect(data.anyEarlierPausesUnknown).toBe(true);
    expect(build().anyEarlierPausesUnknown).toBe(false);
  });

  it("keeps one decimal place of minutes", () => {
    const sessions = fixtureSessions().map((item) => item.student.id === users.r10!.id
      ? { ...item, session: { ...item.session, completedAt: "2026-11-02T02:20:24.000Z" } } : item);
    const r10 = buildPilotExport({ teachingClass, assignments, sessions, exportedAt: EXPORTED_AT }).summary.at(-1)!;
    expect(r10.timeSpentMinutes).toBe(17.4); // 20 min 24 s, minus a 3 minute pause
  });

  it("finds the longest gap between messages, not counting pauses", () => {
    const [r02, r03First, r03Paused, r10] = build().summary;
    expect(r03First!.longestGapMinutes).toBe(53 - 15); // 01:12 to 02:05, minus two pauses
    expect(r03Paused!.longestGapMinutes).toBe(25);
    expect(r10!.longestGapMinutes).toBe(5);
    expect(r02!.longestGapMinutes).toBeNull();
  });

  it("puts the tutor message that opens a new phase under that phase", () => {
    const rows = build().transcripts.filter((row) => row.code === "R03" && row.attempt === 1);
    expect(rows[2]!.text).toBe("Good. Question for phase 2?");
    expect(rows[2]!.phaseOrder).toBe(2);
    expect(rows[2]!.phaseTitle).toBe("Clinical & Radiographic Assessment");
    expect(rows[1]!.phaseOrder).toBe(1);
  });

  it("keeps the closing message in the last phase when there's no next phase", async () => {
    const { bundle, clinicalCase, message, users: people } = await import("@/lib/export/pilot-fixtures");
    const lastPhase = clinicalCase.phases.length;
    const session = bundle({
      id: "s9", student: people.r10!, assignmentId: assignments[0]!.id, status: "completed",
      createdAt: "2026-11-02T01:00:00.000Z", completedAt: "2026-11-02T01:10:00.000Z", completedAllPhases: true,
      messages: [
        message("s9", "student", "Final answer.", "2026-11-02T01:05:00.000Z", { phaseOrder: lastPhase, turnKind: "answer" }),
        message("s9", "ai", "You have completed all phases.", "2026-11-02T01:06:00.000Z", { phaseOrder: lastPhase, moveType: "transition" }),
      ],
    });
    const rows = buildPilotExport({ teachingClass, assignments, sessions: [session], exportedAt: EXPORTED_AT }).transcripts;
    expect(rows.map((row) => row.phaseOrder)).toEqual([lastPhase, lastPhase]);
  });

  it("formats times in Singapore time as dd MMM yyyy HH:mm", () => {
    const [, r03] = build().summary;
    expect(r03!.startedText).toBe("02 Nov 2026 09:00");
    expect(r03!.finishedText).toBe("02 Nov 2026 10:05");
    expect(formatSingaporeTime(new Date("2026-12-31T16:00:00Z"))).toBe("01 Jan 2027 00:00");
  });

  it("counts Help requests and marks them in the transcript", () => {
    const data = build();
    expect(data.summary.map((row) => row.helpRequests)).toEqual([0, 1, 0, 0]);
    const r03 = data.transcripts.filter((row) => row.code === "R03" && row.attempt === 1);
    expect(r03.map((row) => row.speaker)).toEqual(["Tutor", "Resident", "Tutor", "Resident", "Tutor", "Resident", "Tutor"]);
    expect(r03.map((row) => row.help)).toEqual(["", "", "", "Asked for help", "Tutor's reply to a help request", "", ""]);
    expect(r03.map((row) => row.phaseOrder)).toEqual([1, 1, 2, 2, 2, 2, 2]);
    expect(r03[3]!.phaseTitle).toBe("Clinical & Radiographic Assessment");
    expect(r03.map((row) => row.messageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r03[1]!.text).toBe(LONG_ANSWER);
  });

  it("uses phase titles as column names when every case agrees", () => {
    expect(build().phaseColumns.map((column) => column.title)).toContain("Assess the prognosis");
  });

  it("never includes emails, other names or internal ids", () => {
    const text = JSON.stringify(build());
    for (const secret of [...SECRET_EMAILS, ...SECRET_NAMES, CLASS_ID, ...Object.values(users).map((user) => user.id), "s1000000-0000-4000-8000-000000000001"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("pilot export across more than one case", () => {
  it("puts the case in Word file names and drops phase titles that differ", async () => {
    const { clinicalCase, OTHER_ASSIGNMENT_ID } = await import("@/lib/export/pilot-fixtures");
    const secondCase = { ...clinicalCase, id: "case-2", title: "Impacted Mandibular Second Molar", phases: clinicalCase.phases.map((phase, index) => index === 2 ? { ...phase, title: "Something else" } : phase) };
    const classAssignments = [assignments[0]!, { ...assignments[1]!, id: "a3", classId: CLASS_ID }];
    const sessions = fixtureSessions().filter((item) => item.student.id === users.r03!.id && item.session.assignmentId !== OTHER_ASSIGNMENT_ID);
    const extra = { ...sessions[0]!, case: secondCase, session: { ...sessions[0]!.session, id: "s8", assignmentId: "a3", createdAt: "2026-11-04T00:00:00.000Z" } };
    const data = buildPilotExport({ teachingClass, assignments: classAssignments, sessions: [...sessions, extra], exportedAt: EXPORTED_AT });
    expect(data.summary.map((row) => row.fileName)).toEqual([
      "R03, Impacted Maxillary Canine.docx", "R03, Impacted Maxillary Canine-attempt-2.docx", "R03, Impacted Mandibular Second Molar.docx",
    ]);
    expect(data.summary.map((row) => row.attempt)).toEqual([1, 2, 1]);
    expect(data.phaseColumns[2]!.title).toBeNull();
    expect(data.phaseColumns[1]!.title).toBe("Clinical & Radiographic Assessment");
  });
});
