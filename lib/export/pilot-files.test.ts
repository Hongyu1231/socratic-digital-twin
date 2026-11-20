import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { MAX_CELL_TEXT, splitLongText, TRANSCRIPT_COLUMNS, writePilotWorkbook } from "@/lib/export/pilot-excel";
import { buildPilotExport } from "@/lib/export/pilot-export";
import {
  assignments, EXPORTED_AT, fixtureSessions, LONG_ANSWER, SECRET_EMAILS, SECRET_NAMES, teachingClass,
} from "@/lib/export/pilot-fixtures";
import { writeSessionDocument } from "@/lib/export/pilot-word";
import { buildPilotZip, WORD_FOLDER } from "@/lib/export/pilot-zip";

const input = () => ({ teachingClass, assignments, sessions: fixtureSessions(), exportedAt: EXPORTED_AT });

async function readWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

const rowValues = (sheet: ExcelJS.Worksheet, row: number) => (sheet.getRow(row).values as unknown[]).slice(1);

async function docxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml.replace(/<w:tab\/>/g, " ").replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

describe("pilot Excel file", () => {
  it("has the three sheets with plain-English headers, frozen and filtered", async () => {
    const workbook = await readWorkbook(await writePilotWorkbook(buildPilotExport(input())));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Transcripts", "Notes"]);
    const summary = workbook.getWorksheet("Summary")!;
    expect(rowValues(summary, 1)).toEqual([
      "Resident code", "Attempt (1 = first try at this case)", "Case", "Started (Singapore time)", "Finished (Singapore time)",
      "Time spent (minutes, not counting pauses)", "Longest gap between messages (minutes)", "Session status", "AI score (out of 100)",
      "Phase 1: Problem Identification", "Phase 2: Clinical & Radiographic Assessment", "Phase 3: Assess the prognosis",
      "Phase 4: Risk Assessment & Decision Making", "Phase 5: Management", "Phase 6: Reflection on the plan",
      "Times the resident asked for help",
    ]);
    expect(summary.getRow(1).font?.bold).toBe(true);
    expect(summary.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(summary.autoFilter).toBeTruthy();
    expect(summary.rowCount).toBe(1 + 4);
    expect(summary.getCell("F3").value).toBe(50);
    expect(summary.getCell("F4").value).toBe(25);
    expect(summary.getCell("G3").value).toBe(38);
    expect(summary.getCell("G2").value).toBeNull();
    // Stored as numbers, shown with one decimal place.
    expect(summary.getCell("F3").numFmt).toBe("0.0");
    expect(summary.getCell("G3").numFmt).toBe("0.0");
    expect(typeof summary.getCell("F3").value).toBe("number");
    expect(summary.getCell("E4").value).toBeNull();
    expect(summary.getCell("H4").value).toBe("Still in progress");
    expect(summary.getCell("K3").value).toBe("Tutor walked them through it");
    // Phase columns are wide enough for the longest value on one line.
    expect(summary.getColumn(11).width).toBeGreaterThanOrEqual("Tutor walked them through it".length);
    expect(summary.getColumn(11).alignment?.wrapText).toBeFalsy();
    // Started cell shows Singapore wall-clock time.
    expect((summary.getCell("D3").value as Date).toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });

  it("splits text over 32,000 characters across continuation rows without losing any", async () => {
    const workbook = await readWorkbook(await writePilotWorkbook(buildPilotExport(input())));
    const transcripts = workbook.getWorksheet("Transcripts")!;
    expect(rowValues(transcripts, 1)).toEqual(TRANSCRIPT_COLUMNS.map((column) => column.header));
    const messageCount = 3 + 2 + 7; // R10, R03 attempt 2, R03 attempt 1; R02 has no messages
    expect(transcripts.rowCount).toBe(1 + messageCount + 1);
    const longRows = [] as ExcelJS.Row[];
    transcripts.eachRow((row, number) => { if (number > 1 && String(row.getCell(8).value).includes("palatally")) longRows.push(row); });
    expect(longRows).toHaveLength(2);
    expect(longRows.map((row) => row.getCell(11).value)).toEqual(["1 of 2", "2 of 2"]);
    expect(longRows.map((row) => row.getCell(1).value)).toEqual(["R03", "R03"]);
    expect(longRows.every((row) => String(row.getCell(8).value).length <= MAX_CELL_TEXT)).toBe(true);
    expect(longRows.map((row) => row.getCell(8).value).join("")).toBe(LONG_ANSWER);
    expect(splitLongText("abc def", 4).join("")).toBe("abc def");
  });

  it("explains every column and the definitions on the Notes sheet", async () => {
    const workbook = await readWorkbook(await writePilotWorkbook(buildPilotExport(input())));
    const notes = workbook.getWorksheet("Notes")!;
    const text: string[] = [];
    notes.eachRow((row) => text.push((row.values as unknown[]).slice(1).filter(Boolean).join(" | ")));
    const all = text.join("\n");
    expect(text[0]).toContain("Case 1 Resident Pilot (CASE-1-PILOT)");
    expect(text[0]).toContain("06 Nov 2026 00:30");
    for (const header of ["Resident code", "Times the resident asked for help", "Who spoke", "Good to know", "Tutor walked them through it", "Time spent", "Longest gap", "without pressing Pause"]) expect(all).toContain(header);
    expect(all).not.toMatch(/—|N\/A|null|UTC|timestamp|metadata/i);
  });

  it("never contains emails or names other than the code", async () => {
    const buffer = await writePilotWorkbook(buildPilotExport(input()));
    const zip = await JSZip.loadAsync(buffer);
    const xml = (await Promise.all(Object.values(zip.files).map((file) => file.async("string")))).join("");
    for (const secret of [...SECRET_EMAILS, ...SECRET_NAMES]) expect(xml).not.toContain(secret);
  });
});

describe("pilot Word files", () => {
  it("reads like a printed record with the code, summary, phase table and full conversation", async () => {
    const data = buildPilotExport(input());
    const record = data.sessions.find((item) => item.summary.code === "R03" && item.summary.attempt === 1)!;
    const text = await docxText(await writeSessionDocument(record));
    expect(text).toContain("Resident R03, Impacted Maxillary Canine");
    expect(text).toContain("Time spent: 50 min, not counting pauses");
    expect(text).toContain("Session status: Completed");
    expect(text).toContain("AI score: 82 out of 100");
    expect(text).toContain("Phase 2: Clinical & Radiographic AssessmentTutor walked them through it");
    expect(text).toContain("Longest gap between messages: 38 min, not counting pauses");
    expect(text).toMatch(/Tutor: \d{2} Nov/);
    expect(text).not.toMatch(/(Tutor|Resident): {2}/);
    expect(text).toContain("Resident:");
    expect(text).toContain("Tutor:");
    expect(text).toContain("Sector 3 overlap.");
    expect(text).toContain("END-OF-LONG-ANSWER");
    expect(text).toContain("(pressed Help)");
    for (const secret of [...SECRET_EMAILS, ...SECRET_NAMES]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toContain("—");
  });
});

describe("pilot zip", () => {
  it("holds the workbook and one Word file per session", async () => {
    const result = await buildPilotZip(input());
    expect(result.fileName).toBe("socratic-pilot-CASE-1-PILOT-2026-11-06.zip");
    const zip = await JSZip.loadAsync(result.buffer);
    const files = Object.values(zip.files).filter((file) => !file.dir).map((file) => file.name).sort();
    expect(files).toEqual([
      `${WORD_FOLDER}/R02.docx`, `${WORD_FOLDER}/R03-attempt-2.docx`, `${WORD_FOLDER}/R03.docx`, `${WORD_FOLDER}/R10.docx`,
      "socratic-pilot-CASE-1-PILOT-2026-11-06.xlsx",
    ]);
    const r10 = await docxText(await zip.file(`${WORD_FOLDER}/R10.docx`)!.async("nodebuffer"));
    expect(r10).toContain("Resident R10");
    expect(r10).toContain("The canine is missing.");
  });
});

describe("long text splitting", () => {
  it("never makes a chunk longer than the limit, even when a space sits right on it", () => {
    const text = `${"a".repeat(10)} ${"b".repeat(20)}`;
    const chunks = splitLongText(text, 10);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });
});
