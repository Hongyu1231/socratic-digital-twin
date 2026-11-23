import ExcelJS from "exceljs";

import type { PilotExport, SummaryRow, TranscriptRow } from "@/lib/export/pilot-export";

/** Excel's hard cell limit is 32,767 characters; stay safely under it. */
export const MAX_CELL_TEXT = 32_000;

/** Excel dates carry no time zone, so store Singapore wall-clock time. */
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
const asSingaporeWallClock = (date: Date) => new Date(date.getTime() + SINGAPORE_OFFSET_MS);
const DATE_FORMAT = "dd mmm yyyy hh:mm";
const MINUTES_FORMAT = "0.0";

type Cell = string | number | Date | null;

interface Column {
  header: string;
  width: number;
  /** Repeated on continuation rows so a split row still says whose it is. */
  key?: boolean;
  format?: string;
  wrap?: boolean;
}

/** Split text into chunks under the cell limit, preferring to break at a space. */
export function splitLongText(text: string, limit = MAX_CELL_TEXT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const space = rest.lastIndexOf(" ", limit - 1);
    const cut = space > limit * 0.8 ? space + 1 : limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

/**
 * Turn one logical row into one or more sheet rows. Any text over the cell
 * limit continues on the next rows; identifying columns repeat there and the
 * optional part column says "1 of 2", "2 of 2".
 */
function expandRow(columns: Column[], values: Cell[], partColumn: number | null): Cell[][] {
  const pieces = values.map((value) => typeof value === "string" ? splitLongText(value) : [value]);
  const rowCount = Math.max(...pieces.map((piece) => piece.length));
  return Array.from({ length: rowCount }, (_, rowIndex) => columns.map((column, columnIndex) => {
    if (columnIndex === partColumn) return rowCount > 1 ? `${rowIndex + 1} of ${rowCount}` : null;
    const piece = pieces[columnIndex]!;
    if (piece.length > 1) return piece[rowIndex] ?? null;
    return rowIndex === 0 || column.key ? piece[0] ?? null : null;
  }));
}

function addTable(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: Cell[][], partColumn: number | null = null) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "top", wrapText: true };
  for (const values of rows) for (const expanded of expandRow(columns, values, partColumn)) sheet.addRow(expanded);
  columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    if (column.format) sheetColumn.numFmt = column.format;
    sheetColumn.alignment = { vertical: "top", wrapText: column.wrap ?? false };
  });
  header.alignment = { vertical: "top", wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

export function phaseHeader(column: PilotExport["phaseColumns"][number]) {
  return column.title ? `Phase ${column.order}: ${column.title}` : `Phase ${column.order}`;
}

export const TIME_SPENT_HEADER = "Time spent (minutes, not counting pauses)";
export const LONGEST_GAP_HEADER = "Longest gap between messages (minutes)";

export function summaryColumns(data: PilotExport): Column[] {
  return [
    { header: "Resident code", width: 14, key: true },
    { header: "Attempt (1 = first try at this case)", width: 13, key: true },
    { header: "Case", width: 36 },
    { header: "Started (Singapore time)", width: 19, format: DATE_FORMAT },
    { header: "Finished (Singapore time)", width: 19, format: DATE_FORMAT },
    { header: TIME_SPENT_HEADER, width: 15, format: MINUTES_FORMAT },
    { header: LONGEST_GAP_HEADER, width: 15, format: MINUTES_FORMAT },
    { header: "Session status", width: 18 },
    { header: "AI score (out of 100)", width: 11 },
    // Wide enough for "Tutor walked them through it" on one line.
    ...data.phaseColumns.map((column) => ({ header: phaseHeader(column), width: 30 })),
    { header: "Times the resident asked for help", width: 15 },
  ];
}

function summaryValues(data: PilotExport, row: SummaryRow): Cell[] {
  return [
    row.code,
    row.attempt,
    row.caseTitle,
    asSingaporeWallClock(row.startedAt),
    row.finishedAt ? asSingaporeWallClock(row.finishedAt) : null,
    row.timeSpentMinutes,
    row.longestGapMinutes,
    row.statusLabel,
    row.aiScore,
    ...data.phaseColumns.map((_, index) => row.phases[index]?.label ?? null),
    row.helpRequests,
  ];
}

export const TRANSCRIPT_COLUMNS: Column[] = [
  { header: "Resident code", width: 14, key: true },
  { header: "Attempt", width: 9, key: true },
  { header: "Case", width: 36, key: true },
  { header: "Phase number", width: 9, key: true },
  { header: "Phase", width: 38, key: true },
  { header: "Message number in the conversation", width: 12, key: true },
  { header: "Who spoke", width: 11, key: true },
  // The only wrapped column: messages are long by nature.
  { header: "What they said", width: 90, wrap: true },
  { header: "Sent (Singapore time)", width: 19, key: true, format: DATE_FORMAT },
  { header: "Help request", width: 32, key: true },
  { header: "Part (only for very long messages split over several rows)", width: 14, key: true },
];

function transcriptValues(row: TranscriptRow): Cell[] {
  return [
    row.code, row.attempt, row.caseTitle, row.phaseOrder, row.phaseTitle, row.messageNumber,
    row.speaker, row.text, asSingaporeWallClock(row.sentAt), row.help || null, null,
  ];
}

/** What each column holds, in sheet order, for the Notes sheet. */
function columnNotes(data: PilotExport): Array<[string, string]> {
  return [
    ["Resident code", "The resident's study code, for example R03. No names or emails are included."],
    ["Attempt (1 = first try at this case)", "1 for their first go at this case, 2 if they started it again, and so on, in the order they started."],
    ["Case", "The case they worked through."],
    ["Started (Singapore time)", "When they opened the case."],
    ["Finished (Singapore time)", "When the session ended. Empty if they haven't finished yet."],
    [TIME_SPENT_HEADER, "How long they actually spent working, in minutes, to one decimal place, with any pauses taken out."],
    [LONGEST_GAP_HEADER, "The longest wait between two messages, in minutes, to one decimal place, not counting pauses. Empty if there were fewer than two messages."],
    ["Session status", "Completed (worked through every phase), Ended early (stopped before the last phase) or Still in progress."],
    ["AI score (out of 100)", "The tutor's automatic score for their answers. Empty if there isn't one yet."],
    ...data.phaseColumns.map((column): [string, string] => [phaseHeader(column), "Did it on their own, Tutor walked them through it, or Didn't finish this phase."]),
    ["Times the resident asked for help", "How many times they pressed the Help button."],
  ];
}

function transcriptNotes(): Array<[string, string]> {
  return [
    ["Resident code", "Same code as on the Summary sheet."],
    ["Attempt", "Matches the attempt number on the Summary sheet."],
    ["Case", "The case they worked through."],
    ["Phase number", "Which phase of the case the message belongs to."],
    ["Phase", "The name of that phase."],
    ["Message number in the conversation", "1 for the tutor's opening question, then counting up through the conversation."],
    ["Who spoke", "Tutor or Resident."],
    ["What they said", "The full message, word for word."],
    ["Sent (Singapore time)", "When the message was sent."],
    ["Help request", "\"Asked for help\" when the resident pressed Help, and \"Tutor's reply to a help request\" for the tutor's answer to it."],
    ["Part (only for very long messages split over several rows)", "Empty for almost every message. A message too long for one Excel cell carries on in the rows below, marked 1 of 2, 2 of 2 and so on."],
  ];
}

function addNotes(workbook: ExcelJS.Workbook, data: PilotExport) {
  const sheet = workbook.addWorksheet("Notes");
  sheet.columns = [{ width: 44 }, { width: 100 }];
  const line = (first: string, second = "", bold = false) => {
    const row = sheet.addRow([first, second]);
    row.alignment = { vertical: "top", wrapText: true };
    if (bold) row.getCell(1).font = { bold: true };
    if (!second) sheet.mergeCells(row.number, 1, row.number, 2);
  };
  line(`This file holds the resident pilot data for ${data.className} (${data.classCode}), downloaded on ${data.exportedText} Singapore time.`);
  line("It's for the thesis team: each resident appears only by their study code, and every time is in Singapore time.");
  line("");
  line("Summary sheet, one row per session", "", true);
  for (const [header, note] of columnNotes(data)) line(header, note);
  line("");
  line("Transcripts sheet, one row per message", "", true);
  for (const [header, note] of transcriptNotes()) line(header, note);
  line("");
  line("Good to know", "", true);
  line("Time spent", "Counted from when the resident opened the case to when the session ended, minus every time they paused. For a session still in progress, it runs up to their last message.");
  line("Longest gap", "A long gap helps spot a session that was left open without pressing Pause, which would make time spent look longer than it was.");
  if (data.anyEarlierPausesUnknown) {
    line("Older paused sessions", "A session that was already paused before the app started keeping pause records is counted from the start to its last message, so any breaks before that pause are included.");
  }
  line("Did it on their own", "The resident covered everything the phase asks for. A single hint along the way still counts as on their own.");
  line("Tutor walked them through it", "The tutor gave its strongest support, walking them through the phase, before they finished it. That happens after two Help presses, or after several answers that didn't move forward.");
  line("Didn't finish this phase", "They didn't complete this phase, either because they stopped earlier or because they're still working on it.");
  if (data.phaseColumns.some((column) => !column.title)) {
    line("Phase columns", "This class has more than one case and their phases have different names, so some phase columns only show the number. The Transcripts sheet and the Word files name every phase.");
  }
  line("Ended early", "The resident chose to finish before working through every phase.");
  line("Word files", "The \"Transcripts (Word)\" folder has one document per session with the same conversation, laid out for reading or printing.");
  line("Who's included", "Only residents enrolled in this class, and only their sessions for this class's cases. Faculty test runs are left out.");
}

export async function writePilotWorkbook(data: PilotExport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Socratic Digital Twin";
  workbook.created = data.exportedAt;
  addTable(workbook, "Summary", summaryColumns(data), data.summary.map((row) => summaryValues(data, row)));
  addTable(workbook, "Transcripts", TRANSCRIPT_COLUMNS, data.transcripts.map(transcriptValues), TRANSCRIPT_COLUMNS.length - 1);
  addNotes(workbook, data);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
